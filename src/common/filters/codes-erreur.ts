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
  // Appareil déjà enregistré comme un autre type de poste de caisse (409).
  'POSTE_TYPE_DIFFERENT',
  // Prix à l'unité sur une fiche produit qui ne se vend pas à l'unité (400).
  'PRIX_UNITE_SANS_DECONDITIONNEMENT',
  // Coefficient d'une fiche non qualifiée qui a du stock changé sans conversion (400).
  'CONVERSION_REQUISE',
  // Plusieurs lots (ou aucun) : préciser le lot ou faire un inventaire (409).
  'LOT_REQUIS',
  // Correction ou sortie qui rendrait un lot négatif (409).
  'STOCK_LOT_NEGATIF',
  // Une boîte de ce lot est déjà entamée dans ce point de vente (409).
  'CONDITIONNEMENT_DEJA_OUVERT',
  // Motif obligatoire absent ou trop court (400).
  'MOTIF_REQUIS',
  // Date de péremption obligatoire pour créer un lot, sauf « sans péremption » (400).
  'DATE_PEREMPTION_REQUISE',
  // Médicament du catalogue déjà utilisé par un lot, un mouvement ou une vente (409).
  'MEDICAMENT_UTILISE',
  // Structure qui a des ventes, un journal de stock ou de caisse : suppression refusée, la désactiver (409).
  'STRUCTURE_AVEC_PIECES',
  // Poste de caisse inconnu, technique, d'une autre pharmacie ou désactivé (409).
  'POSTE_INCONNU',
  // Le poste a déjà une caisse ouverte par un autre utilisateur (409).
  'SESSION_AUTRE_UTILISATEUR',
  // Session de caisse déjà fermée : comptage, mouvement ou réouverture impossibles (409).
  'SESSION_FERMEE',
  // Comptage d'ouverture ou de fermeture déjà enregistré pour cette session (409).
  'COMPTAGE_DEJA_SAISI',
  // Fermeture de caisse sans comptage de fermeture (400).
  'COMPTAGE_FERMETURE_REQUIS',
  // Écart d'espèces au-delà du seuil de la pharmacie sans commentaire (400).
  'COMMENTAIRE_ECART_REQUIS',
  // Mode de paiement inconnu ou désactivé (400).
  'MODE_PAIEMENT_INCONNU',
  // Identifiant fourni par le client déjà porté par un autre enregistrement de caisse (409).
  'IDENTIFIANT_DEJA_UTILISE',
] as const;

export type CodeErreur = (typeof CODES_ERREUR)[number];

export function estCodeErreur(valeur: unknown): valeur is CodeErreur {
  return (
    typeof valeur === 'string' &&
    (CODES_ERREUR as readonly string[]).includes(valeur)
  );
}
