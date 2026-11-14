import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ConditionnementOuvert,
  LotStock,
  MouvementStock,
  Prisma,
} from 'generated/prisma/client';
import type { TypeMouvementStock, TypePiece } from 'generated/prisma/enums';
import { reliquatLot } from '../domaine/quantites';
import { estDoublonSur, violeContrainte } from './erreurs-base';

export const MESSAGE_CONDITIONNEMENT_DEJA_OUVERT =
  "Une boîte de ce lot est déjà entamée : terminez-la avant d'en ouvrir une autre.";
export const MESSAGE_STOCK_LOT_INSUFFISANT =
  "Ce lot n'a pas assez de stock pour cette sortie.";

export const MESSAGE_LOT_CONTENU_DIFFERENT =
  'Cet identifiant de lot existe déjà avec un contenu différent (quantité, numéro, péremption ou coût).';
export const MESSAGE_LOT_SANS_MOUVEMENT =
  'Ce lot existe mais son premier mouvement est introuvable : le stock est incohérent.';
export const MESSAGE_LOT_AUTRE_FICHE =
  'Cet identifiant de lot appartient déjà à un autre produit.';

/** Pièces qui peuvent porter un mouvement sans lot (stock négatif provisoire, O11, D404). */
export const PIECES_SANS_LOT: readonly TypePiece[] = [
  'VENTE',
  'ANNULATION',
  'RESOLUTION',
  // Rejeu d'une sortie ou d'une correction faite hors ligne sur un poste : la part que le lot ne couvre plus
  'SORTIE_MANUELLE',
  'AJUSTEMENT',
];
/** Pièces dont le motif est obligatoire. */
export const PIECES_AVEC_MOTIF: readonly TypePiece[] = [
  'SORTIE_MANUELLE',
  'AJUSTEMENT',
];

export interface MouvementAEcrire {
  /** Identifiant stable (UUID client hors ligne) ; UUID serveur par défaut. */
  evenementId?: string;
  pointDeVenteId: string;
  stockMedicamentId: string;
  lotId: string | null;
  type: TypeMouvementStock;
  /** Signée, en unités minimales ; nulle seulement pour un INVENTAIRE (D417). */
  quantite: number;
  pieceOrigineType: TypePiece;
  pieceOrigineId?: string | null;
  motif?: string | null;
  auteurId?: string | null;
  horodatageLocal?: Date | null;
  posteId?: string | null;
  sequencePoste?: number | null;
  /** Horodatage serveur explicite (qualification, D561) ; défaut de la base sinon. */
  horodatageServeur?: Date | null;
}

export interface MouvementEcrit {
  mouvement: MouvementStock;
  /** Solde du lot après le mouvement, null pour un mouvement sans lot. */
  soldeLot: number | null;
  /** Agrégat produit du point de vente après le mouvement. */
  soldeProduit: number;
}

/** Champs facultatifs d'une ligne de facture fournisseur, enregistrés tels quels sur le lot. */
export interface ChampsFactureLot {
  codeArticleFournisseur?: string | null;
  codeBarres?: string | null;
  quantiteCommandee?: number | null;
  prixPublicBoite?: number | null;
  codeTva?: string | null;
  tauxTvaPourMille?: number | null;
  montantHTLigne?: number | null;
  colisage?: number | null;
  tableau?: string | null;
  bonPreparation?: string | null;
}

export interface NouveauLot {
  /**
   * Identifiant imposé par l'appelant (lot créé hors ligne sur un poste desktop, identifiant stable).
   * Idempotence : un lot déjà créé sous cet identifiant est rendu tel quel, sans doublon ni second mouvement.
   */
  lotId?: string;
  stockMedicamentId: string;
  pointDeVenteId: string;
  numeroLot: string | null;
  dateExpiration: Date | null;
  /** Quantité reçue en unités minimales, au moins 1. */
  quantite: number;
  coutUnitaire: number;
  coutAchatBoite: number | null;
  coefficientReception: number;
  fournisseurId: string | null;
  receptionId: string | null;
  lotTechnique: boolean;
  auteurId: string | null;
  pieceOrigineType: TypePiece;
  pieceOrigineId: string | null;
  motif: string | null;
  evenementId?: string;
  dateReception?: Date;
  /** Type du premier mouvement : RECEPTION par défaut, INVENTAIRE pour un lot trouvé à l'inventaire. */
  typeMouvement?: 'RECEPTION' | 'INVENTAIRE';
  /** Facture fournisseur (réception seulement). */
  facture?: ChampsFactureLot;
}

