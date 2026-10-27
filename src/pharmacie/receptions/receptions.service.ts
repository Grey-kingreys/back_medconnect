import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import {
  AccesPharmacieService,
  type AccesPharmacie,
} from '../acces-pharmacie.service';
import { assurerPointDeVente } from '../point-de-vente';
import { jourConakry } from '../jour-metier';
import { masquerCouts } from '../masquer-couts';
import type { Reponse } from '../points-de-vente.service';
import { reliquatLot } from '../domaine/quantites';
import {
  ENTIER_MAX,
  jourValide,
  preparerLigneReception,
  type CodeRefusLigneReception,
  type LigneReceptionPreparee,
} from '../domaine/reception';
import {
  comparerFefo,
  estPerime,
  type LotCandidat,
} from '../domaine/selection-lots';
import { estDoublonSur } from '../stock/erreurs-base';
import {
  dateVersJour,
  jourVersDate,
  lireLotsCandidats,
} from '../stock/lecture-stock';
import { MouvementsStockService } from '../stock/mouvements-stock.service';
import {
  resoudreProvisoires,
  type ResolutionEcrite,
} from '../stock/resolution-provisoires';
import type {
  CorrigerLotDto,
  CreerFournisseurDto,
  CreerReceptionDto,
  ListerReceptionsDto,
} from '../dto/receptions.dto';

export const MESSAGE_FOURNISSEUR_INTROUVABLE =
  'Ce fournisseur est introuvable.';
export const MESSAGE_FOURNISSEUR_EXISTANT =
  'Un fournisseur porte déjà ce nom dans votre pharmacie.';
export const MESSAGE_RECEPTION_INTROUVABLE = 'Cette réception est introuvable.';
export const MESSAGE_LOT_INTROUVABLE = 'Ce lot est introuvable.';
export const MESSAGE_FICHE_INTROUVABLE =
  'Ce médicament est introuvable dans le stock de cette pharmacie.';
export const MESSAGE_STOCK_INTROUVABLE_RECEPTION =
  "Un médicament de la livraison est introuvable dans le stock de cette pharmacie. Ajoutez-le d'abord à votre stock.";
export const MESSAGE_DATE_PEREMPTION_REQUISE_RECEPTION =
  "Indiquez la date de péremption de chaque médicament reçu, ou précisez qu'il n'en a pas.";
export const MESSAGE_DATE_PEREMPTION_PASSEE =
  'La date de péremption de ce médicament est déjà passée : vérifiez-la. Un médicament périmé ne doit pas entrer en stock.';
export const MESSAGE_DATE_INVALIDE =
  "La date de péremption n'existe pas : vérifiez-la (format AAAA-MM-JJ).";
export const MESSAGE_QUANTITE_RECUE_REQUISE =
  "Indiquez la quantité reçue : un nombre de boîtes ou un nombre d'unités.";
export const MESSAGE_QUANTITE_RECUE_UNIQUE =
  "Indiquez soit le nombre de boîtes, soit le nombre d'unités reçues, pas les deux.";
export const MESSAGE_QUANTITE_RECUE_TROP_GRANDE =
  'La quantité reçue est trop grande pour être enregistrée. Vérifiez la quantité.';
export const MESSAGE_RECUE_DANS_LE_FUTUR =
  'La date de réception ne peut pas être dans le futur.';
export const MESSAGE_IDENTIFIANT_RECEPTION =
  'Cet identifiant est déjà utilisé par une autre réception.';
export const MESSAGE_MOTIF_CORRECTION_LOT =
  'Indiquez le motif de la correction (3 caractères au moins).';
export const MESSAGE_FICHE_NON_QUALIFIEE =
  "Le nombre d'unités par boîte de ce médicament n'est pas encore confirmé : vérifiez sa fiche avant de compter en boîtes.";
export const MESSAGE_RECEPTION_REJOUEE =
  'Cette réception était déjà enregistrée.';
export const MESSAGE_VENTES_RATTACHEES =
  'Les ventes faites en attente de ce stock ont été rattachées aux lots reçus.';
export function messageReceptionEnregistree(nombreLots: number): string {
  return nombreLots === 1
    ? 'Réception enregistrée : 1 lot.'
    : `Réception enregistrée : ${nombreLots} lots.`;
}

