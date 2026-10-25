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
  // Jeton d'accès absent (401) : le client peut tenter un rafraîchissement.
  'JETON_ABSENT',
  // Jeton d'accès expiré (401) : le client rafraîchit puis rejoue la requête.
  'JETON_EXPIRE',
  // Jeton d'accès illisible ou mal signé (401) : le client peut tenter un rafraîchissement.
  'JETON_INVALIDE',
  // Mot de passe actuel incorrect lors d'un changement de mot de passe (400), la session reste valide.
  'MOT_DE_PASSE_ACTUEL_INCORRECT',
  // Stock insuffisant pour au moins une ligne de la vente (409), lignes dans `details`.
  'STOCK_INSUFFISANT',
  // Médicament périmé dans la vente (400), lignes dans `details`.
  'MEDICAMENT_EXPIRE',
  // Médicament sans prix dans la vente (400), lignes dans `details`.
  'PRIX_MANQUANT',
  // Médicament sur ordonnance vendu sans confirmation de l'ordonnance (400), lignes dans `details`.
  'ORDONNANCE_NON_CONFIRMEE',
  // Ligne de stock absente de cette pharmacie (404), lignes dans `details`.
  'STOCK_INTROUVABLE',
  // Vente déjà annulée (409).
  'VENTE_DEJA_ANNULEE',
  // Vente d'un autre jour, annulation impossible (409).
  'ANNULATION_HORS_DELAI',
] as const;

export type CodeErreur = (typeof CODES_ERREUR)[number];

export function estCodeErreur(valeur: unknown): valeur is CodeErreur {
  return (
    typeof valeur === 'string' &&
    (CODES_ERREUR as readonly string[]).includes(valeur)
  );
}