export interface OuvertureConditionnement {
  stockMedicamentId: string;
  lotId: string;
  pointDeVenteId: string;
  unitesParConditionnement: number;
  ouvertParId: string | null;
  ouvertParPieceId: string | null;
}

export interface QualificationLot {
  lotId: string;
  stockMedicamentId: string;
  pointDeVenteId: string;
  /** Nouveau coefficient de la fiche, au moins 2. */
  coefficient: number;
  coutUnitaire: number;
  /** solde x (coefficient - 1), au moins 1. */
  correction: number;
  auteurId: string | null;
  horodatageServeur: Date;
}

/** Clé du verrou consultatif d'une fiche (D433, D507). */
export function cleVerrouFiche(stockMedicamentId: string): string {
  return `medconnecte:stock:${stockMedicamentId}`;
}

/** Contrôles de programmation : une entrée impossible lève une RangeError (le service appelant filtre avant). */
export function validerMouvement(m: MouvementAEcrire): void {
  if (!Number.isInteger(m.quantite)) {
    throw new RangeError(
      `La quantité d'un mouvement doit être un entier (reçu : ${m.quantite}).`,
    );
  }
  if (m.quantite === 0 && m.type !== 'INVENTAIRE') {
    throw new RangeError(`Un mouvement ${m.type} ne peut pas être nul.`);
  }
  if (m.lotId === null && !PIECES_SANS_LOT.includes(m.pieceOrigineType)) {
    throw new RangeError(
      `Un mouvement sans lot n'est permis que pour une vente, une annulation, une résolution ou le rejeu d'une sortie ou d'une correction (reçu : ${m.pieceOrigineType}).`,
    );
  }
  if (
    PIECES_AVEC_MOTIF.includes(m.pieceOrigineType) &&
    !(m.motif ?? '').trim()
  ) {
    throw new RangeError(
      `Le motif est obligatoire pour une pièce ${m.pieceOrigineType}.`,
    );
  }
}

const MOTIF_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jourDe = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/** Un lot déjà créé a le contenu demandé : quantité reçue, numéro, péremption (jour), coûts et coefficient. */
export function memeContenu(existant: LotStock, l: NouveauLot): boolean {
  return (
    existant.quantiteRecue === l.quantite &&
    existant.numeroLot === l.numeroLot &&
    jourDe(existant.dateExpiration) === jourDe(l.dateExpiration) &&
    existant.coutUnitaire === l.coutUnitaire &&
    (existant.coutAchatBoite ?? null) === (l.coutAchatBoite ?? null) &&
    existant.coefficientReception === l.coefficientReception
  );
}

export function validerNouveauLot(l: NouveauLot): void {
  if (l.lotId !== undefined && !MOTIF_UUID.test(l.lotId)) {
    throw new RangeError(
      `Lot invalide : lotId doit être un UUID (reçu : ${l.lotId}).`,
    );
  }
  const entiers: Array<[string, number, number]> = [
    ['quantite', l.quantite, 1],
    ['coutUnitaire', l.coutUnitaire, 0],
    ['coefficientReception', l.coefficientReception, 1],
  ];
  for (const [champ, valeur, minimum] of entiers) {
    if (!Number.isInteger(valeur) || valeur < minimum) {
      throw new RangeError(`Lot invalide : ${champ} (reçu : ${valeur}).`);
    }
  }
}