export interface LigneReceptionAEnregistrer {
  stockId: string;
  numeroLot: string | null;
  dateExpiration: string | null;
  sansPeremption: boolean;
  nombreBoites: number | null;
  quantiteUnites: number | null;
  coutAchatBoite: number | null;
  /** Mise à jour de la fiche demandée par l'import (prix de la boîte, notes) ; jamais par la route. */
  majFiche?: { prixUnitaire?: number; notes?: string };
}
export interface ReceptionAEnregistrer {
  id?: string;
  fournisseurId: string | null;
  reference: string | null;
  recueLe: Date;
  lignes: LigneReceptionAEnregistrer[];
}
export interface AvertissementReception {
  code: 'FICHE_NON_QUALIFIEE';
  stockId: string;
  nom: string;
  message: string;
}
export interface ReceptionEcrite {
  receptionId: string;
  cree: boolean;
  /** Une entrée par ligne, dans l'ordre reçu ; vide pour un rejeu. */
  lignes: {
    stockId: string;
    lotId: string;
    quantiteUm: number;
    soldeProduitApres: number;
  }[];
  avertissements: AvertissementReception[];
  /** Ventes faites sans stock rattachées aux lots reçus ; vide pour un rejeu. */
  resolutions: ResolutionEcrite[];
}

const OPTIONS_TRANSACTION_RECEPTION = { maxWait: 10_000, timeout: 30_000 };
const PAR_PAGE = 20;

const GROUPE_QUANTITE_OU_DATE: CodeRefusLigneReception[] = [
  'QUANTITE_REQUISE',
  'QUANTITE_UNIQUE',
  'QUANTITE_TROP_GRANDE',
  'DATE_INVALIDE',
];

const MESSAGE_PAR_CODE: Record<string, string> = {
  QUANTITE_REQUISE: MESSAGE_QUANTITE_RECUE_REQUISE,
  QUANTITE_UNIQUE: MESSAGE_QUANTITE_RECUE_UNIQUE,
  QUANTITE_TROP_GRANDE: MESSAGE_QUANTITE_RECUE_TROP_GRANDE,
  DATE_INVALIDE: MESSAGE_DATE_INVALIDE,
};

function champDuRefus(
  code: CodeRefusLigneReception,
  i: number,
): { champ: string; contraintes: string[] } {
  switch (code) {
    case 'QUANTITE_REQUISE':
      return {
        champ: `lignes.${i}.nombreBoites`,
        contraintes: ['quantiteRequise'],
      };
    case 'QUANTITE_UNIQUE':
      return {
        champ: `lignes.${i}.nombreBoites`,
        contraintes: ['quantiteUnique'],
      };
    case 'QUANTITE_TROP_GRANDE':
      return {
        champ: `lignes.${i}.nombreBoites`,
        contraintes: ['quantiteMaximale'],
      };
    default:
      return {
        champ: `lignes.${i}.dateExpiration`,
        contraintes: ['dateValide'],
      };
  }
}

interface FicheVerrouillee {
  id: string;
  coefficientBoite: number;
  qualifie: boolean;
  archiveLe: Date | null;
}

export interface ElementLot {
  id: string;
  numeroLot: string | null;
  dateExpiration: string | null;
  dateReception: string;
  quantite: number;
  reliquat: number;
  coefficientReception: number;
  lotTechnique: boolean;
  perime: boolean;
  coutUnitaire: number;
}

type ClientLecture = Pick<
  Prisma.TransactionClient,
  'reception' | 'allocationLot' | 'mouvementStock'
>;

function elementLot(c: LotCandidat, jour: string): ElementLot {
  return {
    id: c.id,
    numeroLot: c.numeroLot,
    dateExpiration: c.dateExpiration,
    dateReception: c.dateReception,
    quantite: c.solde,
    reliquat: reliquatLot(c.solde, c.coefficientReception),
    coefficientReception: c.coefficientReception,
    lotTechnique: c.lotTechnique,
    perime: estPerime(c.dateExpiration, jour),
    coutUnitaire: c.coutUnitaire,
  };
}

