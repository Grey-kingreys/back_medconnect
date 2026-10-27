import type { AllocationCalculee, LotCandidat } from './selection-lots';
import { comparerFefo, estPerime } from './selection-lots';
import { exigerEntier } from './quantites';

export interface ProvisoireAResoudre {
  allocationId: string;
  /** Horodatage de création de la vente, ISO 8601. */
  venteCreeLe: string;
  /** Unités minimales en attente, au moins 1. */
  quantite: number;
}

export interface ResolutionPlanifiee {
  allocationId: string;
  /** Lots pris, dans l'ordre FEFO, une entrée par lot (champs du lot recopiés). */
  prises: AllocationCalculee[];
  /** Unités qui restent en attente (0 si tout est couvert). */
  reste: number;
}

/** Plan de résolution des allocations provisoires d'une fiche (D576). */
export function planifierResolution(
  provisoires: readonly ProvisoireAResoudre[],
  lots: readonly LotCandidat[],
  jour: string,
): ResolutionPlanifiee[] {
  // 1. Contrôles
  const allocationsVues = new Set<string>();
  for (const p of provisoires) {
    exigerEntier(p.quantite, 'quantite', 1);
    if (Number.isNaN(Date.parse(p.venteCreeLe))) {
      throw new RangeError(
        `Date de vente invalide pour l'allocation ${p.allocationId} (reçu : ${p.venteCreeLe}).`,
      );
    }
    if (allocationsVues.has(p.allocationId)) {
      throw new RangeError(
        `Allocation en double dans le plan de résolution : ${p.allocationId}.`,
      );
    }
    allocationsVues.add(p.allocationId);
  }
  const lotsVus = new Set<string>();
  for (const l of lots) {
    exigerEntier(l.solde, 'solde', 0);
    if (lotsVus.has(l.id)) {
      throw new RangeError(
        `Lot en double dans le plan de résolution : ${l.id}.`,
      );
    }
    lotsVus.add(l.id);
  }

  // 2. Lots utilisables, soldes décrémentés en mémoire
  const utilisables = lots
    .filter((l) => l.solde > 0 && !estPerime(l.dateExpiration, jour))
    .sort(comparerFefo)
    .map((lot) => ({ lot, restant: lot.solde }));

  // 3. Ventes les plus anciennes d'abord
  const ordonnees = [...provisoires].sort((a, b) => {
    const diff = Date.parse(a.venteCreeLe) - Date.parse(b.venteCreeLe);
    if (diff !== 0) return diff;
    return a.allocationId < b.allocationId
      ? -1
      : a.allocationId > b.allocationId
        ? 1
        : 0;
  });

  // 4. Prises
  const plan: ResolutionPlanifiee[] = [];
  for (const p of ordonnees) {
    const prises: AllocationCalculee[] = [];
    let reste = p.quantite;
    for (const u of utilisables) {
      if (reste === 0) break;
      const prise = Math.min(reste, u.restant);
      if (prise <= 0) continue;
      u.restant -= prise;
      reste -= prise;
      prises.push({
        lotId: u.lot.id,
        numeroLot: u.lot.numeroLot,
        dateExpiration: u.lot.dateExpiration,
        quantite: prise,
        coutUnitaire: u.lot.coutUnitaire,
        lotTechnique: u.lot.lotTechnique,
      });
    }
    if (prises.length === 0) break;
    plan.push({ allocationId: p.allocationId, prises, reste });
  }
  return plan;
}