export function validerQualificationLot(q: QualificationLot): void {
  const entiers: Array<[string, number, number]> = [
    ['coefficient', q.coefficient, 2],
    ['correction', q.correction, 1],
    ['coutUnitaire', q.coutUnitaire, 0],
  ];
  for (const [champ, valeur, minimum] of entiers) {
    if (!Number.isInteger(valeur) || valeur < minimum) {
      throw new RangeError(
        `Qualification invalide : ${champ} (reçu : ${valeur}).`,
      );
    }
  }
}

/**
 * Seul écrivain du journal de stock, des lots et des conditionnements ouverts
 * (D401, D500, D507). Chaque méthode s'exécute dans la transaction de l'appelant.
 * Ordre des verrous : verrou de ligne de la fiche (s'il est pris) puis verrou
 * consultatif ; un écrivain multi fiches verrouille toutes ses fiches d'abord.
 */
@Injectable()
export class MouvementsStockService {
  /** Verrous consultatifs de transaction, identifiants dédoublonnés et triés (pas d'interblocage). */
  async verrouillerFiches(
    tx: Prisma.TransactionClient,
    stockMedicamentIds: readonly string[],
  ): Promise<void> {
    const tries = [...new Set(stockMedicamentIds)].sort();
    for (const id of tries) {
      // $executeRaw : $queryRaw ne sait pas lire la colonne void renvoyée (D507)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cleVerrouFiche(id)}, 0))`;
    }
  }

  /** Écrit un mouvement (agrégats tenus par trigger) puis maintient le conditionnement ouvert du lot. */
  async ecrire(
    tx: Prisma.TransactionClient,
    m: MouvementAEcrire,
  ): Promise<MouvementEcrit> {
    validerMouvement(m);
    await this.verrouillerFiches(tx, [m.stockMedicamentId]);

    let mouvement: MouvementStock;
    try {
      mouvement = await tx.mouvementStock.create({
        data: {
          evenementId: m.evenementId ?? randomUUID(),
          pointDeVenteId: m.pointDeVenteId,
          stockMedicamentId: m.stockMedicamentId,
          lotId: m.lotId,
          type: m.type,
          quantite: m.quantite,
          pieceOrigineType: m.pieceOrigineType,
          pieceOrigineId: m.pieceOrigineId ?? null,
          motif: m.motif?.trim() ? m.motif.trim() : null,
          auteurId: m.auteurId ?? null,
          horodatageLocal: m.horodatageLocal ?? null,
          posteId: m.posteId ?? null,
          sequencePoste: m.sequencePoste ?? null,
          ...(m.horodatageServeur
            ? { horodatageServeur: m.horodatageServeur }
            : {}),
        },
      });
    } catch (erreur) {
      if (violeContrainte(erreur, 'AgregatStockLot_quantite_check')) {
        throw new ConflictException({
          message: MESSAGE_STOCK_LOT_INSUFFISANT,
          code: 'STOCK_LOT_NEGATIF',
        });
      }
      throw erreur;
    }

    let soldeLot: number | null = null;
    if (m.lotId !== null) {
      const lot = await tx.lotStock.findUniqueOrThrow({
        where: { id: m.lotId },
        select: { coefficientReception: true },
      });
      const agregat = await tx.agregatStockLot.findUniqueOrThrow({
        where: { lotId: m.lotId },
        select: { quantite: true },
      });
      soldeLot = agregat.quantite;
      await this.maintenirConditionnement(tx, {
        stockMedicamentId: m.stockMedicamentId,
        lotId: m.lotId,
        pointDeVenteId: m.pointDeVenteId,
        coefficientReception: lot.coefficientReception,
        soldeLot,
        auteurId: mouvement.auteurId,
        pieceOrigineId: mouvement.pieceOrigineId,
      });
    }

    const produit = await tx.agregatStockProduit.findUniqueOrThrow({
      where: {
        stockMedicamentId_pointDeVenteId: {
          stockMedicamentId: m.stockMedicamentId,
          pointDeVenteId: m.pointDeVenteId,
        },
      },
      select: { quantite: true },
    });
    return { mouvement, soldeLot, soldeProduit: produit.quantite };
  }

