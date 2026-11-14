/**
 * Jeu « format actuel » (D449).
 *
 * Ce jeu reproduit les données d'AVANT la tranche pharmacie (schéma de
 * `20261022120000_ventes_pharmacie`). Il est inséré en SQL brut, avec des colonnes
 * explicites, pour rester valable quand le client Prisma et les constantes RBAC évolueront.
 * Ne jamais le réécrire avec le client Prisma ni importer `permissions.constants.ts`.
 */
import { Client } from 'pg';

export interface OptionsFormatActuel {
  aujourdhui?: Date;
}

export interface FicheFormatActuel {
  id: string;
  medicamentId: string;
  structureId: string;
  quantite: number;
  prixUnitaire: number | null;
  disponible: boolean;
  dateExpiration: Date | null;
  notes: string | null;
}

export interface ResumeFormatActuel {
  aujourdhui: Date;
  pharmacies: string[];
  hopital: string;
  fiches: FicheFormatActuel[];
  ventes: { validees: number; annulees: number; lignes: number };
}

export const QUANTITES_FORMAT_ACTUEL: readonly number[] = [
  0, 1, 9, 10, 11, 240,
];
export const PRIX_FORMAT_ACTUEL: readonly (number | null)[] = [
  1500,
  null,
  2500,
  0,
  12000,
];

const JOUR_MS = 24 * 60 * 60 * 1000;
const HEURE_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Texte UTC sans fuseau pour une colonne timestamp(3) (jamais un objet Date brut). */
function horodatage(date: Date): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function minuitUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function deuxChiffres(n: number): string {
  return String(n).padStart(2, '0');
}

export function fichesFormatActuel(aujourdhui: Date): FicheFormatActuel[] {
  const dates: (Date | null)[] = [
    new Date(aujourdhui.getTime() - 30 * JOUR_MS),
    aujourdhui,
    new Date(aujourdhui.getTime() + 180 * JOUR_MS),
    null,
  ];
  const fiches: FicheFormatActuel[] = [];
  for (let i = 0; i < 40; i++) {
    let structureId: string;
    let numeroMedicament: number;
    if (i < 20) {
      structureId = 'str-pharma-1';
      numeroMedicament = i + 1;
    } else if (i < 35) {
      structureId = 'str-pharma-2';
      numeroMedicament = i - 19;
    } else {
      structureId = 'str-pharma-3';
      numeroMedicament = i - 34;
    }
    const quantite = QUANTITES_FORMAT_ACTUEL[i % 6];
    fiches.push({
      id: 'stk-' + deuxChiffres(i + 1),
      medicamentId: 'med-' + deuxChiffres(numeroMedicament),
      structureId,
      quantite,
      prixUnitaire: PRIX_FORMAT_ACTUEL[i % 5],
      disponible: quantite > 0,
      dateExpiration: dates[i % 4],
      notes: i % 7 === 0 ? 'Note du harnais' : null,
    });
  }
  return fiches;
}

const STRUCTURES = [
  [
    'str-pharma-1',
    'Pharmacie de Kaloum (harnais)',
    'PHARMACIE',
    'pharma1@harnais.test',
    '+224620100001',
    'Kaloum',
    true,
  ],
  [
    'str-pharma-2',
    'Pharmacie de Matoto (harnais)',
    'PHARMACIE',
    'pharma2@harnais.test',
    '+224620100002',
    'Matoto',
    true,
  ],
  [
    'str-pharma-3',
    'Pharmacie de Ratoma (harnais)',
    'PHARMACIE',
    'pharma3@harnais.test',
    null,
    'Ratoma',
    false,
  ],
  [
    'str-hopital-1',
    'Hôpital de Donka (harnais)',
    'HOPITAL',
    'hopital1@harnais.test',
    '+224620100004',
    'Dixinn',
    true,
  ],
] as const;

