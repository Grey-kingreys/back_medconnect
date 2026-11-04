import { exigerEntier } from './quantites';

export type StatutAllocationCalcul = 'DEFINITIVE' | 'PROVISOIRE' | 'REMPLACEE';

export interface AllocationMarge {
  /** UM, signée (négative dans une pièce d'annulation). */
  quantite: number;
  coutUnitaire: number;
  lotTechnique: boolean;
  statut: StatutAllocationCalcul;
}

export interface LigneMarge {
  /** LigneVente.sousTotal, signé. */
  montantLigne: number;
  allocations: AllocationMarge[];
}

export interface VenteMarge {
  id: string;
  lignes: LigneMarge[];
}

export interface ResultatMarge {
  chiffreAffairesValorise: number;
  coutAlloue: number;
  marge: number;
  nonValorisable: {
    nombreVentes: number;
    nombreLignes: number;
    chiffreAffaires: number;
  };
  provisoires: { nombreLignes: number; chiffreAffaires: number };
}

const sansMoinsZero = (n: number): number => (n === 0 ? 0 : n);

/** Marge réelle depuis les allocations (D475) : provisoires à part par ligne, ventes non valorisables à part, jamais de coût inventé. */
export function calculerMarge(ventes: VenteMarge[]): ResultatMarge {
  let chiffreAffairesValorise = 0;
  let coutAlloue = 0;
  let nvVentes = 0;
  let nvLignes = 0;
  let nvCa = 0;
  let provLignes = 0;
  let provCa = 0;

  for (const vente of ventes) {
    for (const ligne of vente.lignes) {
      exigerEntier(ligne.montantLigne, 'montantLigne', Number.MIN_SAFE_INTEGER);
      for (const a of ligne.allocations) {
        exigerEntier(a.quantite, 'quantite', Number.MIN_SAFE_INTEGER);
        exigerEntier(a.coutUnitaire, 'coutUnitaire', 0);
      }
    }

    const restantes: { ligne: LigneMarge; actives: AllocationMarge[] }[] = [];
    for (const ligne of vente.lignes) {
      const actives = ligne.allocations.filter((a) => a.statut !== 'REMPLACEE');
      if (actives.some((a) => a.statut === 'PROVISOIRE')) {
        provLignes += 1;
        provCa += ligne.montantLigne;
      } else {
        restantes.push({ ligne, actives });
      }
    }
    if (restantes.length === 0) continue;

    const enCause = restantes.filter(
      ({ actives }) =>
        actives.length === 0 ||
        actives.some((a) => a.coutUnitaire === 0 || a.lotTechnique),
    );
    const caRestant = restantes.reduce((s, r) => s + r.ligne.montantLigne, 0);
    if (enCause.length > 0) {
      nvVentes += 1;
      nvLignes += enCause.length;
      nvCa += caRestant;
    } else {
      chiffreAffairesValorise += caRestant;
      for (const { actives } of restantes) {
        for (const a of actives) coutAlloue += a.quantite * a.coutUnitaire;
      }
    }
  }

  return {
    chiffreAffairesValorise: sansMoinsZero(chiffreAffairesValorise),
    coutAlloue: sansMoinsZero(coutAlloue),
    marge: sansMoinsZero(chiffreAffairesValorise - coutAlloue),
    nonValorisable: {
      nombreVentes: sansMoinsZero(nvVentes),
      nombreLignes: sansMoinsZero(nvLignes),
      chiffreAffaires: sansMoinsZero(nvCa),
    },
    provisoires: {
      nombreLignes: sansMoinsZero(provLignes),
      chiffreAffaires: sansMoinsZero(provCa),
    },
  };
}