  /** Crée un lot et son premier mouvement RECEPTION dans la même transaction (D500). */
  async creerLot(
    tx: Prisma.TransactionClient,
    l: NouveauLot,
  ): Promise<{ lot: LotStock; reception: MouvementEcrit }> {
    validerNouveauLot(l);
    await this.verrouillerFiches(tx, [l.stockMedicamentId]);
    if (l.lotId !== undefined) {
      const existant = await tx.lotStock.findUnique({ where: { id: l.lotId } });
      if (existant) {
        // Rejeu d'un lot créé hors ligne : même identifiant, même fiche et même point de vente = rien à refaire.
        if (
          existant.stockMedicamentId !== l.stockMedicamentId ||
          existant.pointDeVenteId !== l.pointDeVenteId
        ) {
          throw new ConflictException({
            message: MESSAGE_LOT_AUTRE_FICHE,
            code: 'IDENTIFIANT_DEJA_UTILISE',
          });
        }
        if (!memeContenu(existant, l)) {
          throw new ConflictException({
            message: MESSAGE_LOT_CONTENU_DIFFERENT,
            code: 'IDENTIFIANT_DEJA_UTILISE',
          });
        }
        return this.lotDejaCree(tx, existant);
      }
    }
    const lot = await tx.lotStock.create({
      data: {
        ...(l.lotId !== undefined ? { id: l.lotId } : {}),
        stockMedicamentId: l.stockMedicamentId,
        pointDeVenteId: l.pointDeVenteId,
        numeroLot: l.numeroLot,
        dateExpiration: l.dateExpiration,
        quantiteRecue: l.quantite,
        coutUnitaire: l.coutUnitaire,
        coutAchatBoite: l.coutAchatBoite,
        coefficientReception: l.coefficientReception,
        fournisseurId: l.fournisseurId,
        receptionId: l.receptionId,
        dateReception: l.dateReception ?? new Date(),
        lotTechnique: l.lotTechnique,
        auteurId: l.auteurId,
        ...(l.facture ?? {}),
      },
    });
    const reception = await this.ecrire(tx, {
      evenementId: l.evenementId,
      pointDeVenteId: l.pointDeVenteId,
      stockMedicamentId: l.stockMedicamentId,
      lotId: lot.id,
      type: l.typeMouvement ?? 'RECEPTION',
      quantite: l.quantite,
      pieceOrigineType: l.pieceOrigineType,
      pieceOrigineId: l.pieceOrigineId,
      motif: l.motif,
      auteurId: l.auteurId,
    });
    return { lot, reception };
  }

  /** Résultat d'un lot déjà créé : le lot et son premier mouvement (réception ou inventaire), avec les soldes actuels. */
  private async lotDejaCree(
    tx: Prisma.TransactionClient,
    lot: LotStock,
  ): Promise<{ lot: LotStock; reception: MouvementEcrit }> {
    const mouvement = await tx.mouvementStock.findFirst({
      where: { lotId: lot.id, type: { in: ['RECEPTION', 'INVENTAIRE'] } },
      orderBy: [{ horodatageServeur: 'asc' }, { id: 'asc' }],
    });
    if (!mouvement) {
      throw new InternalServerErrorException({
        message: MESSAGE_LOT_SANS_MOUVEMENT,
        code: 'LOT_SANS_MOUVEMENT',
      });
    }
    const agregatLot = await tx.agregatStockLot.findUniqueOrThrow({
      where: { lotId: lot.id },
      select: { quantite: true },
    });
    const produit = await tx.agregatStockProduit.findUniqueOrThrow({
      where: {
        stockMedicamentId_pointDeVenteId: {
          stockMedicamentId: lot.stockMedicamentId,
          pointDeVenteId: lot.pointDeVenteId,
        },
      },
      select: { quantite: true },
    });
    return {
      lot,
      reception: {
        mouvement,
        soldeLot: agregatLot.quantite,
        soldeProduit: produit.quantite,
      },
    };
  }