const PERMISSIONS: readonly (readonly [string, string, string])[] = [
  [
    'carnet:read',
    'Consulter le carnet de santé complet d’un patient',
    'Carnet de santé',
  ],
  [
    'consultation:write',
    'Ajouter / supprimer une consultation',
    'Carnet de santé',
  ],
  [
    'ordonnance:write',
    'Prescrire / supprimer une ordonnance',
    'Carnet de santé',
  ],
  [
    'analyse:write',
    'Enregistrer / supprimer un résultat d’analyse',
    'Carnet de santé',
  ],
  [
    'vaccination:write',
    'Enregistrer / supprimer une vaccination',
    'Carnet de santé',
  ],
  ['rendezvous:write', 'Programmer un rendez-vous', 'Carnet de santé'],
  [
    'patient:read',
    'Consulter la fiche d’orientation d’un patient (sans le dossier médical)',
    'Carnet de santé',
  ],
  ['sos:respond', 'Voir et traiter les alertes d’urgence (SOS)', 'Urgences'],
  ['stock:read', 'Consulter le stock d’une pharmacie', 'Pharmacie'],
  ['stock:write', 'Gérer le stock (ajouter / ajuster / retirer)', 'Pharmacie'],
  ['catalogue:write', 'Ajouter un médicament au catalogue', 'Pharmacie'],
  [
    'catalogue:manage',
    'Modifier / supprimer un médicament du catalogue',
    'Pharmacie',
  ],
  ['vente:read', 'Consulter les ventes de la pharmacie', 'Pharmacie'],
  ['vente:write', 'Enregistrer une vente', 'Pharmacie'],
  ['vente:annuler', 'Annuler une vente du jour', 'Pharmacie'],
  ['structure:read', 'Voir les informations de sa structure', 'Établissement'],
  [
    'structure:write',
    'Modifier les informations de sa structure',
    'Établissement',
  ],
  ['membre:read', 'Lister les membres de sa structure', 'Établissement'],
  ['membre:manage', 'Créer / activer / supprimer des membres', 'Établissement'],
  [
    'role:manage',
    'Créer et configurer les rôles de sa structure',
    'Établissement',
  ],
  [
    'chat:structure',
    'Voir et répondre aux conversations adressées à la structure',
    'Communication',
  ],
  ['user:admin', 'Administrer les utilisateurs (plateforme)', 'Plateforme'],
  [
    'platform:structures',
    'Gérer toutes les structures et invitations',
    'Plateforme',
  ],
  [
    'platform:admin',
    'Administration plateforme (super-admins, stats globales)',
    'Plateforme',
  ],
];

const PERMISSIONS_PHARMACIEN = [
  'stock:read',
  'stock:write',
  'catalogue:write',
  'vente:read',
  'vente:write',
  'chat:structure',
  'structure:read',
  'membre:read',
];
const PERMISSIONS_ADMIN_PHARMACIE = [
  'stock:read',
  'stock:write',
  'vente:read',
  'vente:write',
  'vente:annuler',
  'structure:read',
  'structure:write',
  'membre:read',
  'membre:manage',
  'role:manage',
];
const PERMISSIONS_MEDECIN = [
  'carnet:read',
  'consultation:write',
  'ordonnance:write',
  'analyse:write',
  'vaccination:write',
  'rendezvous:write',
  'sos:respond',
  'patient:read',
  'structure:read',
  'membre:read',
];
const PERMISSIONS_ADMIN_HOPITAL = [
  'structure:read',
  'structure:write',
  'membre:read',
  'membre:manage',
  'role:manage',
  'patient:read',
];

