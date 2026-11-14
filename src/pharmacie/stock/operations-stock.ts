import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { ENTIER_MAX } from '../domaine/reception';
import {
  motifSortie,
  typeMouvementSortie,
  type RaisonSortie,
} from '../domaine/sortie';
import type { MouvementsStockService } from './mouvements-stock.service';

/**
 * Écritures de stock rejouables : sortie de stock et correction de quantité.
 * Même code pour la route web (refus 409 si le lot n'a pas assez, `tolerant` faux) et pour le
 * rejeu d'un poste desktop (`tolerant` vrai : l'opération est TOUJOURS acceptée, la marchandise
 * est déjà sortie ; la part que le lot ne couvre pas devient un mouvement provisoire sans lot).
 */

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
export const MESSAGE_IDENTIFIANT_CORRECTION =
  'Cet identifiant est déjà utilisé par une autre correction de quantité.';
export const MESSAGE_STOCK_INTROUVABLE_REJEU =
  'Ce médicament est introuvable dans la pharmacie.';
export const MESSAGE_LOT_INTROUVABLE_CORRECTION =
  'Ce lot est introuvable pour ce médicament.';
export function messageSortieLotInsuffisante(solde: number): string {
  return `Ce lot n'a que ${solde} unité(s) en stock : la sortie ne peut pas dépasser ce stock.`;
}
export function messageCorrectionLotNegatif(solde: number): string {
  return `Ce lot n'a que ${solde} unité(s) en stock : la correction ne peut pas le rendre négatif.`;
}

const SUFFIXE_PROVISOIRE = ':provisoire';

type Tx = Prisma.TransactionClient;

export interface TracePoste {
  horodatageLocal?: Date | null;
  posteId?: string | null;
  sequencePoste?: number | null;
}

/** Motif enregistré d'une sortie, ou refus 400 MOTIF_REQUIS. */
export function motifDeSortieOuRefus(
  raison: RaisonSortie | null | undefined,
  commentaire: string | null | undefined,
): { motif: string; raison: RaisonSortie } {
  const resultat = motifSortie(raison ?? null, commentaire ?? null);
  if (!resultat.ok) {
    throw new BadRequestException({
      message:
        resultat.code === 'RAISON_REQUISE'
          ? MESSAGE_RAISON_SORTIE_REQUISE
          : MESSAGE_COMMENTAIRE_SORTIE_REQUIS,
      code: 'MOTIF_REQUIS',
    });
  }
  return { motif: resultat.motif, raison: raison as RaisonSortie };
}

/** Rend l'identité du médicament, ou refuse en 404 STOCK_INTROUVABLE (rejeu d'un poste). */
export async function ficheDeLaPharmacie(
  tx: Tx,
  structureId: string,
  stockId: string,
): Promise<{ id: string; nom: string; coefficientBoite: number }> {
  const fiche = await tx.stockMedicament.findFirst({
    where: { id: stockId, structureId },
    select: {
      id: true,
      coefficientBoite: true,
      medicament: { select: { nom: true } },
    },
  });
  if (!fiche) {
    throw new NotFoundException({
      message: MESSAGE_STOCK_INTROUVABLE_REJEU,
      code: 'STOCK_INTROUVABLE',
    });
  }
  return {
    id: fiche.id,
    nom: fiche.medicament.nom,
    coefficientBoite: fiche.coefficientBoite,
  };
}

/**
 * Une écriture porte déjà cet identifiant ? Faux si non, vrai si elle est du même point de vente
 * (rejeu), refus 409 IDENTIFIANT_DEJA_UTILISE si elle est d'un autre.
 */
export async function ecritureDejaFaite(
  tx: Tx,
  evenementId: string,
  pointDeVenteId: string,
  messageConflit: string,
): Promise<boolean> {
  const existant = await tx.mouvementStock.findFirst({
    where: {
      evenementId: { in: [evenementId, evenementId + SUFFIXE_PROVISOIRE] },
    },
    select: { pointDeVenteId: true },
  });
  if (!existant) return false;
  if (existant.pointDeVenteId !== pointDeVenteId) {
    throw new ConflictException({
      message: messageConflit,
      code: 'IDENTIFIANT_DEJA_UTILISE',
    });
  }
  return true;
}

export interface ParametresSortie extends TracePoste {
  structureId: string;
  pointDeVenteId: string;
  auteurId: string;
  idSortie: string;
  stockId: string;
  lotId: string;
  unite: 'BOITE' | 'UNITE';
  quantite: number;
  motif: string;
  raison: RaisonSortie;
  /** Vrai pour le rejeu d'un poste : jamais de refus pour stock insuffisant ou lot disparu. */
  tolerant: boolean;
  ip?: string | null;
}