@Injectable()
export class ReceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly mouvementsStock: MouvementsStockService,
    private readonly permissions: PermissionsService,
  ) {}

  private async peutVoirMarge(userId: string): Promise<boolean> {
    return (await this.permissions.getUserPermissions(userId)).includes(
      PERMISSIONS.MARGE_READ,
    );
  }

  /**
   * Enregistre une réception dans la transaction de l'appelant (D567 à D575).
   * Réutilisée par l'import de livraison.
   */
  async enregistrerDansTransaction(
    tx: Prisma.TransactionClient,
    acces: AccesPharmacie,
    entree: ReceptionAEnregistrer,
    ip: string | null = null,
  ): Promise<ReceptionEcrite> {
    const structureId = acces.structure.id;
    const userId = acces.user.id;

    // 1. Point de vente
    const existant = await tx.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId, ordre: 1 } },
    });
    const pointDeVente =
      existant ?? (await assurerPointDeVente(tx, acces.structure)).pointDeVente;
    const pointDeVenteId = pointDeVente.id;

    // 2. Rejeu par identifiant client
    if (entree.id) {
      const deja = await tx.reception.findUnique({
        where: { id: entree.id },
        select: { id: true, pointDeVenteId: true },
      });
      if (deja) {
        if (deja.pointDeVenteId === pointDeVenteId) {
          return {
            receptionId: deja.id,
            cree: false,
            lignes: [],
            avertissements: [],
            resolutions: [],
          };
        }
        throw new ConflictException({
          message: MESSAGE_IDENTIFIANT_RECEPTION,
          code: 'IDENTIFIANT_DEJA_UTILISE',
        });
      }
    }

    // 3. Fournisseur
    if (entree.fournisseurId) {
      const fournisseur = await tx.fournisseur.findFirst({
        where: { id: entree.fournisseurId, structureId, actif: true },
        select: { id: true },
      });
      if (!fournisseur) {
        throw new NotFoundException(MESSAGE_FOURNISSEUR_INTROUVABLE);
      }
    }

    // 4. Pas de réception datée dans le futur
    if (entree.recueLe.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException({
        message: MESSAGE_RECUE_DANS_LE_FUTUR,
        code: 'VALIDATION',
        champs: [{ champ: 'recueLe', contraintes: ['pasDansLeFutur'] }],
      });
    }

    // 5. Verrous de ligne des fiches, triés (D570)
    const ids = [...new Set(entree.lignes.map((l) => l.stockId))].sort();
    const fiches = new Map<string, FicheVerrouillee>();
    for (const id of ids) {
      const lues = await tx.$queryRaw<
        FicheVerrouillee[]
      >`SELECT "id", "coefficientBoite", "qualifie", "archiveLe" FROM "StockMedicament" WHERE "id" = ${id} AND "structureId" = ${structureId} FOR NO KEY UPDATE`;
      if (lues.length > 0) fiches.set(id, lues[0]);
    }
    const absentes = ids.filter((id) => !fiches.has(id));
    if (absentes.length > 0) {
      throw new NotFoundException({
        message: MESSAGE_STOCK_INTROUVABLE_RECEPTION,
        code: 'STOCK_INTROUVABLE',
        details: absentes.map((stockId) => ({ stockId })),
      });
    }
    const noms = new Map(
      (
        await tx.stockMedicament.findMany({
          where: { id: { in: ids } },
          select: { id: true, medicament: { select: { nom: true } } },
        })
      ).map((f) => [f.id, f.medicament.nom]),
    );

    // 6. Préparation et refus groupés
    const jour = jourConakry(new Date());
    const preparees: LigneReceptionPreparee[] = entree.lignes.map((l) =>
      preparerLigneReception(
        {
          coefficientBoite: (fiches.get(l.stockId) as FicheVerrouillee)
            .coefficientBoite,
          nombreBoites: l.nombreBoites,
          quantiteUnites: l.quantiteUnites,
          coutAchatBoite: l.coutAchatBoite,
          dateExpiration: l.dateExpiration,
          sansPeremption: l.sansPeremption,
        },
        jour,
      ),
    );
    const refusEn = (codes: CodeRefusLigneReception[]) =>
      preparees
        .map((p, i) => ({ p, i }))
        .filter(
          (
            x,
          ): x is {
            p: { ok: false; code: CodeRefusLigneReception };
            i: number;
          } => !x.p.ok && codes.includes(x.p.code),
        );
    const groupe1 = refusEn(GROUPE_QUANTITE_OU_DATE);
    if (groupe1.length > 0) {
      throw new BadRequestException({
        message: MESSAGE_PAR_CODE[groupe1[0].p.code],
        code: 'VALIDATION',
        champs: groupe1.map((x) => champDuRefus(x.p.code, x.i)),
      });
    }
    const detailsDe = (codes: CodeRefusLigneReception[]) =>
      refusEn(codes).map((x) => {
        const stockId = entree.lignes[x.i].stockId;
        return { stockId, nom: noms.get(stockId) ?? '' };
      });
    const requises = detailsDe(['DATE_PEREMPTION_REQUISE']);
    if (requises.length > 0) {
      throw new BadRequestException({
        message: MESSAGE_DATE_PEREMPTION_REQUISE_RECEPTION,
        code: 'DATE_PEREMPTION_REQUISE',
        details: requises,
      });
    }
    const passees = detailsDe(['DATE_PEREMPTION_PASSEE']);
    if (passees.length > 0) {
      throw new BadRequestException({
        message: MESSAGE_DATE_PEREMPTION_PASSEE,
        code: 'DATE_PEREMPTION_PASSEE',
        details: passees,
      });
    }
    const pretes = preparees as Extract<LigneReceptionPreparee, { ok: true }>[];

    // 7. Désarchivage (D570)
    for (const id of ids) {
      const fiche = fiches.get(id) as FicheVerrouillee;
      if (fiche.archiveLe === null) continue;
      await tx.stockMedicament.update({
        where: { id },
        data: { archiveLe: null },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'update',
          entityType: 'StockMedicament',
          entityId: id,
          ip: null,
          metadata: {
            avant: { archiveLe: fiche.archiveLe.toISOString() },
            apres: { archiveLe: null },
          },
        },
      });
    }

    // 7b. Prix de la boîte et notes demandés par l'import (fiche verrouillée à l'étape 5)
    for (const ligne of entree.lignes) {
      const maj = ligne.majFiche;
      if (!maj) continue;
      const prixUnitaire = maj.prixUnitaire;
      const notes = maj.notes;
      if (prixUnitaire === undefined && !notes) continue;
      await tx.stockMedicament.update({
        where: { id: ligne.stockId },
        data: {
          ...(prixUnitaire !== undefined ? { prixUnitaire } : {}),
          ...(notes ? { notes } : {}),
        },
      });
    }

    // 8. Verrous consultatifs
    await this.mouvementsStock.verrouillerFiches(tx, ids);

    // 9. Borne de l'agrégat
    const agregats = await tx.agregatStockProduit.findMany({
      where: { pointDeVenteId, stockMedicamentId: { in: ids } },
      select: { stockMedicamentId: true, quantite: true },
    });
    const totalParFiche = new Map<string, number>(
      agregats.map((a) => [a.stockMedicamentId, a.quantite]),
    );
    entree.lignes.forEach((l, i) => {
      totalParFiche.set(
        l.stockId,
        (totalParFiche.get(l.stockId) ?? 0) + pretes[i].quantiteUm,
      );
    });
    const tropGrosses = entree.lignes
      .map((l, i) => ({ l, i }))
      .filter((x) => (totalParFiche.get(x.l.stockId) ?? 0) > ENTIER_MAX);
    if (tropGrosses.length > 0) {
      throw new BadRequestException({
        message: MESSAGE_QUANTITE_RECUE_TROP_GRANDE,
        code: 'VALIDATION',
        champs: tropGrosses.map((x) => ({
          champ: `lignes.${x.i}.nombreBoites`,
          contraintes: ['quantiteMaximale'],
        })),
      });
    }

    // 10. Réception
    const reception = await tx.reception.create({
      data: {
        ...(entree.id ? { id: entree.id } : {}),
        pointDeVenteId,
        fournisseurId: entree.fournisseurId,
        reference: entree.reference,
        recueLe: entree.recueLe,
        auteurId: userId,
      },
      select: { id: true },
    });

    // 11. Un lot et un mouvement par ligne
    const lignes: ReceptionEcrite['lignes'] = [];
    for (let i = 0; i < entree.lignes.length; i++) {
      const ligne = entree.lignes[i];
      const prete = pretes[i];
      const { lot, reception: mouvement } = await this.mouvementsStock.creerLot(
        tx,
        {
          stockMedicamentId: ligne.stockId,
          pointDeVenteId,
          numeroLot: ligne.numeroLot,
          dateExpiration: prete.dateExpiration
            ? jourVersDate(prete.dateExpiration)
            : null,
          quantite: prete.quantiteUm,
          coutUnitaire: prete.coutUnitaire,
          coutAchatBoite: prete.coutAchatBoite,
          coefficientReception: prete.coefficientReception,
          fournisseurId: entree.fournisseurId,
          receptionId: reception.id,
          lotTechnique: false,
          auteurId: userId,
          pieceOrigineType: 'RECEPTION',
          pieceOrigineId: reception.id,
          motif: null,
          evenementId: `reception:${reception.id}:${i}`,
          dateReception: entree.recueLe,
        },
      );
      lignes.push({
        stockId: ligne.stockId,
        lotId: lot.id,
        quantiteUm: prete.quantiteUm,
        soldeProduitApres: mouvement.soldeProduit,
      });
    }

    // 11b. Ventes faites sans stock rattachées aux lots reçus (D576)
    const resolutions = await resoudreProvisoires(tx, this.mouvementsStock, {
      pointDeVenteId,
      stockMedicamentIds: ids,
      pieceId: reception.id,
      auteurId: userId,
      jour,
    });

    // 12. Audit (aucun coût, aucune référence de bon)
    await tx.auditLog.create({
      data: {
        userId,
        action: 'create',
        entityType: 'Reception',
        entityId: reception.id,
        ip,
        metadata: {
          nombreLignes: entree.lignes.length,
          fournisseurId: entree.fournisseurId,
          quantiteTotale: pretes.reduce((s, p) => s + p.quantiteUm, 0),
          // Absent sans résolution : les audits antérieurs gardent la même forme
          ...(resolutions.length > 0
            ? { nombreResolutions: resolutions.length }
            : {}),
        },
      },
    });

    // 13. Avertissements non bloquants (D573)
    const avertissements: AvertissementReception[] = ids
      .filter((id) => !(fiches.get(id) as FicheVerrouillee).qualifie)
      .map((stockId) => ({
        code: 'FICHE_NON_QUALIFIEE' as const,
        stockId,
        nom: noms.get(stockId) ?? '',
        message: MESSAGE_FICHE_NON_QUALIFIEE,
      }));

    return {
      receptionId: reception.id,
      cree: true,
      lignes,
      avertissements,
      resolutions,
    };
  }

  async enregistrer(
    structureId: string,
    userId: string,
    dto: CreerReceptionDto,
    ip?: string | null,
  ) {
    const acces = await this.accesPharmacie.verifier(structureId, userId);
    const peutVoirMarge = await this.peutVoirMarge(userId);
    const entree: ReceptionAEnregistrer = {
      id: dto.id,
      fournisseurId: dto.fournisseurId ?? null,
      reference: dto.reference?.trim() ? dto.reference.trim() : null,
      recueLe: dto.recueLe ? new Date(dto.recueLe) : new Date(),
      lignes: dto.lignes.map((l) => ({
        stockId: l.stockId,
        numeroLot: l.numeroLot?.trim() ? l.numeroLot.trim() : null,
        dateExpiration: l.dateExpiration ?? null,
        sansPeremption: l.sansPeremption ?? false,
        nombreBoites: l.nombreBoites ?? null,
        quantiteUnites: l.quantiteUnites ?? null,
        coutAchatBoite: l.coutAchatBoite ?? null,
      })),
    };

    let ecrite: ReceptionEcrite;
    try {
      ecrite = await this.prisma.$transaction(
        (tx) => this.enregistrerDansTransaction(tx, acces, entree, ip ?? null),
        OPTIONS_TRANSACTION_RECEPTION,
      );
    } catch (erreur) {
      if (!dto.id || !estDoublonSur(erreur, 'Reception')) throw erreur;
      // Course (D571) : un autre appel a inséré cet identifiant entre-temps.
      const autre = await this.prisma.reception.findUnique({
        where: { id: dto.id },
        select: {
          pointDeVente: { select: { structureId: true } },
        },
      });
      if (autre?.pointDeVente.structureId !== structureId) {
        throw new ConflictException({
          message: MESSAGE_IDENTIFIANT_RECEPTION,
          code: 'IDENTIFIANT_DEJA_UTILISE',
        });
      }
      ecrite = {
        receptionId: dto.id,
        cree: false,
        lignes: [],
        avertissements: [],
        resolutions: [],
      };
    }

    const presentee = await this.presenterReception(
      this.prisma,
      ecrite.receptionId,
    );
    return {
      data: masquerCouts(
        {
          ...presentee,
          cree: ecrite.cree,
          avertissements: ecrite.avertissements,
        },
        peutVoirMarge,
      ),
      message: ecrite.cree
        ? messageReceptionEnregistree(ecrite.lignes.length) +
          (ecrite.resolutions.length > 0 ? ` ${MESSAGE_VENTES_RATTACHEES}` : '')
        : MESSAGE_RECEPTION_REJOUEE,
      success: true as const,
    };
  }

  private async presenterReception(client: ClientLecture, receptionId: string) {
    const r = await client.reception.findUniqueOrThrow({
      where: { id: receptionId },
      select: {
        id: true,
        reference: true,
        recueLe: true,
        createdAt: true,
        auteurId: true,
        fournisseur: { select: { id: true, nom: true } },
        lots: {
          select: {
            id: true,
            stockMedicamentId: true,
            stockMedicament: {
              select: { medicament: { select: { nom: true } } },
            },
            numeroLot: true,
            dateExpiration: true,
            quantiteRecue: true,
            coefficientReception: true,
            coutAchatBoite: true,
            coutUnitaire: true,
            agregat: { select: { quantite: true } },
          },
        },
      },
    });
    const lots = r.lots.map((l) => ({
      id: l.id,
      stockId: l.stockMedicamentId,
      nom: l.stockMedicament.medicament.nom,
      numeroLot: l.numeroLot,
      dateExpiration: l.dateExpiration ? dateVersJour(l.dateExpiration) : null,
      quantiteRecue: l.quantiteRecue,
      coefficientReception: l.coefficientReception,
      solde: l.agregat?.quantite ?? 0,
      coutAchatBoite: l.coutAchatBoite,
      coutUnitaire: l.coutUnitaire,
    }));
    lots.sort((a, b) => {
      if (a.nom !== b.nom) return a.nom < b.nom ? -1 : 1;
      if (a.dateExpiration !== b.dateExpiration) {
        if (a.dateExpiration === null) return -1;
        if (b.dateExpiration === null) return 1;
        return a.dateExpiration < b.dateExpiration ? -1 : 1;
      }
      if (a.numeroLot !== b.numeroLot) {
        if (a.numeroLot === null) return -1;
        if (b.numeroLot === null) return 1;
        return a.numeroLot < b.numeroLot ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const allocations = await client.allocationLot.findMany({
      where: { remplaceeParPieceId: receptionId },
      select: {
        id: true,
        quantite: true,
        ligneVente: {
          select: {
            stockMedicamentId: true,
            nomMedicament: true,
            vente: { select: { id: true, numero: true } },
          },
        },
      },
    });
    const resolutions: ResolutionEcrite[] = [];
    for (const a of allocations) {
      const somme = await client.mouvementStock.aggregate({
        _sum: { quantite: true },
        where: {
          pieceOrigineType: 'RESOLUTION',
          pieceOrigineId: receptionId,
          lotId: { not: null },
          evenementId: { startsWith: `resolution:${a.id}:` },
        },
      });
      const quantiteResolue = -(somme._sum.quantite ?? 0);
      resolutions.push({
        allocationId: a.id,
        venteId: a.ligneVente.vente.id,
        numeroVente: a.ligneVente.vente.numero,
        stockId: a.ligneVente.stockMedicamentId,
        nom: a.ligneVente.nomMedicament,
        quantiteProvisoire: a.quantite,
        quantiteResolue,
        resteProvisoire: a.quantite - quantiteResolue,
      });
    }
    resolutions.sort((a, b) =>
      a.numeroVente !== b.numeroVente
        ? a.numeroVente < b.numeroVente
          ? -1
          : 1
        : a.allocationId < b.allocationId
          ? -1
          : a.allocationId > b.allocationId
            ? 1
            : 0,
    );
    return {
      id: r.id,
      reference: r.reference,
      recueLe: r.recueLe,
      createdAt: r.createdAt,
      auteurId: r.auteurId,
      fournisseur: r.fournisseur,
      lots,
      resolutions,
    };
  }

  async lister(structureId: string, userId: string, dto: ListerReceptionsDto) {
    await this.accesPharmacie.verifier(structureId, userId);
    const page = dto.page ?? 1;
    const pointDeVente = await this.prisma.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId, ordre: 1 } },
      select: { id: true },
    });
    let receptions: {
      id: string;
      reference: string | null;
      recueLe: Date;
      createdAt: Date;
      auteurId: string;
      fournisseur: { id: string; nom: string } | null;
      nombreLots: number;
      quantiteTotale: number;
    }[] = [];
    let total = 0;
    if (pointDeVente) {
      const [lignes, nombre] = await Promise.all([
        this.prisma.reception.findMany({
          where: { pointDeVenteId: pointDeVente.id },
          orderBy: [{ recueLe: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * PAR_PAGE,
          take: PAR_PAGE,
          select: {
            id: true,
            reference: true,
            recueLe: true,
            createdAt: true,
            auteurId: true,
            fournisseur: { select: { id: true, nom: true } },
            lots: { select: { quantiteRecue: true } },
          },
        }),
        this.prisma.reception.count({
          where: { pointDeVenteId: pointDeVente.id },
        }),
      ]);
      total = nombre;
      receptions = lignes.map((r) => ({
        id: r.id,
        reference: r.reference,
        recueLe: r.recueLe,
        createdAt: r.createdAt,
        auteurId: r.auteurId,
        fournisseur: r.fournisseur,
        nombreLots: r.lots.length,
        quantiteTotale: r.lots.reduce((s, l) => s + l.quantiteRecue, 0),
      }));
    }
    return {
      data: { receptions, page, parPage: PAR_PAGE, total },
      message: `${total} réception(s)`,
      success: true as const,
    };
  }

  async detail(structureId: string, userId: string, receptionId: string) {
    await this.accesPharmacie.verifier(structureId, userId);
    const peutVoirMarge = await this.peutVoirMarge(userId);
    const existe = await this.prisma.reception.findFirst({
      where: { id: receptionId, pointDeVente: { structureId } },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException(MESSAGE_RECEPTION_INTROUVABLE);
    return {
      data: masquerCouts(
        await this.presenterReception(this.prisma, receptionId),
        peutVoirMarge,
      ),
      message: 'Réception trouvée.',
      success: true as const,
    };
  }

  async listerFournisseurs(structureId: string, userId: string) {
    await this.accesPharmacie.verifier(structureId, userId);
    const fournisseurs = await this.prisma.fournisseur.findMany({
      where: { structureId, actif: true },
      orderBy: [{ nom: 'asc' }, { id: 'asc' }],
      select: { id: true, nom: true, telephone: true, createdAt: true },
    });
    return {
      data: fournisseurs,
      message: `${fournisseurs.length} fournisseur(s)`,
      success: true as const,
    };
  }

  async creerFournisseur(
    structureId: string,
    userId: string,
    dto: CreerFournisseurDto,
    ip?: string | null,
  ): Promise<
    Reponse<{
      id: string;
      nom: string;
      telephone: string | null;
      createdAt: Date;
      cree: true;
    }>
  > {
    const { user } = await this.accesPharmacie.verifier(structureId, userId);
    const refus = () =>
      new ConflictException({
        message: MESSAGE_FOURNISSEUR_EXISTANT,
        code: 'FOURNISSEUR_EXISTANT',
      });
    try {
      const f = await this.prisma.$transaction(async (tx) => {
        const meme = await tx.fournisseur.findFirst({
          where: { structureId, nom: { equals: dto.nom, mode: 'insensitive' } },
          select: { id: true },
        });
        if (meme) throw refus();
        const cree = await tx.fournisseur.create({
          data: {
            structureId,
            nom: dto.nom,
            telephone: dto.telephone ? dto.telephone : null,
          },
          select: { id: true, nom: true, telephone: true, createdAt: true },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'create',
            entityType: 'Fournisseur',
            entityId: cree.id,
            ip: ip ?? null,
            metadata: { nom: cree.nom },
          },
        });
        return cree;
      });
      return {
        data: { ...f, cree: true },
        message: 'Fournisseur enregistré.',
        success: true,
      };
    } catch (erreur) {
      if (estDoublonSur(erreur, 'Fournisseur')) throw refus();
      throw erreur;
    }
  }

  async listerLots(structureId: string, userId: string, stockId: string) {
    await this.accesPharmacie.verifier(structureId, userId);
    const peutVoirMarge = await this.peutVoirMarge(userId);
    const fiche = await this.prisma.stockMedicament.findFirst({
      where: { id: stockId, structureId, archiveLe: null },
      select: { id: true },
    });
    if (!fiche) throw new NotFoundException(MESSAGE_FICHE_INTROUVABLE);
    const pointDeVente = await this.prisma.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId, ordre: 1 } },
      select: { id: true },
    });
    const jour = jourConakry(new Date());
    let lots: ElementLot[] = [];
    if (pointDeVente) {
      const candidats = await lireLotsCandidats(this.prisma, pointDeVente.id, [
        stockId,
      ]);
      lots = (candidats.get(stockId) ?? [])
        .sort(comparerFefo)
        .map((c) => elementLot(c, jour));
    }
    return {
      data: masquerCouts(lots, peutVoirMarge),
      message: `${lots.length} lot(s) en stock`,
      success: true as const,
    };
  }

  async corrigerDateLot(
    structureId: string,
    userId: string,
    lotId: string,
    dto: CorrigerLotDto,
    ip?: string | null,
  ) {
    const { user } = await this.accesPharmacie.verifier(structureId, userId);
    const peutVoirMarge = await this.peutVoirMarge(userId);

    const motif = dto.motif?.trim() ?? '';
    if (motif.length < 3) {
      throw new BadRequestException({
        message: MESSAGE_MOTIF_CORRECTION_LOT,
        code: 'MOTIF_REQUIS',
      });
    }
    if (!dto.dateExpiration && dto.sansPeremption !== true) {
      throw new BadRequestException({
        message: MESSAGE_DATE_PEREMPTION_REQUISE_RECEPTION,
        code: 'DATE_PEREMPTION_REQUISE',
      });
    }
    if (dto.dateExpiration && !jourValide(dto.dateExpiration)) {
      throw new BadRequestException({
        message: MESSAGE_DATE_INVALIDE,
        code: 'VALIDATION',
        champs: [{ champ: 'dateExpiration', contraintes: ['dateValide'] }],
      });
    }

    const modifie = await this.prisma.$transaction(async (tx) => {
      const lot = await tx.lotStock.findFirst({
        where: { id: lotId, pointDeVente: { structureId } },
        select: { id: true, stockMedicamentId: true },
      });
      if (!lot) throw new NotFoundException(MESSAGE_LOT_INTROUVABLE);
      await this.mouvementsStock.verrouillerFiches(tx, [lot.stockMedicamentId]);
      // Relu sous le verrou : l'audit « avant » est juste même si une autre correction vient d'aboutir
      const relu = await tx.lotStock.findUniqueOrThrow({
        where: { id: lotId },
        select: { dateExpiration: true },
      });
      const avant = relu.dateExpiration
        ? dateVersJour(relu.dateExpiration)
        : null;
      const apres = dto.dateExpiration ?? null;
      if (avant === apres) return false;
      await tx.lotStock.update({
        where: { id: lotId },
        data: { dateExpiration: apres ? jourVersDate(apres) : null },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'update',
          entityType: 'LotStock',
          entityId: lotId,
          ip: ip ?? null,
          metadata: {
            avant: { dateExpiration: avant },
            apres: { dateExpiration: apres },
            motif,
          },
        },
      });
      return true;
    });

    const l = await this.prisma.lotStock.findUniqueOrThrow({
      where: { id: lotId },
      select: {
        id: true,
        numeroLot: true,
        dateExpiration: true,
        dateReception: true,
        coefficientReception: true,
        coutUnitaire: true,
        lotTechnique: true,
        agregat: { select: { quantite: true } },
      },
    });
    const element = elementLot(
      {
        id: l.id,
        numeroLot: l.numeroLot,
        dateExpiration: l.dateExpiration
          ? dateVersJour(l.dateExpiration)
          : null,
        dateReception: l.dateReception.toISOString(),
        solde: l.agregat?.quantite ?? 0,
        coefficientReception: l.coefficientReception,
        coutUnitaire: l.coutUnitaire,
        lotTechnique: l.lotTechnique,
      },
      jourConakry(new Date()),
    );
    return {
      data: masquerCouts(element, peutVoirMarge),
      message: modifie
        ? 'Date de péremption du lot corrigée.'
        : 'Aucune modification du lot.',
      success: true as const,
    };
  }
}