const ROLES: readonly (readonly [string, string, string, readonly string[]])[] =
  [
    ['rol-p1-pharmacien', 'str-pharma-1', 'Pharmacien', PERMISSIONS_PHARMACIEN],
    ['rol-p2-pharmacien', 'str-pharma-2', 'Pharmacien', PERMISSIONS_PHARMACIEN],
    ['rol-p3-pharmacien', 'str-pharma-3', 'Pharmacien', PERMISSIONS_PHARMACIEN],
    [
      'rol-p1-admin',
      'str-pharma-1',
      'Administrateur de structure',
      PERMISSIONS_ADMIN_PHARMACIE,
    ],
    [
      'rol-p2-admin',
      'str-pharma-2',
      'Administrateur de structure',
      PERMISSIONS_ADMIN_PHARMACIE,
    ],
    [
      'rol-p3-admin',
      'str-pharma-3',
      'Administrateur de structure',
      PERMISSIONS_ADMIN_PHARMACIE,
    ],
    ['rol-h1-medecin', 'str-hopital-1', 'Médecin', PERMISSIONS_MEDECIN],
    [
      'rol-h1-admin',
      'str-hopital-1',
      'Administrateur de structure',
      PERMISSIONS_ADMIN_HOPITAL,
    ],
  ];

const UTILISATEURS = [
  [
    'usr-admin-p1',
    'Fatoumata',
    'Camara',
    'STRUCTURE_ADMIN',
    'str-pharma-1',
    'rol-p1-admin',
    null,
  ],
  [
    'usr-pharm-p1',
    'Mamadou',
    'Diallo',
    'PHARMACIEN',
    'str-pharma-1',
    'rol-p1-pharmacien',
    null,
  ],
  [
    'usr-admin-p2',
    'Ibrahima',
    'Sow',
    'STRUCTURE_ADMIN',
    'str-pharma-2',
    'rol-p2-admin',
    null,
  ],
  [
    'usr-pharm-p2',
    'Aïssatou',
    'Barry',
    'PHARMACIEN',
    'str-pharma-2',
    'rol-p2-pharmacien',
    null,
  ],
  [
    'usr-admin-p3',
    'Kadiatou',
    'Keita',
    'STRUCTURE_ADMIN',
    'str-pharma-3',
    'rol-p3-admin',
    null,
  ],
  [
    'usr-admin-h1',
    'Oumar',
    'Touré',
    'STRUCTURE_ADMIN',
    'str-hopital-1',
    'rol-h1-admin',
    null,
  ],
  [
    'usr-medecin-h1',
    'Mariama',
    'Sylla',
    'MEDECIN',
    'str-hopital-1',
    'rol-h1-medecin',
    'Médecine générale',
  ],
] as const;

const ADMINS_DE_STRUCTURE = [
  ['str-pharma-1', 'usr-admin-p1'],
  ['str-pharma-2', 'usr-admin-p2'],
  ['str-pharma-3', 'usr-admin-p3'],
  ['str-hopital-1', 'usr-admin-h1'],
] as const;

const MEDICAMENTS: readonly (readonly [string, string, boolean])[] = [
  ['Paracétamol 500 mg', 'Antalgique', false],
  ['Ibuprofène 400 mg', 'Anti-inflammatoire', false],
  ['Amoxicilline 500 mg', 'Antibiotique', true],
  ['Métronidazole 250 mg', 'Antibiotique', false],
  ['Artéméther Luméfantrine', 'Antipaludéen', false],
  ['Oméprazole 20 mg', 'Antiulcéreux', false],
  ['Sel de réhydratation orale', 'Réhydratation', false],
  ['Cotrimoxazole 480 mg', 'Antibiotique', true],
  ['Vitamine C 500 mg', 'Vitamine', false],
  ['Fer acide folique', 'Supplément', false],
  ['Albendazole 400 mg', 'Antiparasitaire', false],
  ['Quinine 300 mg', 'Antipaludéen', false],
  ['Diclofénac 50 mg', 'Anti-inflammatoire', false],
  ['Amlodipine 5 mg', 'Antihypertenseur', true],
  ['Metformine 500 mg', 'Antidiabétique', false],
  ['Salbutamol sirop', 'Bronchodilatateur', false],
  ['Chlorphénamine 4 mg', 'Antihistaminique', false],
  ['Loratadine 10 mg', 'Antihistaminique', false],
  ['Paracétamol sirop 120 mg/5 ml', 'Antalgique', false],
  ['Zinc 20 mg', 'Supplément', false],
];

