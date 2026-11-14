import { arrondiGnf, exigerEntier } from './quantites';

/** Plus grand entier enregistrable (colonne Int de PostgreSQL). */
const ENTIER_MAX = 2147483647;

export interface SoldeProduitPv {
  pointDeVenteId: string;
  quantite: number; // agrégat produit, peut être négatif
}
export interface LotAConvertir {
  lotId: string;
  pointDeVenteId: string;
  lotTechnique: boolean;
  coefficientReception: number;
  coutUnitaire: number;
  solde: number; // agrégat du lot, >= 0
}
export interface LotConverti {
  lotId: string;
  pointDeVenteId: string;
  quantiteAvant: number;
  quantiteApres: number;
  correction: number; // quantiteApres - quantiteAvant
  coutUnitaireApres: number;
}
export type PlanMultiplication =
  | {
      ok: true;
      quantiteAvant: number;
      quantiteApres: number;
      lots: LotConverti[];
    }
  | { ok: false; code: 'STOCK_NON_CONVERTIBLE' | 'QUANTITE_TROP_GRANDE' };

/** Vrai si un point de vente a un agrégat produit non nul ou si un lot a un solde positif (D556). */
export function aDuStock(
  produits: readonly SoldeProduitPv[],
  lots: readonly LotAConvertir[],
): boolean {
  return (
    produits.some((p) => p.quantite !== 0) || lots.some((l) => l.solde > 0)
  );
}

/** Plan de la multiplication par le nouveau coefficient (D557). */
export function planifierMultiplication(
  coefficient: number,
  produits: readonly SoldeProduitPv[],
  lots: readonly LotAConvertir[],
): PlanMultiplication {
  exigerEntier(coefficient, 'coefficient', 1);

  const consideres = lots.filter((l) => l.solde > 0);
  // Lot technique (reprise) ou lot reçu par réception ou import : tous comptent des unités par boîte figées à 1.
  // Un lot déjà converti (coefficient autre que 1) est refusé.
  if (consideres.some((l) => l.coefficientReception !== 1)) {
    return { ok: false, code: 'STOCK_NON_CONVERTIBLE' };
  }

  const pointsDeVente = new Set<string>([
    ...produits.map((p) => p.pointDeVenteId),
    ...consideres.map((l) => l.pointDeVenteId),
  ]);
  for (const pv of pointsDeVente) {
    const agregat = produits
      .filter((p) => p.pointDeVenteId === pv)
      .reduce((somme, p) => somme + p.quantite, 0);
    const somme = consideres
      .filter((l) => l.pointDeVenteId === pv)
      .reduce((s, l) => s + l.solde, 0);
    if (agregat !== somme) {
      return { ok: false, code: 'STOCK_NON_CONVERTIBLE' };
    }
  }

  const tries = [...consideres].sort((a, b) =>
    a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0,
  );
  const convertis: LotConverti[] = tries.map((l) => {
    const quantiteApres = l.solde * coefficient;
    return {
      lotId: l.lotId,
      pointDeVenteId: l.pointDeVenteId,
      quantiteAvant: l.solde,
      quantiteApres,
      correction: quantiteApres - l.solde,
      coutUnitaireApres:
        l.coutUnitaire === 0 ? 0 : arrondiGnf(l.coutUnitaire / coefficient),
    };
  });

  const total = convertis.reduce((s, l) => s + l.quantiteApres, 0);
  if (
    convertis.some((l) => l.quantiteApres > ENTIER_MAX) ||
    total > ENTIER_MAX
  ) {
    return { ok: false, code: 'QUANTITE_TROP_GRANDE' };
  }

  return {
    ok: true,
    quantiteAvant: produits.reduce((s, p) => s + p.quantite, 0),
    quantiteApres: total,
    lots: convertis,
  };
}
