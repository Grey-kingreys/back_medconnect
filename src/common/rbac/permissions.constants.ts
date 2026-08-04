/**
 * Catalogue de permissions — SOURCE DE VÉRITÉ UNIQUE (codé en dur).
 *
 * Cf. PLAN-REMEDIATION §2.5. Les structures ne créent pas de permissions : elles les
 * piochent dans ce catalogue pour composer leurs rôles. Ce fichier sert à la fois :
 *  - au seed de la table `Permission` (2.5.c),
 *  - aux définitions de rôles par défaut,
 *  - de référence typée pour `@RequirePermissions(...)`.
 */

export const PERMISSIONS = {
  // 🩺 Carnet de santé
  CARNET_READ: 'carnet:read', // dossier médical complet
  CONSULTATION_WRITE: 'consultation:write',
  ORDONNANCE_WRITE: 'ordonnance:write',
  ANALYSE_WRITE: 'analyse:write',
  VACCINATION_WRITE: 'vaccination:write',
  RENDEZVOUS_WRITE: 'rendezvous:write',
  PATIENT_READ: 'patient:read', // fiche d'orientation (identité, médecin traitant, RDV) — PAS le carnet

  // 🚨 Urgences
  SOS_RESPOND: 'sos:respond',

  // 💊 Pharmacie
  STOCK_READ: 'stock:read',
  STOCK_WRITE: 'stock:write',
  CATALOGUE_WRITE: 'catalogue:write', // créer un médicament
  CATALOGUE_MANAGE: 'catalogue:manage', // modifier / supprimer

  // 🏥 Établissement (délégable, portée = sa structure)
  STRUCTURE_READ: 'structure:read',
  STRUCTURE_WRITE: 'structure:write',
  MEMBRE_READ: 'membre:read',
  MEMBRE_MANAGE: 'membre:manage',
  ROLE_MANAGE: 'role:manage',

  // 💬 Communication
  CHAT_STRUCTURE: 'chat:structure',

  // 🛡️ Plateforme (système, non délégable)
  USER_ADMIN: 'user:admin',
  PLATFORM_STRUCTURES: 'platform:structures',
  PLATFORM_ADMIN: 'platform:admin',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDef {
  code: PermissionCode;
  libelle: string;
  categorie: string;
}

/** Catalogue complet (libellés FR + catégorie) — seedé dans la table `Permission`. */
export const PERMISSION_CATALOG: PermissionDef[] = [
  { code: PERMISSIONS.CARNET_READ, libelle: 'Consulter le carnet de santé complet d’un patient', categorie: 'Carnet de santé' },
  { code: PERMISSIONS.CONSULTATION_WRITE, libelle: 'Ajouter / supprimer une consultation', categorie: 'Carnet de santé' },
  { code: PERMISSIONS.ORDONNANCE_WRITE, libelle: 'Prescrire / supprimer une ordonnance', categorie: 'Carnet de santé' },
  { code: PERMISSIONS.ANALYSE_WRITE, libelle: 'Enregistrer / supprimer un résultat d’analyse', categorie: 'Carnet de santé' },
  { code: PERMISSIONS.VACCINATION_WRITE, libelle: 'Enregistrer / supprimer une vaccination', categorie: 'Carnet de santé' },
  { code: PERMISSIONS.RENDEZVOUS_WRITE, libelle: 'Programmer un rendez-vous', categorie: 'Carnet de santé' },
  { code: PERMISSIONS.PATIENT_READ, libelle: 'Consulter la fiche d’orientation d’un patient (sans le dossier médical)', categorie: 'Carnet de santé' },

  { code: PERMISSIONS.SOS_RESPOND, libelle: 'Voir et traiter les alertes d’urgence (SOS)', categorie: 'Urgences' },

  { code: PERMISSIONS.STOCK_READ, libelle: 'Consulter le stock d’une pharmacie', categorie: 'Pharmacie' },
  { code: PERMISSIONS.STOCK_WRITE, libelle: 'Gérer le stock (ajouter / ajuster / retirer)', categorie: 'Pharmacie' },
  { code: PERMISSIONS.CATALOGUE_WRITE, libelle: 'Ajouter un médicament au catalogue', categorie: 'Pharmacie' },
  { code: PERMISSIONS.CATALOGUE_MANAGE, libelle: 'Modifier / supprimer un médicament du catalogue', categorie: 'Pharmacie' },

  { code: PERMISSIONS.STRUCTURE_READ, libelle: 'Voir les informations de sa structure', categorie: 'Établissement' },
  { code: PERMISSIONS.STRUCTURE_WRITE, libelle: 'Modifier les informations de sa structure', categorie: 'Établissement' },
  { code: PERMISSIONS.MEMBRE_READ, libelle: 'Lister les membres de sa structure', categorie: 'Établissement' },
  { code: PERMISSIONS.MEMBRE_MANAGE, libelle: 'Créer / activer / supprimer des membres', categorie: 'Établissement' },
  { code: PERMISSIONS.ROLE_MANAGE, libelle: 'Créer et configurer les rôles de sa structure', categorie: 'Établissement' },

  { code: PERMISSIONS.CHAT_STRUCTURE, libelle: 'Voir et répondre aux conversations adressées à la structure', categorie: 'Communication' },

  { code: PERMISSIONS.USER_ADMIN, libelle: 'Administrer les utilisateurs (plateforme)', categorie: 'Plateforme' },
  { code: PERMISSIONS.PLATFORM_STRUCTURES, libelle: 'Gérer toutes les structures et invitations', categorie: 'Plateforme' },
  { code: PERMISSIONS.PLATFORM_ADMIN, libelle: 'Administration plateforme (super-admins, stats globales)', categorie: 'Plateforme' },
];

/** Toutes les permissions (utilisé pour le rôle SUPER_ADMIN = accès total). */
export const ALL_PERMISSION_CODES: PermissionCode[] = PERMISSION_CATALOG.map((p) => p.code);

/**
 * Permissions PLATEFORME — **jamais délégables** à un rôle de structure.
 * Anti-escalade (PLAN §2.5.d) : un admin de structure ne peut pas les accorder.
 */
export const NON_DELEGABLE_PERMISSIONS: PermissionCode[] = [
  PERMISSIONS.USER_ADMIN,
  PERMISSIONS.PLATFORM_STRUCTURES,
  PERMISSIONS.PLATFORM_ADMIN,
];

/** Permissions qu'un admin de structure peut composer dans ses rôles. */
export const DELEGABLE_PERMISSION_CODES: PermissionCode[] = ALL_PERMISSION_CODES.filter(
  (code) => !NON_DELEGABLE_PERMISSIONS.includes(code),
);

export interface DefaultRoleDef {
  nom: string;
  description: string;
  /** Mappe l'ancien enum Role pour le backfill des utilisateurs existants. */
  legacyRole?: string;
  permissions: PermissionCode[];
}

/** Rôles système (globaux, `structureId = null`, `isSystem = true`). */
export const SYSTEM_ROLES: DefaultRoleDef[] = [
  {
    nom: 'Patient',
    legacyRole: 'PATIENT',
    description: 'Accès à son propre carnet de santé et à ses services (self-service).',
    permissions: [], // self-service : géré hors catalogue
  },
  {
    nom: 'Administrateur plateforme',
    legacyRole: 'ADMIN',
    description: 'Gère les utilisateurs et le catalogue de médicaments de la plateforme.',
    permissions: [PERMISSIONS.USER_ADMIN, PERMISSIONS.CATALOGUE_WRITE, PERMISSIONS.CATALOGUE_MANAGE],
  },
  {
    nom: 'Super Administrateur',
    legacyRole: 'SUPER_ADMIN',
    description: 'Accès total à la plateforme.',
    permissions: ALL_PERMISSION_CODES,
  },
];

/**
 * Rôles par défaut seedés à la création d'une structure, selon son type.
 * Modifiables ensuite par l'admin de la structure.
 */
export const DEFAULT_STRUCTURE_ROLES: Record<string, DefaultRoleDef[]> = {
  HOPITAL: [
    {
      nom: 'Médecin',
      legacyRole: 'MEDECIN',
      description: 'Soignant : carnet, prescriptions, analyses, vaccinations, RDV, urgences.',
      permissions: [
        PERMISSIONS.CARNET_READ,
        PERMISSIONS.CONSULTATION_WRITE,
        PERMISSIONS.ORDONNANCE_WRITE,
        PERMISSIONS.ANALYSE_WRITE,
        PERMISSIONS.VACCINATION_WRITE,
        PERMISSIONS.RENDEZVOUS_WRITE,
        PERMISSIONS.SOS_RESPOND,
        PERMISSIONS.PATIENT_READ,
        PERMISSIONS.STRUCTURE_READ,
        PERMISSIONS.MEMBRE_READ,
      ],
    },
    {
      nom: 'Accueil',
      legacyRole: 'ACCUEIL',
      description: 'Front desk : oriente les patients, prend les RDV, gère les messages reçus par la structure. Pas d’accès au dossier médical.',
      permissions: [
        PERMISSIONS.PATIENT_READ,
        PERMISSIONS.RENDEZVOUS_WRITE,
        PERMISSIONS.CHAT_STRUCTURE,
        PERMISSIONS.STRUCTURE_READ,
        PERMISSIONS.MEMBRE_READ,
      ],
    },
    {
      nom: 'Administrateur de structure',
      legacyRole: 'STRUCTURE_ADMIN',
      description: 'Gère les membres, les rôles et les informations de la structure (administratif, sans accès clinique).',
      permissions: [
        PERMISSIONS.STRUCTURE_READ,
        PERMISSIONS.STRUCTURE_WRITE,
        PERMISSIONS.MEMBRE_READ,
        PERMISSIONS.MEMBRE_MANAGE,
        PERMISSIONS.ROLE_MANAGE,
        PERMISSIONS.PATIENT_READ,
      ],
    },
  ],
  PHARMACIE: [
    {
      nom: 'Pharmacien',
      legacyRole: 'PHARMACIEN',
      description: 'Gère le stock, contribue au catalogue, répond aux messages de l’officine.',
      permissions: [
        PERMISSIONS.STOCK_READ,
        PERMISSIONS.STOCK_WRITE,
        PERMISSIONS.CATALOGUE_WRITE,
        PERMISSIONS.CHAT_STRUCTURE,
        PERMISSIONS.STRUCTURE_READ,
        PERMISSIONS.MEMBRE_READ,
      ],
    },
    {
      nom: 'Administrateur de structure',
      legacyRole: 'STRUCTURE_ADMIN',
      description: 'Gère les membres, les rôles et les informations de l’officine.',
      permissions: [
        PERMISSIONS.STRUCTURE_READ,
        PERMISSIONS.STRUCTURE_WRITE,
        PERMISSIONS.MEMBRE_READ,
        PERMISSIONS.MEMBRE_MANAGE,
        PERMISSIONS.ROLE_MANAGE,
      ],
    },
  ],
};

// Clinique = mêmes rôles par défaut qu'un hôpital.
DEFAULT_STRUCTURE_ROLES.CLINIQUE = DEFAULT_STRUCTURE_ROLES.HOPITAL;