const FORMES_MEDICAMENTS: readonly string[] = [
  'comprimé',
  'comprimé',
  'gélule',
  'comprimé',
  'comprimé',
  'gélule',
  'sachet',
  'comprimé',
  'comprimé',
  'comprimé',
  'comprimé',
  'comprimé',
  'comprimé',
  'comprimé',
  'comprimé',
  'sirop',
  'comprimé',
  'comprimé',
  'sirop',
  'comprimé',
];

interface VenteSpec {
  id: string;
  structureId: string;
  n: number;
  vendeurId: string;
  vendeurNom: string;
  creeeLe: Date;
  statut: 'VALIDEE' | 'ANNULEE';
  lignes: { stockId: string; quantite: number }[];
  total: number;
  ordonnanceVerifiee: boolean;
  clientNom: string | null;
  clientTelephone: string | null;
  annuleeLe: Date | null;
  annuleeParId: string | null;
  motifAnnulation: string | null;
  cleIdempotence: string | null;
}

function ventesFormatActuel(aujourdhui: Date): VenteSpec[] {
  const J = aujourdhui.getTime();
  const veille = J - JOUR_MS;
  const base = {
    ordonnanceVerifiee: false,
    clientNom: null,
    clientTelephone: null,
    annuleeLe: null,
    annuleeParId: null,
    motifAnnulation: null,
    cleIdempotence: null,
  };
  return [
    {
      ...base,
      id: 'vte-p1-1',
      structureId: 'str-pharma-1',
      n: 1,
      vendeurId: 'usr-pharm-p1',
      vendeurNom: 'Mamadou Diallo',
      creeeLe: new Date(J + 8 * HEURE_MS),
      statut: 'VALIDEE',
      lignes: [
        { stockId: 'stk-11', quantite: 2 },
        { stockId: 'stk-15', quantite: 1 },
      ],
      total: 15000,
    },
    {
      ...base,
      id: 'vte-p1-2',
      structureId: 'str-pharma-1',
      n: 2,
      vendeurId: 'usr-admin-p1',
      vendeurNom: 'Fatoumata Camara',
      creeeLe: new Date(J + 9 * HEURE_MS),
      statut: 'VALIDEE',
      lignes: [{ stockId: 'stk-03', quantite: 3 }],
      total: 7500,
      ordonnanceVerifiee: true,
      clientNom: 'Mariama Bah',
      clientTelephone: '+224620000001',
    },
    {
      ...base,
      id: 'vte-p1-3',
      structureId: 'str-pharma-1',
      n: 3,
      vendeurId: 'usr-pharm-p1',
      vendeurNom: 'Mamadou Diallo',
      creeeLe: new Date(J + 10 * HEURE_MS),
      statut: 'ANNULEE',
      lignes: [{ stockId: 'stk-16', quantite: 1 }],
      total: 1500,
      annuleeLe: new Date(J + 10 * HEURE_MS + 15 * MINUTE_MS),
      annuleeParId: 'usr-admin-p1',
      motifAnnulation: 'Erreur de saisie',
    },
    {
      ...base,
      id: 'vte-p1-4',
      structureId: 'str-pharma-1',
      n: 4,
      vendeurId: 'usr-pharm-p1',
      vendeurNom: 'Mamadou Diallo',
      creeeLe: new Date(J + 11 * HEURE_MS),
      statut: 'VALIDEE',
      lignes: [{ stockId: 'stk-11', quantite: 1 }],
      total: 1500,
      cleIdempotence: 'harnais-cle-0001',
    },
    {
      ...base,
      id: 'vte-p2-1',
      structureId: 'str-pharma-2',
      n: 1,
      vendeurId: 'usr-pharm-p2',
      vendeurNom: 'Aïssatou Barry',
      creeeLe: new Date(veille + 15 * HEURE_MS),
      statut: 'VALIDEE',
      lignes: [{ stockId: 'stk-26', quantite: 4 }],
      total: 6000,
    },
    {
      ...base,
      id: 'vte-p2-2',
      structureId: 'str-pharma-2',
      n: 2,
      vendeurId: 'usr-pharm-p2',
      vendeurNom: 'Aïssatou Barry',
      creeeLe: new Date(veille + 16 * HEURE_MS),
      statut: 'ANNULEE',
      lignes: [{ stockId: 'stk-35', quantite: 2 }],
      total: 24000,
      annuleeLe: new Date(veille + 16 * HEURE_MS + 5 * MINUTE_MS),
      annuleeParId: 'usr-admin-p2',
      motifAnnulation: 'Client parti sans payer',
    },
  ];
}

