import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from '../acces-pharmacie.service';
import { estPerime } from '../domaine/selection-lots';
import { jourConakry } from '../jour-metier';
import { estDoublonSur } from '../stock/erreurs-base';
import { dateVersJour } from '../stock/lecture-stock';
import { MouvementsStockService } from '../stock/mouvements-stock.service';
import {
  ecrireSortieStock,
  MESSAGE_COMMENTAIRE_SORTIE_REQUIS,
  MESSAGE_IDENTIFIANT_SORTIE,
  MESSAGE_LOT_INTROUVABLE_SORTIE,
  MESSAGE_RAISON_SORTIE_REQUISE,
  MESSAGE_SORTIE_QUANTITE_TROP_GRANDE,
  messageSortieLotInsuffisante,
  motifDeSortieOuRefus,
} from '../stock/operations-stock';
import type { CreerSortieStockDto } from '../dto/inventaires.dto';

// Messages gardés ici pour les importeurs existants.
export {
  MESSAGE_COMMENTAIRE_SORTIE_REQUIS,
  MESSAGE_IDENTIFIANT_SORTIE,
  MESSAGE_LOT_INTROUVABLE_SORTIE,
  MESSAGE_RAISON_SORTIE_REQUISE,
  MESSAGE_SORTIE_QUANTITE_TROP_GRANDE,
  messageSortieLotInsuffisante,
};
export const MESSAGE_SORTIE_ENREGISTREE = 'Sortie de stock enregistrée.';
export const MESSAGE_SORTIE_REJOUEE =
  'Cette sortie de stock était déjà enregistrée.';
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
    const { motif, raison } = motifDeSortieOuRefus(dto.raison, dto.commentaire);
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
        const ecrit = await ecrireSortieStock(this.mouvementsStock, tx, {
          structureId,
          pointDeVenteId: pointDeVente.id,
          auteurId: acces.user.id,
          idSortie,
          stockId: dto.stockId,
          lotId: dto.lotId,
          unite: dto.unite,
          quantite: dto.quantite,
          motif,
          raison,
          tolerant: false,
          ip,
        });
        return ecrit.cree;
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
