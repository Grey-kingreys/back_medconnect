import { coutUnitaireDepuisBoite, exigerEntier } from './quantites';
import { estPerime } from './selection-lots';

/** Plus grand entier enregistrable (colonne Int de PostgreSQL). */
export const ENTIER_MAX = 2147483647;

export interface SaisieLigneReception {
  /** Unités par boîte de la fiche, lu sous verrou. */
  coefficientBoite: number;
  nombreBoites: number | null;
  quantiteUnites: number | null;
  coutAchatBoite: number | null;
  /** AAAA-MM-JJ ou null. */
  dateExpiration: string | null;
  sansPeremption: boolean;
}

export type CodeRefusLigneReception =
  | 'QUANTITE_REQUISE'
  | 'QUANTITE_UNIQUE'
  | 'QUANTITE_TROP_GRANDE'
  | 'DATE_INVALIDE'
  | 'DATE_PEREMPTION_REQUISE'
  | 'DATE_PEREMPTION_PASSEE';

export type LigneReceptionPreparee =
  | {
      ok: true;
      quantiteUm: number;
      coefficientReception: number;
      coutUnitaire: number;
      coutAchatBoite: number | null;
      /** AAAA-MM-JJ, ou null si sans péremption. */
      dateExpiration: string | null;
    }
  | { ok: false; code: CodeRefusLigneReception };

/** Vrai si la chaîne est une date réelle au format AAAA-MM-JJ (2027-02-30 est faux). */
export function jourValide(jour: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return false;
  const [a, m, j] = jour.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return (
    d.getUTCFullYear() === a &&
    d.getUTCMonth() === m - 1 &&
    d.getUTCDate() === j
  );
}

/** Prépare une ligne de réception (D568, D569) ; `jour` = jour courant à Conakry, AAAA-MM-JJ. */
export function preparerLigneReception(
  s: SaisieLigneReception,
  jour: string,
): LigneReceptionPreparee {
  exigerEntier(s.coefficientBoite, 'coefficientBoite', 1);
  if (s.nombreBoites !== null) exigerEntier(s.nombreBoites, 'nombreBoites', 1);
  if (s.quantiteUnites !== null) {
    exigerEntier(s.quantiteUnites, 'quantiteUnites', 1);
  }
  if (s.coutAchatBoite !== null) {
    exigerEntier(s.coutAchatBoite, 'coutAchatBoite', 0);
  }

  if (s.nombreBoites === null && s.quantiteUnites === null) {
    return { ok: false, code: 'QUANTITE_REQUISE' };
  }
  if (s.nombreBoites !== null && s.quantiteUnites !== null) {
    return { ok: false, code: 'QUANTITE_UNIQUE' };
  }
  const quantiteUm =
    s.nombreBoites !== null
      ? s.nombreBoites * s.coefficientBoite
      : (s.quantiteUnites as number);
  if (quantiteUm > ENTIER_MAX)
    return { ok: false, code: 'QUANTITE_TROP_GRANDE' };

  if (s.dateExpiration !== null && !jourValide(s.dateExpiration)) {
    return { ok: false, code: 'DATE_INVALIDE' };
  }
  if (s.dateExpiration === null && !s.sansPeremption) {
    return { ok: false, code: 'DATE_PEREMPTION_REQUISE' };
  }
  if (s.dateExpiration !== null && estPerime(s.dateExpiration, jour)) {
    return { ok: false, code: 'DATE_PEREMPTION_PASSEE' };
  }

  return {
    ok: true,
    quantiteUm,
    coefficientReception: s.coefficientBoite,
    coutUnitaire:
      s.coutAchatBoite === null
        ? 0
        : coutUnitaireDepuisBoite(s.coutAchatBoite, s.coefficientBoite),
    coutAchatBoite: s.coutAchatBoite,
    dateExpiration: s.dateExpiration,
  };
}