export async function chargerFormatActuel(
  client: Client,
  options: OptionsFormatActuel = {},
): Promise<ResumeFormatActuel> {
  const aujourdhui = minuitUtc(options.aujourdhui ?? new Date());
  const fiches = fichesFormatActuel(aujourdhui);
  const ventes = ventesFormatActuel(aujourdhui);
  const veille = new Date(aujourdhui.getTime() - JOUR_MS);

  await client.query('BEGIN');
  try {
    for (const [
      id,
      nom,
      type,
      email,
      telephone,
      adresse,
      isConfigured,
    ] of STRUCTURES) {
      await client.query(
        `INSERT INTO "Structure" ("id", "nom", "type", "email", "telephone", "adresse", "ville", "isActive", "isConfigured", "createdAt", "updatedAt")
         VALUES ($1, $2, $3::"StructureType", $4, $5, $6, 'Conakry', true, $7, now(), now())`,
        [id, nom, type, email, telephone, adresse, isConfigured],
      );
    }

    for (const [code, libelle, categorie] of PERMISSIONS) {
      await client.query(
        `INSERT INTO "Permission" ("id", "code", "libelle", "categorie", "createdAt")
         VALUES ($1, $2, $3, $4, now()) ON CONFLICT ("code") DO NOTHING`,
        ['perm-' + code, code, libelle, categorie],
      );
    }

    for (const [id, structureId, nom, codes] of ROLES) {
      await client.query(
        `INSERT INTO "AppRole" ("id", "nom", "description", "isSystem", "structureId", "createdAt", "updatedAt")
         VALUES ($1, $2, NULL, false, $3, now(), now())`,
        [id, nom, structureId],
      );
      await client.query(
        `INSERT INTO "RolePermission" ("appRoleId", "permissionId")
         SELECT $1, p."id" FROM "Permission" p WHERE p."code" = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [id, codes],
      );
    }

    for (const [
      id,
      prenom,
      nom,
      role,
      structureId,
      appRoleId,
      specialite,
    ] of UTILISATEURS) {
      await client.query(
        `INSERT INTO "User" ("id", "email", "password", "nom", "prenom", "telephone", "role", "isActive", "specialite", "structureId", "appRoleId", "createdAt", "updatedAt")
         VALUES ($1, $2, 'harnais-aucun-mot-de-passe', $3, $4, NULL, $5::"Role", true, $6, $7, $8, now(), now())`,
        [
          id,
          `${id}@harnais.test`,
          nom,
          prenom,
          role,
          specialite,
          structureId,
          appRoleId,
        ],
      );
    }
    for (const [structureId, adminId] of ADMINS_DE_STRUCTURE) {
      await client.query(
        `UPDATE "Structure" SET "adminId" = $2 WHERE "id" = $1`,
        [structureId, adminId],
      );
    }

    for (let i = 0; i < MEDICAMENTS.length; i++) {
      const [nom, categorie, ordonnanceRequise] = MEDICAMENTS[i];
      await client.query(
        `INSERT INTO "Medicament" ("id", "nom", "nomGenerique", "categorie", "description", "ordonnanceRequise", "formes", "createdAt", "updatedAt")
         VALUES ($1, $2, NULL, $3, NULL, $4, $5::text[], now(), now())`,
        [
          'med-' + deuxChiffres(i + 1),
          nom,
          categorie,
          ordonnanceRequise,
          [FORMES_MEDICAMENTS[i]],
        ],
      );
    }

    for (const f of fiches) {
      await client.query(
        `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "prixUnitaire", "disponible", "dateExpiration", "notes", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp(3), $8, now())`,
        [
          f.id,
          f.medicamentId,
          f.structureId,
          f.quantite,
          f.prixUnitaire,
          f.disponible,
          f.dateExpiration ? horodatage(f.dateExpiration) : null,
          f.notes,
        ],
      );
    }

    let numeroLigne = 0;
    for (const v of ventes) {
      const annee = v.creeeLe.getUTCFullYear();
      await client.query(
        `INSERT INTO "Vente" ("id", "structureId", "numero", "vendeurId", "vendeurNom", "clientNom", "clientTelephone", "ordonnanceVerifiee", "total", "statut", "annuleeLe", "annuleeParId", "motifAnnulation", "cleIdempotence", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::"StatutVente", $11::timestamp(3), $12, $13, $14, $15::timestamp(3))`,
        [
          v.id,
          v.structureId,
          `V-${annee}-${String(v.n).padStart(6, '0')}`,
          v.vendeurId,
          v.vendeurNom,
          v.clientNom,
          v.clientTelephone,
          v.ordonnanceVerifiee,
          v.total,
          v.statut,
          v.annuleeLe ? horodatage(v.annuleeLe) : null,
          v.annuleeParId,
          v.motifAnnulation,
          v.cleIdempotence,
          horodatage(v.creeeLe),
        ],
      );
      for (const ligne of v.lignes) {
        numeroLigne += 1;
        const fiche = fiches.find((f) => f.id === ligne.stockId);
        if (!fiche || fiche.prixUnitaire === null) {
          throw new Error(
            `Fiche de stock inconnue ou sans prix : ${ligne.stockId}`,
          );
        }
        const nomMedicament =
          MEDICAMENTS[Number(fiche.medicamentId.slice(4)) - 1][0];
        await client.query(
          `INSERT INTO "LigneVente" ("id", "venteId", "medicamentId", "stockMedicamentId", "nomMedicament", "prixUnitaire", "quantite", "sousTotal")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            'lv-' + deuxChiffres(numeroLigne),
            v.id,
            fiche.medicamentId,
            fiche.id,
            nomMedicament,
            fiche.prixUnitaire,
            ligne.quantite,
            fiche.prixUnitaire * ligne.quantite,
          ],
        );
      }
    }

    for (const [structureId, annee, dernierNumero] of [
      ['str-pharma-1', aujourdhui.getUTCFullYear(), 4],
      ['str-pharma-2', veille.getUTCFullYear(), 2],
    ] as const) {
      await client.query(
        `INSERT INTO "CompteurVente" ("structureId", "annee", "dernierNumero") VALUES ($1, $2, $3)`,
        [structureId, annee, dernierNumero],
      );
    }

    await client.query('COMMIT');
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  }

  return {
    aujourdhui,
    pharmacies: ['str-pharma-1', 'str-pharma-2', 'str-pharma-3'],
    hopital: 'str-hopital-1',
    fiches,
    ventes: {
      validees: ventes.filter((v) => v.statut === 'VALIDEE').length,
      annulees: ventes.filter((v) => v.statut === 'ANNULEE').length,
      lignes: ventes.reduce((somme, v) => somme + v.lignes.length, 0),
    },
  };
}
