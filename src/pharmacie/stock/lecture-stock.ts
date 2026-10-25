import type { Prisma } from 'generated/prisma/client';
import { reliquatLot } from '../domaine/quantites';
import {
  comparerFefo,
  ordonnerLotsPourVente,
  type LotCandidat,
} from '../domaine/selection-lots';

/** Lot lu avec son solde (agrégat du lot). */
export interface LotStockLu {
  id: string;
  numeroLot: string | null;
  dateExpiration: Date | null;
  dateReception: Date;
  coefficientReception: number;
  coutUnitaire: number;
  lotTechnique: boolean;
  solde: number;
}

/** Lot exposé dans `lots` (coutUnitaire retiré par masquerCouts sans marge:read). */
export interface LotExpose {
  id: string;
  numeroLot: string | null;
  dateExpiration: Date | null;
  quantite: number;
  lotTechnique: boolean;
  coutUnitaire: number;
}

export interface ReliquatExpose {
  lotId: string;
  unitesRestantes: number;
}

/** Stock calculé d'une fiche (plan 1.7, D508). */
export interface EtatStockFiche {
  quantite: number;
  quantiteVendable: number;
  dateExpiration: Date | null;
  reliquat: ReliquatExpose[];
  lots: LotExpose[];
}

type ClientLecture = Pick<
  Prisma.TransactionClient,
  'lotStock' | 'agregatStockProduit'
>;

export function dateVersJour(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function jourVersDate(jour: string): Date {
  return new Date(`${jour}T00:00:00.000Z`);
}

function versCandidat(l: LotStockLu): LotCandidat {
  return {
    id: l.id,
    numeroLot: l.numeroLot,
    dateExpiration: l.dateExpiration ? dateVersJour(l.dateExpiration) : null,
    dateReception: l.dateReception.toISOString(),
    solde: l.solde,
    coefficientReception: l.coefficientReception,
    coutUnitaire: l.coutUnitaire,
    lotTechnique: l.lotTechnique,
  };
}

/**
 * Calcul pur : quantité = agrégat produit ; lots exposés = lots à solde positif
 * en ordre FEFO ; quantité vendable et reliquats sur les lots non périmés ; date =
 * celle du lot que la vente prendrait en premier, sinon la plus ancienne des lots
 * restants (tous périmés), sinon null.
 */
export function calculerEtatStock(
  soldeProduit: number,
  lots: readonly LotStockLu[],
  jour: string,
): EtatStockFiche {
  const enStock = lots.filter((l) => l.solde > 0);
  const parId = new Map(enStock.map((l) => [l.id, l]));
  const candidats = enStock.map(versCandidat);
  const ordre = ordonnerLotsPourVente(candidats, jour);

  let dateExpiration: Date | null = null;
  if (ordre.length > 0) {
    dateExpiration = parId.get(ordre[0].id)?.dateExpiration ?? null;
  } else {
    for (const l of enStock) {
      if (
        l.dateExpiration !== null &&
        (dateExpiration === null || l.dateExpiration < dateExpiration)
      ) {
        dateExpiration = l.dateExpiration;
      }
    }
  }

  return {
    quantite: soldeProduit,
    quantiteVendable: ordre.reduce((somme, c) => somme + c.solde, 0),
    dateExpiration,
    reliquat: ordre
      .map((c) => ({
        lotId: c.id,
        unitesRestantes: reliquatLot(c.solde, c.coefficientReception),
      }))
      .filter((r) => r.unitesRestantes > 0),
    lots: [...candidats].sort(comparerFefo).map((c) => {
      const l = parId.get(c.id) as LotStockLu;
      return {
        id: l.id,
        numeroLot: l.numeroLot,
        dateExpiration: l.dateExpiration,
        quantite: l.solde,
        lotTechnique: l.lotTechnique,
        coutUnitaire: l.coutUnitaire,
      };
    }),
  };
}

/**
 * Stock calculé de chaque fiche demandée (une entrée par identifiant, même sans
 * lot), somme sur tous les points de vente de la fiche (un seul en T1, D508).
 * Requêtes successives (utilisable dans une transaction interactive).
 */
export async function lireEtatsStock(
  client: ClientLecture,
  stockMedicamentIds: readonly string[],
  jour: string,
): Promise<Map<string, EtatStockFiche>> {
  const ids = [...new Set(stockMedicamentIds)];
  const resultat = new Map<string, EtatStockFiche>();
  if (ids.length === 0) return resultat;

  const lots = await client.lotStock.findMany({
    where: {
      stockMedicamentId: { in: ids },
      agregat: { is: { quantite: { gt: 0 } } },
    },
    select: {
      id: true,
      stockMedicamentId: true,
      numeroLot: true,
      dateExpiration: true,
      dateReception: true,
      coefficientReception: true,
      coutUnitaire: true,
      lotTechnique: true,
      agregat: { select: { quantite: true } },
    },
  });
  const agregats = await client.agregatStockProduit.findMany({
    where: { stockMedicamentId: { in: ids } },
    select: { stockMedicamentId: true, quantite: true },
  });

  const lotsParFiche = new Map<string, LotStockLu[]>();
  for (const l of lots) {
    const liste = lotsParFiche.get(l.stockMedicamentId) ?? [];
    liste.push({
      id: l.id,
      numeroLot: l.numeroLot,
      dateExpiration: l.dateExpiration,
      dateReception: l.dateReception,
      coefficientReception: l.coefficientReception,
      coutUnitaire: l.coutUnitaire,
      lotTechnique: l.lotTechnique,
      solde: l.agregat?.quantite ?? 0,
    });
    lotsParFiche.set(l.stockMedicamentId, liste);
  }
  const soldeParFiche = new Map<string, number>();
  for (const a of agregats) {
    soldeParFiche.set(
      a.stockMedicamentId,
      (soldeParFiche.get(a.stockMedicamentId) ?? 0) + a.quantite,
    );
  }
  for (const id of ids) {
    resultat.set(
      id,
      calculerEtatStock(
        soldeParFiche.get(id) ?? 0,
        lotsParFiche.get(id) ?? [],
        jour,
      ),
    );
  }
  return resultat;
}

/** Filtre Prisma « au moins un lot vendable » : solde positif et non périmé (le jour même reste vendable). */
export function filtreLotVendable(jour: string): Prisma.LotStockWhereInput {
  return {
    agregat: { is: { quantite: { gt: 0 } } },
    OR: [
      { dateExpiration: null },
      { dateExpiration: { gte: jourVersDate(jour) } },
    ],
  };
}

/** Fiche au contrat de `GET /pharmacie/stock/:structureId` (plan 1.7). */
export function avecStock<F extends { archiveLe: Date | null }>(
  fiche: F,
  etat: EtatStockFiche,
) {
  return {
    ...fiche,
    quantite: etat.quantite,
    disponible: etat.quantite > 0 && fiche.archiveLe === null,
    dateExpiration: etat.dateExpiration,
    quantiteVendable: etat.quantiteVendable,
    reliquat: etat.reliquat,
    lots: etat.lots,
  };
}

/** Fiche des sorties publiques (recherche, détail catalogue) : ni lots ni coûts (D426, D508). */
export function avecStockPublic<F extends object>(
  fiche: F,
  etat: EtatStockFiche,
) {
  return {
    ...fiche,
    quantite: etat.quantiteVendable,
    disponible: etat.quantiteVendable > 0,
    dateExpiration: etat.dateExpiration,
  };
}