  /** Multiplie un lot technique à la qualification de sa fiche (D557) : lot mis à jour puis mouvement CORRECTION. */
  async qualifierLotTechnique(
    tx: Prisma.TransactionClient,
    q: QualificationLot,
  ): Promise<MouvementEcrit> {
    validerQualificationLot(q);
    await this.verrouillerFiches(tx, [q.stockMedicamentId]);
    await tx.lotStock.update({
      where: { id: q.lotId },
      data: {
        coefficientReception: q.coefficient,
        coutUnitaire: q.coutUnitaire,
      },
    });
    return this.ecrire(tx, {
      evenementId: `qualification:${q.lotId}`,
      pointDeVenteId: q.pointDeVenteId,
      stockMedicamentId: q.stockMedicamentId,
      lotId: q.lotId,
      type: 'CORRECTION',
      quantite: q.correction,
      pieceOrigineType: 'QUALIFICATION',
      pieceOrigineId: q.stockMedicamentId,
      motif: `Qualification de la fiche : ${q.coefficient} unités par boîte`,
      auteurId: q.auteurId,
      horodatageServeur: q.horodatageServeur,
    });
  }

  /** Ouvre un conditionnement ; une seconde ouverture du même lot est refusée par l'index partiel (CA6). */
  async ouvrirConditionnement(
    tx: Prisma.TransactionClient,
    o: OuvertureConditionnement,
  ): Promise<ConditionnementOuvert> {
    await this.verrouillerFiches(tx, [o.stockMedicamentId]);
    try {
      return await tx.conditionnementOuvert.create({
        data: {
          stockMedicamentId: o.stockMedicamentId,
          lotId: o.lotId,
          pointDeVenteId: o.pointDeVenteId,
          unitesParConditionnement: o.unitesParConditionnement,
          ouvertParId: o.ouvertParId,
          ouvertParPieceId: o.ouvertParPieceId,
        },
      });
    } catch (erreur) {
      if (estDoublonSur(erreur, 'ConditionnementOuvert')) {
        throw new ConflictException({
          message: MESSAGE_CONDITIONNEMENT_DEJA_OUVERT,
          code: 'CONDITIONNEMENT_DEJA_OUVERT',
        });
      }
      throw erreur;
    }
  }

  /** La ligne ouverte existe si et seulement si le reliquat dérivé du lot est non nul (D405). */
  private async maintenirConditionnement(
    tx: Prisma.TransactionClient,
    e: {
      stockMedicamentId: string;
      lotId: string;
      pointDeVenteId: string;
      coefficientReception: number;
      soldeLot: number;
      auteurId: string | null;
      pieceOrigineId: string | null;
    },
  ): Promise<void> {
    const reliquat = reliquatLot(e.soldeLot, e.coefficientReception);
    let ouvert = await tx.conditionnementOuvert.findFirst({
      where: {
        stockMedicamentId: e.stockMedicamentId,
        lotId: e.lotId,
        pointDeVenteId: e.pointDeVenteId,
        fermeLe: null,
      },
    });
    if (
      ouvert &&
      (reliquat === 0 ||
        ouvert.unitesParConditionnement !== e.coefficientReception)
    ) {
      await tx.conditionnementOuvert.update({
        where: { id: ouvert.id },
        data: { fermeLe: new Date() },
      });
      ouvert = null;
    }
    if (reliquat > 0 && !ouvert) {
      await this.ouvrirConditionnement(tx, {
        stockMedicamentId: e.stockMedicamentId,
        lotId: e.lotId,
        pointDeVenteId: e.pointDeVenteId,
        unitesParConditionnement: e.coefficientReception,
        ouvertParId: e.auteurId,
        ouvertParPieceId: e.pieceOrigineId,
      });
    }
  }
}