export interface ResultatSortie {
  cree: boolean;
  nom: string | null;
  /** Unités sorties du lot. */
  partieLot: number;
  /** Unités sorties sans lot (stock insuffisant ou lot disparu), à régulariser. */
  partieProvisoire: number;
  soldeProduit: number | null;
}

/** Écrit une sortie de stock dans la transaction de l'appelant (accès à la pharmacie déjà vérifié par lui). */
export async function ecrireSortieStock(
  mouvements: MouvementsStockService,
  tx: Tx,
  p: ParametresSortie,
): Promise<ResultatSortie> {
  const evenementId = `sortie:${p.idSortie}`;
  const type = typeMouvementSortie(p.raison);

  if (
    await ecritureDejaFaite(
      tx,
      evenementId,
      p.pointDeVenteId,
      MESSAGE_IDENTIFIANT_SORTIE,
    )
  ) {
    return {
      cree: false,
      nom: null,
      partieLot: 0,
      partieProvisoire: 0,
      soldeProduit: null,
    };
  }

  const fiche = p.tolerant
    ? await ficheDeLaPharmacie(tx, p.structureId, p.stockId)
    : null;

  const lot = await tx.lotStock.findFirst({
    where: {
      id: p.lotId,
      stockMedicamentId: p.stockId,
      pointDeVenteId: p.pointDeVenteId,
    },
    select: { id: true },
  });
  if (!lot && !p.tolerant) {
    throw new NotFoundException(MESSAGE_LOT_INTROUVABLE_SORTIE);
  }

  await mouvements.verrouillerFiches(tx, [p.stockId]);

  const sous = lot
    ? await tx.lotStock.findUniqueOrThrow({
        where: { id: p.lotId },
        select: {
          coefficientReception: true,
          agregat: { select: { quantite: true } },
        },
      })
    : null;
  const solde = sous?.agregat?.quantite ?? 0;
  const coefficient =
    sous?.coefficientReception ?? fiche?.coefficientBoite ?? 1;
  const quantiteUm =
    p.unite === 'BOITE' ? p.quantite * coefficient : p.quantite;
  if (quantiteUm > ENTIER_MAX) {
    throw new BadRequestException({
      message: MESSAGE_SORTIE_QUANTITE_TROP_GRANDE,
      code: 'VALIDATION',
      champs: [{ champ: 'quantite', contraintes: ['quantiteMaximale'] }],
    });
  }
  if (!p.tolerant && quantiteUm > solde) {
    throw new ConflictException({
      message: messageSortieLotInsuffisante(solde),
      code: 'STOCK_LOT_NEGATIF',
    });
  }

  const partieLot = lot ? Math.min(quantiteUm, solde) : 0;
  const partieProvisoire = quantiteUm - partieLot;
  const commun = {
    pointDeVenteId: p.pointDeVenteId,
    stockMedicamentId: p.stockId,
    type,
    pieceOrigineType: 'SORTIE_MANUELLE' as const,
    pieceOrigineId: p.idSortie,
    motif: p.motif,
    auteurId: p.auteurId,
    horodatageLocal: p.horodatageLocal ?? null,
    posteId: p.posteId ?? null,
    sequencePoste: p.sequencePoste ?? null,
  };
  let premier: string | null = null;
  let soldeProduit: number | null = null;
  if (partieLot > 0) {
    const ecrit = await mouvements.ecrire(tx, {
      ...commun,
      evenementId,
      lotId: p.lotId,
      quantite: -partieLot,
    });
    premier = ecrit.mouvement.id;
    soldeProduit = ecrit.soldeProduit;
  }
  if (partieProvisoire > 0) {
    const ecrit = await mouvements.ecrire(tx, {
      ...commun,
      evenementId: evenementId + SUFFIXE_PROVISOIRE,
      lotId: null,
      quantite: -partieProvisoire,
    });
    premier ??= ecrit.mouvement.id;
    soldeProduit = ecrit.soldeProduit;
  }

  await tx.auditLog.create({
    data: {
      userId: p.auteurId,
      action: 'create',
      entityType: 'MouvementStock',
      entityId: premier as string,
      ip: p.ip ?? null,
      metadata: {
        type,
        quantite: quantiteUm,
        stockId: p.stockId,
        lotId: p.lotId,
        raison: p.raison,
        ...(partieProvisoire > 0
          ? { quantiteProvisoire: partieProvisoire }
          : {}),
      },
    },
  });
  return {
    cree: true,
    nom: fiche?.nom ?? null,
    partieLot,
    partieProvisoire,
    soldeProduit,
  };
}

