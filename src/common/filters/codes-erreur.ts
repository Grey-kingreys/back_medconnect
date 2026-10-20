/**
 * Codes machine stables, renvoyés dans le champ `code` du corps d'erreur et lus
 * par l'application mobile. Le web ne lit que `message`. TB2 complétera ce catalogue.
 */
export const CODES_ERREUR = [
  'SESSION_EXPIREE',
  'SESSION_REVOQUEE',
  'REFRESH_REUTILISE',
  'COMPTE_DESACTIVE',
  'VALIDATION',
] as const;

export type CodeErreur = (typeof CODES_ERREUR)[number];

export function estCodeErreur(valeur: unknown): valeur is CodeErreur {
  return (
    typeof valeur === 'string' &&
    (CODES_ERREUR as readonly string[]).includes(valeur)
  );
}
