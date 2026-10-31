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
  // Ancien refus de vente faute de stock (409) : plus jamais renvoyé depuis PB11, conservé (code stable).
  'STOCK_INSUFFISANT',
  // Ancien refus de vente d'un médicament périmé (400) : plus jamais renvoyé depuis PB11 (remplacé par SORTIE_MANUELLE_REQUISE), conservé (code stable).
  'MEDICAMENT_EXPIRE',
  // Médicament sans prix dans la vente (400), lignes dans `details`.
  'PRIX_MANQUANT',
  // Médicament sur ordonnance vendu sans confirmation de l'ordonnance (400), lignes dans `details`.
  'ORDONNANCE_NON_CONFIRMEE',
  // Ligne de stock absente de cette pharmacie (404), lignes dans `details`.
  'STOCK_INTROUVABLE',
  // Vente déjà annulée : une pièce d'annulation existe (409).
  'VENTE_DEJA_ANNULEE',
  // Ancien refus d'annulation d'une vente d'un autre jour (409) : plus jamais renvoyé depuis PB12, conservé (code stable).
  'ANNULATION_HORS_DELAI',
  // Appareil déjà enregistré comme un autre type de poste de caisse (409).
  'POSTE_TYPE_DIFFERENT',
  // Prix à l'unité sur une fiche produit qui ne se vend pas à l'unité (400).
  'PRIX_UNITE_SANS_DECONDITIONNEMENT',
  // Coefficient d'une fiche non qualifiée qui a du stock changé sans conversionStock (400).
  'CONVERSION_REQUISE',
  // Plusieurs lots (ou aucun) : préciser le lot ou faire un inventaire (409).
  'LOT_REQUIS',
  // Correction ou sortie qui rendrait un lot négatif (409).
  'STOCK_LOT_NEGATIF',
  // Une boîte de ce lot est déjà entamée dans ce point de vente (409).
  'CONDITIONNEMENT_DEJA_OUVERT',
  // Motif obligatoire absent ou trop court (400).
  'MOTIF_REQUIS',
  // Date de péremption obligatoire pour créer un lot, sauf « sans péremption » (400) ; à la réception, lignes dans `details`.
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
  // Vente à l'unité d'un médicament qui se vend uniquement à la boîte (400), lignes dans `details`.
  'VENTE_UNITE_INTERDITE',
  // Vente à l'unité d'un médicament sans prix à l'unité (400), lignes dans `details`.
  'PRIX_UNITE_MANQUANT',
  // Il ne reste que des lots périmés pour couvrir la vente : choisir un lot et un motif (409), lignes et lots dans `details`.
  'SORTIE_MANUELLE_REQUISE',
  // Somme des paiements différente du montant de la vente (400).
  'PAIEMENTS_INCOHERENTS',
  // Pièce qui ne peut pas être annulée : annulation, régularisation, vente déjà régularisée ou vente d'avant la caisse (409).
  'PIECE_NON_ANNULABLE',
  // Fiche déjà qualifiée : le stock existant ne se convertit plus (409).
  'FICHE_DEJA_QUALIFIEE',
  // Stock qui ne peut pas être multiplié automatiquement : hors reprise, provisoire ou trop grand (409).
  'CONVERSION_IMPOSSIBLE',
  // Fiche d'un médicament du panier modifiée pendant la vente (409), lignes dans `details`.
  'FICHE_MODIFIEE',
  // Fournisseur du même nom déjà enregistré dans la pharmacie (409).
  'FOURNISSEUR_EXISTANT',
  // Date de péremption déjà passée à la réception (400), lignes dans `details`.
  'DATE_PEREMPTION_PASSEE',
  // Import Excel d'un inventaire indisponible (409, PB14c) ; plus renvoyé depuis PB15c, gardé au catalogue (D542).
  'IMPORT_INVENTAIRE_INDISPONIBLE',
  // Anomalie déjà traitée : un traitement ne se fait qu'une fois (409).
  'ANOMALIE_DEJA_TRAITEE',
  // Journée clôturée : plus aucune écriture n'y est possible, la correction se fait sur la journée en cours (409).
  'JOURNEE_CLOTUREE',
  // Journée déjà clôturée (409).
  'JOURNEE_DEJA_CLOTUREE',
  // Postes attendus avant la clôture (409), postes dans `details`.
  'CLOTURE_INCOMPLETE',
  // Caisses ouvertes sur un navigateur, à fermer même pour forcer la clôture (409), caisses dans `details`.
  'CAISSES_A_FERMER',
  // Journée antérieure à la mise en place de la caisse, non clôturable (400).
  'JOUR_AVANT_DEBUT_CAISSE',
  // Export d'une journée qui n'est pas encore clôturée (409).
  'JOURNEE_NON_CLOTUREE',
] as const;

export type CodeErreur = (typeof CODES_ERREUR)[number];

export function estCodeErreur(valeur: unknown): valeur is CodeErreur {
  return (
    typeof valeur === 'string' &&
    (CODES_ERREUR as readonly string[]).includes(valeur)
  );
}
