import {
  CODE_ESPECES,
  calculerTheorique,
  ecartCaisse,
  type MouvementCaisseCalcul,
  type PaiementCalcul,
} from '../domaine/caisse';

export interface ModeReferentiel {
  code: string;
  libelle: string;
  actif: boolean;
  comptagePhysique: boolean;
}

export interface EntreeResultats {
  /** TOUS les modes connus, actifs ou non, dans l'ordre d'affichage (ordre, code). */
  modes: ModeReferentiel[];
  /** Total du comptage d'ouverture, 0 sans comptage. */
  fondEspeces: number;
  paiements: PaiementCalcul[];
  mouvements: MouvementCaisseCalcul[];
  /** Total du comptage de fermeture, null sans comptage. */
  totalEspecesCompte: number | null;
  /** Relevés de fermeture des modes sans comptage physique. */
  releves: { mode: string; montant: number }[];
}

export interface ResultatMode {
  mode: string;
  libelle: string;
  theorique: number;
  /** null : non rapproché. */
  compte: number | null;
  ecart: number | null;
}

/**
 * Théorique, compté et écart par mode (D474, D531). Compté des espèces = comptage de
 * fermeture ; compté d'un autre mode = son relevé, sinon null. Un mode figure s'il est
 * actif, ou si son théorique est non nul, ou s'il a un compté.
 */
export function resultatsParMode(entree: EntreeResultats): ResultatMode[] {
  const parCode = new Map(entree.modes.map((m) => [m.code, m]));
  const releves = new Map<string, number>();
  for (const r of entree.releves) {
    if (r.mode === CODE_ESPECES) {
      throw new RangeError(
        'Les espèces se comptent par coupure, pas par relevé.',
      );
    }
    if (!parCode.has(r.mode)) {
      throw new RangeError(`Mode de paiement inconnu : ${r.mode}.`);
    }
    if (releves.has(r.mode)) {
      throw new RangeError(`Relevé en double : ${r.mode}.`);
    }
    releves.set(r.mode, r.montant);
  }
  const theoriques = calculerTheorique({
    modes: entree.modes.map((m) => m.code),
    fondEspeces: entree.fondEspeces,
    paiements: entree.paiements,
    mouvements: entree.mouvements,
  });
  const resultats: ResultatMode[] = [];
  for (const { mode, theorique } of theoriques) {
    const ref = parCode.get(mode) as ModeReferentiel;
    const compte =
      mode === CODE_ESPECES
        ? entree.totalEspecesCompte
        : (releves.get(mode) ?? null);
    if (!ref.actif && theorique === 0 && compte === null) continue;
    resultats.push({
      mode,
      libelle: ref.libelle,
      theorique,
      compte,
      ecart: ecartCaisse(compte, theorique),
    });
  }
  return resultats;
}

/** Commentaire exigé si la valeur absolue de l'écart d'espèces dépasse strictement le seuil (D532). */
export function commentaireEcartRequis(
  ecartEspeces: number | null,
  seuil: number,
): boolean {
  return ecartEspeces !== null && Math.abs(ecartEspeces) > seuil;
}

/** Montant lisible : séparateur de milliers = espace ordinaire, signe conservé (-10 000). */
export function formaterGnf(montant: number): string {
  return String(montant).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
