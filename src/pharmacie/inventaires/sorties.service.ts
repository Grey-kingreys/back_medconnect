import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from '../acces-pharmacie.service';
import { ENTIER_MAX } from '../domaine/reception';
import { estPerime } from '../domaine/selection-lots';
import { motifSortie, typeMouvementSortie } from '../domaine/sortie';
import { jourConakry } from '../jour-metier';
import { estDoublonSur } from '../stock/erreurs-base';
import { dateVersJour } from '../stock/lecture-stock';
import { MouvementsStockService } from '../stock/mouvements-stock.service';
import type { CreerSortieStockDto } from '../dto/inventaires.dto';

export const MESSAGE_RAISON_SORTIE_REQUISE =
  'Choisissez la raison de la sortie : périmé, cassé ou abîmé, perdu ou volé, retour au fournisseur, ou autre.';
export const MESSAGE_COMMENTAIRE_SORTIE_REQUIS =
  'Précisez la raison de la sortie en quelques mots (3 caractères au moins).';
export const MESSAGE_LOT_INTROUVABLE_SORTIE =
  'Ce lot est introuvable pour ce médicament.';
export const MESSAGE_SORTIE_QUANTITE_TROP_GRANDE =
  'La quantité sortie est trop grande. Vérifiez la quantité.';
export const MESSAGE_IDENTIFIANT_SORTIE =
  'Cet identifiant est déjà utilisé par une autre sortie de stock.';
export const MESSAGE_SORTIE_ENREGISTREE = 'Sortie de stock enregistrée.';
export const MESSAGE_SORTIE_REJOUEE =
  'Cette sortie de stock était déjà enregistrée.';
export function messageSortieLotInsuffisante(solde: number): string {
  return `Ce lot n'a que ${solde} unité(s) en stock : la sortie ne peut pas dépasser ce stock.`;
}

const OPTIONS_TRANSACTION = { maxWait: 10_000, timeout: 30_000 };