export interface ParametresCorrection extends TracePoste {
  pointDeVenteId: string;
  auteurId: string;
  stockId: string;
  lotId: string;
  /** Signée, en unités minimales, non nulle. */
  variation: number;
  motif: string;
  notes?: string | null;
  /** Identifiant client facultatif : rend la correction idempotente. */
  id?: string | null;
  tolerant: boolean;
}

export interface ResultatCorrection {
  cree: boolean;
  /** Unités retirées sans lot (variation négative au-delà du solde du lot, ou lot disparu). */
  partieProvisoire: number;
  soldeProduit: number | null;
}

/** La correction `id` est-elle déjà enregistrée ? (409 si l'identifiant est celui d'une autre pharmacie.) */
export function correctionDejaFaite(
  tx: Tx,
  id: string,
  pointDeVenteId: string,
): Promise<boolean> {
  return ecritureDejaFaite(
    tx,
    `correction:${id}`,
    pointDeVenteId,
    MESSAGE_IDENTIFIANT_CORRECTION,
  );
}

/** Écrit une correction de quantité sur un lot, dans la transaction de l'appelant (fiche verrouillée par lui). */
export async function ecrireCorrectionQuantite(
  mouvements: MouvementsStockService,
  tx: Tx,
  p: ParametresCorrection,
): Promise<ResultatCorrection> {
  if (p.id && (await correctionDejaFaite(tx, p.id, p.pointDeVenteId))) {
    return { cree: false, partieProvisoire: 0, soldeProduit: null };
  }
  const evenementId = p.id ? `correction:${p.id}` : undefined;

  const lot = await tx.lotStock.findFirst({
    where: {
      id: p.lotId,
      stockMedicamentId: p.stockId,
      pointDeVenteId: p.pointDeVenteId,
    },
    select: { id: true, agregat: { select: { quantite: true } } },
  });
  if (!lot) {
    if (!p.tolerant) {
      throw new NotFoundException(MESSAGE_LOT_INTROUVABLE_CORRECTION);
    }
    if (p.variation > 0) {
      throw new NotFoundException({
        message: MESSAGE_LOT_INTROUVABLE_CORRECTION,
        code: 'LOT_INTROUVABLE',
      });
    }
  }
  const solde = lot?.agregat?.quantite ?? 0;
  if (!p.tolerant && solde + p.variation < 0) {
    throw new ConflictException({
      message: messageCorrectionLotNegatif(solde),
      code: 'STOCK_LOT_NEGATIF',
    });
  }

  const notes = p.notes?.trim();
  if (notes) {
    await tx.stockMedicament.update({
      where: { id: p.stockId },
      data: { notes },
    });
  }

  const commun = {
    pointDeVenteId: p.pointDeVenteId,
    stockMedicamentId: p.stockId,
    type: 'CORRECTION' as const,
    pieceOrigineType: 'AJUSTEMENT' as const,
    pieceOrigineId: p.id ?? null,
    motif: p.motif,
    auteurId: p.auteurId,
    horodatageLocal: p.horodatageLocal ?? null,
    posteId: p.posteId ?? null,
    sequencePoste: p.sequencePoste ?? null,
  };
  let partieLot = p.variation;
  let partieProvisoire = 0;
  if (p.variation < 0) {
    const sortie = -p.variation;
    const couverte = lot ? Math.min(sortie, solde) : 0;
    partieLot = -couverte;
    partieProvisoire = sortie - couverte;
  }
  let soldeProduit: number | null = null;
  if (partieLot !== 0) {
    const ecrit = await mouvements.ecrire(tx, {
      ...commun,
      ...(evenementId ? { evenementId } : {}),
      lotId: p.lotId,
      quantite: partieLot,
    });
    soldeProduit = ecrit.soldeProduit;
  }
  if (partieProvisoire > 0) {
    const ecrit = await mouvements.ecrire(tx, {
      ...commun,
      ...(evenementId ? { evenementId: evenementId + SUFFIXE_PROVISOIRE } : {}),
      lotId: null,
      quantite: -partieProvisoire,
    });
    soldeProduit = ecrit.soldeProduit;
  }
  return { cree: true, partieProvisoire, soldeProduit };
}
