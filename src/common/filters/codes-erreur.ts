/**
 * Codes machine stables, renvoyés dans le champ `code` du corps d'erreur et lus
 * par l'application mobile. Le web ne lit que `message`. Ajout pur : le corps
 * garde `statusCode`, `message` et `error`.
 */
export const CODES_ERREUR = [
  // Session expirée, se reconnecter.
  'SESSION_EXPIREE',
  // Session déconnectée depuis un autre appareil ou par sécurité.
  'SESSION_REVOQUEE',
  // Refresh déjà utilisé, session révoquée par sécurité.
  'REFRESH_REUTILISE',
  // Compte désactivé par un administrateur.
  'COMPTE_DESACTIVE',
  // Saisie invalide, champs fautifs dans `champs` (nom et contraintes, jamais la valeur).
  'VALIDATION',
  // Accès refusé (attribué par défaut à toute 403 sans code).
  'PERMISSION_REFUSEE',
  // L'alerte SOS est réservée aux patients.
  'SOS_ROLE_INTERDIT',
  // Une alerte est déjà en cours, `donnees.peutRelancerA` donne l'heure de relance possible.
  'SOS_DEJA_ACTIF',
  // Changement de statut impossible depuis le statut actuel.
  'TRANSITION_INTERDITE',
  // Version de l'application mobile sous la minimale de sa plateforme (426), mise à jour requise.
  'VERSION_OBSOLETE',
  // Numéro de téléphone déjà porté par un autre compte (409).
  'TELEPHONE_DEJA_UTILISE',
  // Envoi d'email momentanément impossible (503), réessayer plus tard.
  'EMAIL_INDISPONIBLE',
] as const;

export type CodeErreur = (typeof CODES_ERREUR)[number];

export function estCodeErreur(valeur: unknown): valeur is CodeErreur {
  return (
    typeof valeur === 'string' &&
    (CODES_ERREUR as readonly string[]).includes(valeur)
  );
}