@Injectable()
export class SortiesStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly mouvementsStock: MouvementsStockService,
  ) {}

  async enregistrer(
    structureId: string,
    userId: string,
    dto: CreerSortieStockDto,
    ip?: string | null,
  ) {
    const acces = await this.accesPharmacie.verifier(structureId, userId);

    const resultat = motifSortie(dto.raison ?? null, dto.commentaire ?? null);
    if (!resultat.ok) {
      throw new BadRequestException({
        message:
          resultat.code === 'RAISON_REQUISE'
            ? MESSAGE_RAISON_SORTIE_REQUISE
            : MESSAGE_COMMENTAIRE_SORTIE_REQUIS,
        code: 'MOTIF_REQUIS',
      });
    }
    const motif = resultat.motif;
    const raison = dto.raison as NonNullable<typeof dto.raison>;
    const type = typeMouvementSortie(raison);

    const idSortie = dto.id ?? randomUUID();
    const evenementId = `sortie:${idSortie}`;

    let cree: boolean;
    try {
      cree = await this.prisma.$transaction(async (tx) => {
        const pointDeVente = await tx.pointDeVente.findUnique({
          where: { structureId_ordre: { structureId, ordre: 1 } },
          select: { id: true },
        });
        if (!pointDeVente) {
          throw new NotFoundException(MESSAGE_LOT_INTROUVABLE_SORTIE);
        }
        const pointDeVenteId = pointDeVente.id;

        const rejeu = await tx.mouvementStock.findUnique({
          where: { evenementId },
          select: { id: true, pointDeVenteId: true },
        });
        if (rejeu) {
          if (rejeu.pointDeVenteId === pointDeVenteId) return false;
          throw new ConflictException({
            message: MESSAGE_IDENTIFIANT_SORTIE,
            code: 'IDENTIFIANT_DEJA_UTILISE',
          });
        }

        const lot = await tx.lotStock.findFirst({
          where: {
            id: dto.lotId,
            stockMedicamentId: dto.stockId,
            pointDeVenteId,
          },
          select: { id: true },
        });
        if (!lot) throw new NotFoundException(MESSAGE_LOT_INTROUVABLE_SORTIE);

        await this.mouvementsStock.verrouillerFiches(tx, [dto.stockId]);

        const sous = await tx.lotStock.findUniqueOrThrow({
          where: { id: dto.lotId },
          select: {
            coefficientReception: true,
            agregat: { select: { quantite: true } },
          },
        });
        const solde = sous.agregat?.quantite ?? 0;
        const quantiteUm =
          dto.unite === 'BOITE'
            ? dto.quantite * sous.coefficientReception
            : dto.quantite;
        if (quantiteUm > ENTIER_MAX) {
          throw new BadRequestException({
            message: MESSAGE_SORTIE_QUANTITE_TROP_GRANDE,
            code: 'VALIDATION',
            champs: [{ champ: 'quantite', contraintes: ['quantiteMaximale'] }],
          });
        }
        if (quantiteUm > solde) {
          throw new ConflictException({
            message: messageSortieLotInsuffisante(solde),
            code: 'STOCK_LOT_NEGATIF',
          });
        }

        const ecrit = await this.mouvementsStock.ecrire(tx, {
          evenementId,
          pointDeVenteId,
          stockMedicamentId: dto.stockId,
          lotId: dto.lotId,
          type,
          quantite: -quantiteUm,
          pieceOrigineType: 'SORTIE_MANUELLE',
          pieceOrigineId: idSortie,
          motif,
          auteurId: acces.user.id,
        });

        await tx.auditLog.create({
          data: {
            userId: acces.user.id,
            action: 'create',
            entityType: 'MouvementStock',
            entityId: ecrit.mouvement.id,
            ip: ip ?? null,
            metadata: {
              type,
              quantite: quantiteUm,
              stockId: dto.stockId,
              lotId: dto.lotId,
              raison,
            },
          },
        });
        return true;
      }, OPTIONS_TRANSACTION);
    } catch (erreur) {
      if (!dto.id || !estDoublonSur(erreur, 'MouvementStock')) throw erreur;
      const existant = await this.prisma.mouvementStock.findUnique({
        where: { evenementId },
        select: { pointDeVente: { select: { structureId: true } } },
      });
      if (existant?.pointDeVente.structureId !== structureId) {
        throw new ConflictException({
          message: MESSAGE_IDENTIFIANT_SORTIE,
          code: 'IDENTIFIANT_DEJA_UTILISE',
        });
      }
      cree = false;
    }

    const presentee = await this.presenter(evenementId);
    return {
      data: { ...presentee, cree },
      message: cree ? MESSAGE_SORTIE_ENREGISTREE : MESSAGE_SORTIE_REJOUEE,
      success: true as const,
    };
  }

  /** Lecture hors transaction du mouvement de la sortie, sans aucune donnée de coût. */
  private async presenter(evenementId: string) {
    const m = await this.prisma.mouvementStock.findUniqueOrThrow({
      where: { evenementId },
      select: {
        id: true,
        pieceOrigineId: true,
        stockMedicamentId: true,
        pointDeVenteId: true,
        lotId: true,
        type: true,
        motif: true,
        quantite: true,
        auteurId: true,
        horodatageServeur: true,
        stockMedicament: { select: { medicament: { select: { nom: true } } } },
        lot: {
          select: {
            numeroLot: true,
            dateExpiration: true,
            agregat: { select: { quantite: true } },
          },
        },
      },
    });
    const produit = await this.prisma.agregatStockProduit.findUnique({
      where: {
        stockMedicamentId_pointDeVenteId: {
          stockMedicamentId: m.stockMedicamentId,
          pointDeVenteId: m.pointDeVenteId,
        },
      },
      select: { quantite: true },
    });
    const lotsEnStock = await this.prisma.lotStock.findMany({
      where: {
        stockMedicamentId: m.stockMedicamentId,
        pointDeVenteId: m.pointDeVenteId,
        agregat: { is: { quantite: { gt: 0 } } },
      },
      select: { agregat: { select: { quantite: true } } },
    });
    const sommeLots = lotsEnStock.reduce(
      (somme, l) => somme + (l.agregat?.quantite ?? 0),
      0,
    );
    const soldeProduit = produit?.quantite ?? 0;
    const dateExpiration = m.lot?.dateExpiration
      ? dateVersJour(m.lot.dateExpiration)
      : null;
    return {
      id: m.pieceOrigineId,
      mouvementId: m.id,
      stockId: m.stockMedicamentId,
      nom: m.stockMedicament.medicament.nom,
      lotId: m.lotId,
      numeroLot: m.lot?.numeroLot ?? null,
      dateExpiration,
      perime: estPerime(dateExpiration, jourConakry(new Date())),
      type: m.type,
      motif: m.motif,
      quantite: -m.quantite,
      soldeLot: m.lot?.agregat?.quantite ?? 0,
      // Jamais négatif en sortie (D717) ; la part non couverte est à part
      soldeProduit: Math.max(0, soldeProduit),
      quantiteARegulariser: Math.max(0, sommeLots - soldeProduit),
      auteurId: m.auteurId,
      createdAt: m.horodatageServeur,
    };
  }
}
