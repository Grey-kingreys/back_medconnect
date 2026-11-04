import { exigerEntier } from './quantites';

/** Code du mode de paiement compté physiquement et porteur du fond de caisse. */
export const CODE_ESPECES = 'ESPECES';

export type TypeMouvementCaisse = 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';

export interface LigneComptageCalcul {
  valeurFaciale: number;
  nombre: number;
}

export interface PaiementCalcul {
  mode: string;
  /** Signé : négatif pour une pièce d'annulation. */
  montant: number;
}

export interface MouvementCaisseCalcul {
  type: TypeMouvementCaisse;
  mode: string;
  /** Strictement positif (CHECK du plan 1.5). */
  montant: number;
}

export interface EntreeTheorique {
  /** Codes de TOUS les modes de paiement connus, actifs ou non, dans l'ordre d'affichage. */
  modes: string[];
  /** Total du comptage d'ouverture (0 si absent). */
  fondEspeces: number;
  paiements: PaiementCalcul[];
  mouvements: MouvementCaisseCalcul[];
}

export interface TheoriqueMode {
  mode: string;
  theorique: number;
}

/** Total d'un comptage par coupure : somme de valeur faciale x nombre. */
export function totalComptage(lignes: LigneComptageCalcul[]): number {
  let total = 0;
  for (const l of lignes) {
    exigerEntier(l.valeurFaciale, 'valeurFaciale', 1);
    exigerEntier(l.nombre, 'nombre', 0);
    total += l.valeurFaciale * l.nombre;
  }
  return total;
}

/** Théorique par mode (D474) : fond si espèces, plus paiements et apports, moins prélèvements et remboursements du mode. */
export function calculerTheorique(entree: EntreeTheorique): TheoriqueMode[] {
  exigerEntier(entree.fondEspeces, 'fondEspeces', 0);
  const connus = new Set<string>();
  for (const mode of entree.modes) {
    if (connus.has(mode)) {
      throw new RangeError(`Mode de paiement en double : ${mode}.`);
    }
    connus.add(mode);
  }
  if (entree.fondEspeces > 0 && !connus.has(CODE_ESPECES)) {
    throw new RangeError('Le fond de caisse exige le mode ESPECES.');
  }
  const total = new Map<string, number>(
    entree.modes.map((m) => [m, m === CODE_ESPECES ? entree.fondEspeces : 0]),
  );
  const ajouter = (mode: string, delta: number): void => {
    total.set(mode, (total.get(mode) ?? 0) + delta);
  };
  for (const p of entree.paiements) {
    if (!connus.has(p.mode)) {
      throw new RangeError(`Mode de paiement inconnu : ${p.mode}.`);
    }
    exigerEntier(p.montant, 'montant', Number.MIN_SAFE_INTEGER);
    ajouter(p.mode, p.montant);
  }
  for (const m of entree.mouvements) {
    if (!connus.has(m.mode)) {
      throw new RangeError(`Mode de paiement inconnu : ${m.mode}.`);
    }
    exigerEntier(m.montant, 'montant', 1);
    ajouter(m.mode, m.type === 'APPORT' ? m.montant : -m.montant);
  }
  return entree.modes.map((mode) => {
    const t = total.get(mode) ?? 0;
    return { mode, theorique: t === 0 ? 0 : t };
  });
}

/** Écart signé compté moins théorique, jamais corrigé ; null sans comptage (non rapproché). */
export function ecartCaisse(
  compte: number | null,
  theorique: number,
): number | null {
  exigerEntier(theorique, 'theorique', Number.MIN_SAFE_INTEGER);
  if (compte === null) return null;
  exigerEntier(compte, 'compte', Number.MIN_SAFE_INTEGER);
  const e = compte - theorique;
  return e === 0 ? 0 : e;
}
