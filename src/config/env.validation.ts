// Dette préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-base-to-string */
/**
 * Validation centralisée des variables d'environnement (fail-fast au boot).
 *
 * Branchée sur `ConfigModule.forRoot({ validate: validateEnv })` → l'application
 * refuse de démarrer avec un message clair listant TOUTES les variables
 * manquantes/invalides d'un coup, plutôt que de planter de façon opaque dans le
 * constructeur d'un service (EncryptionService, EmailService…).
 *
 * Choix : validation maison (zéro dépendance) plutôt que Joi/class-validator,
 * pour ne pas alourdir le lock (cf. CLAUDE.md : node_modules = volume Docker).
 */

import { FORMAT_VERSION_CONFIG } from '../configuration-publique/versions';
import {
  VERSION_DOCUMENT_PAR_DEFAUT,
  VERSION_PAR_DEFAUT,
} from '../configuration-publique/configuration-publique.constants';
import { NUMERO_URGENCE_MEDICALE_PAR_DEFAUT } from './numeros-urgence';

const WEAK_SECRETS = new Set([
  'secret',
  'medconnecte-secret-key',
  'changeme',
  'password',
]);

type Rule = {
  key: string;
  required: boolean;
  /** Retourne un message d'erreur si invalide, sinon null. Non appelé si absent. */
  validate?: (value: string) => string | null;
  /** Valeur par défaut appliquée à process.env si absente (et non requise). */
  default?: string;
};

function versionValide(v: string): string | null {
  return FORMAT_VERSION_CONFIG.test(v)
    ? null
    : 'doit être une version au format X.Y.Z (ex. 1.4.0)';
}

function urlValide(v: string): string | null {
  return v.startsWith('https://') || v.startsWith('http://')
    ? null
    : 'doit être une URL (https://...)';
}

function booleenValide(v: string): string | null {
  return ['true', 'false'].includes(v.toLowerCase())
    ? null
    : "doit valoir 'true' ou 'false'";
}

const RULES: Rule[] = [
  {
    key: 'DATABASE_URL',
    required: true,
    validate: (v) =>
      v.startsWith('postgres://') || v.startsWith('postgresql://')
        ? null
        : 'doit être une URL PostgreSQL (postgres://… ou postgresql://…)',
  },
  {
    key: 'JWT_SECRET',
    required: true,
    validate: (v) => {
      if (WEAK_SECRETS.has(v.toLowerCase())) {
        return 'valeur trop faible/par défaut : générez un secret aléatoire (ex. `openssl rand -hex 32`)';
      }
      if (v.length < 32) {
        return `doit faire au moins 32 caractères (actuellement ${v.length})`;
      }
      return null;
    },
  },
  {
    key: 'ENCRYPTION_KEY',
    required: true,
    validate: (v) =>
      /^[0-9a-fA-F]{64}$/.test(v)
        ? null
        : 'doit être une chaîne hexadécimale de 64 caractères (32 octets ; `openssl rand -hex 32`)',
  },
  {
    key: 'RESEND_API_KEY',
    required: true,
    validate: (v) =>
      v.startsWith('re_')
        ? null
        : "format inattendu (clé Resend attendue, préfixe 're_')",
  },
  {
    key: 'REDIS_URL',
    required: false,
    default: 'redis://localhost:6379',
    validate: (v) =>
      v.startsWith('redis://') || v.startsWith('rediss://')
        ? null
        : 'doit être une URL Redis (redis://… ou rediss://…)',
  },
  // Compte SUPER_ADMIN initial, créé automatiquement au boot par SuperAdminSeeder
  // s'il n'existe pas encore. Obligatoires : pas de mot de passe par défaut faible
  // sur un compte qui a tous les droits.
  {
    key: 'SUPER_ADMIN_EMAIL',
    required: true,
    validate: (v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
        ? null
        : 'doit être une adresse email valide',
  },
  {
    key: 'SUPER_ADMIN_PASSWORD',
    required: true,
    validate: (v) => {
      if (WEAK_SECRETS.has(v.toLowerCase())) {
        return 'valeur trop faible/par défaut : choisissez un mot de passe robuste';
      }
      if (v.length < 12) {
        return `doit faire au moins 12 caractères (actuellement ${v.length})`;
      }
      return null;
    },
  },
  // ─── Stockage objets Cloudflare R2 (cf. src/storage/) ─────────
  // Les 6 variables sont obligatoires : le module de stockage (documents médicaux,
  // avatars…) doit refuser de démarrer plutôt que d'échouer au 1er upload.
  { key: 'R2_ACCOUNT_ID', required: true },
  { key: 'R2_ACCESS_KEY_ID', required: true },
  { key: 'R2_SECRET_ACCESS_KEY', required: true },
  { key: 'R2_BUCKET_PUBLIC', required: true },
  { key: 'R2_BUCKET_PRIVATE', required: true },
  {
    key: 'R2_PUBLIC_URL',
    required: true,
    validate: (v) =>
      v.startsWith('https://') || v.startsWith('http://')
        ? null
        : 'doit être une URL (ex. https://cdn.medconnecte.com), base des liens publics',
  },
  // Secret partagé avec les services IA (en-tête X-MedConnecte-Secret).
  // Optionnel, sans défaut : absent, le contrôle est désactivé des deux côtés.
  {
    key: 'AI_SHARED_SECRET',
    required: false,
    validate: (v) =>
      v.length < 32
        ? `doit faire au moins 32 caractères (actuellement ${v.length})`
        : null,
  },
  // Ouverture volontaire de Swagger en production (préproduction par exemple).
  // Optionnelle, sans défaut : absente, Swagger reste fermé en production.
  {
    key: 'SWAGGER_ENABLED',
    required: false,
    validate: (v) =>
      v === 'true' || v === 'false' ? null : "doit valoir 'true' ou 'false'",
  },
  // Mode démo (cf. src/demo/) : comptes et données fictives, connexion sans mot de
  // passe. Inactif par défaut ; seule la valeur `true` (casse indifférente) l'active.
  {
    key: 'DEMO_MODE',
    required: false,
    default: 'false',
    validate: (v) =>
      ['true', 'false'].includes(v.toLowerCase())
        ? null
        : "doit valoir 'true' ou 'false'",
  },
  // Remise à zéro des données démo au démarrage (purge puis recréation), seulement
  // si DEMO_MODE est actif. Inactive par défaut ; seule `true` (casse indifférente) l'active.
  {
    key: 'DEMO_RESET',
    required: false,
    default: 'false',
    validate: (v) =>
      ['true', 'false'].includes(v.toLowerCase())
        ? null
        : "doit valoir 'true' ou 'false'",
  },
  // Sessions par appareil (TB3). Actives par défaut ; `false` revient à l'ancien
  // refresh unique par utilisateur (retour arrière, sans redéploiement).
  {
    key: 'SESSIONS_MULTI_APPAREILS',
    required: false,
    default: 'true',
    validate: (v) =>
      ['true', 'false'].includes(v.toLowerCase())
        ? null
        : "doit valoir 'true' ou 'false'",
  },
  // Application mobile (TB5) : versions et URL par plateforme, lues par GET /app/version et la garde de version. Absentes : 0.0.0, personne n'est bloqué.
  {
    key: 'APP_VERSION_MINIMALE_ANDROID',
    required: false,
    default: VERSION_PAR_DEFAUT,
    validate: versionValide,
  },
  {
    key: 'APP_VERSION_RECOMMANDEE_ANDROID',
    required: false,
    default: VERSION_PAR_DEFAUT,
    validate: versionValide,
  },
  {
    key: 'APP_VERSION_MINIMALE_IOS',
    required: false,
    default: VERSION_PAR_DEFAUT,
    validate: versionValide,
  },
  {
    key: 'APP_VERSION_RECOMMANDEE_IOS',
    required: false,
    default: VERSION_PAR_DEFAUT,
    validate: versionValide,
  },
  {
    key: 'APP_URL_TELECHARGEMENT_ANDROID',
    required: false,
    validate: urlValide,
  },
  {
    key: 'APP_URL_TELECHARGEMENT_IOS',
    required: false,
    validate: urlValide,
  },
  // Configuration publique (GET /app/config) : numéro d'urgence, versions des documents légaux, fonctions activées.
  {
    key: 'NUMERO_URGENCE_MEDICALE',
    required: false,
    default: NUMERO_URGENCE_MEDICALE_PAR_DEFAUT,
    validate: (v) =>
      /^\+?[0-9]{2,15}$/.test(v)
        ? null
        : 'doit être un numéro de téléphone (chiffres seulement, ex. 15)',
  },
  {
    key: 'VERSION_CGU',
    required: false,
    default: VERSION_DOCUMENT_PAR_DEFAUT,
    validate: (v) =>
      /^[0-9A-Za-z._-]{1,20}$/.test(v)
        ? null
        : 'doit être un numéro de version court (ex. 1.0 ou 2026-10)',
  },
  {
    key: 'VERSION_POLITIQUE_CONFIDENTIALITE',
    required: false,
    default: VERSION_DOCUMENT_PAR_DEFAUT,
    validate: (v) =>
      /^[0-9A-Za-z._-]{1,20}$/.test(v)
        ? null
        : 'doit être un numéro de version court (ex. 1.0 ou 2026-10)',
  },
  {
    key: 'FONCTION_ESPACE_SOIGNANT',
    required: false,
    default: 'false',
    validate: booleenValide,
  },
  {
    key: 'FONCTION_ANNULATION_SOS',
    required: false,
    default: 'false',
    validate: booleenValide,
  },
  {
    key: 'FONCTION_BOUTON_DEMO',
    required: false,
    default: 'false',
    validate: booleenValide,
  },
];

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  for (const rule of RULES) {
    const raw = config[rule.key];
    const value = raw === undefined || raw === null ? '' : String(raw).trim();

    if (!value) {
      if (rule.required) {
        errors.push(`  • ${rule.key} : manquante (obligatoire)`);
      } else if (rule.default !== undefined) {
        config[rule.key] = rule.default;
        process.env[rule.key] = rule.default;
      }
      continue;
    }

    const problem = rule.validate?.(value);
    if (problem) {
      errors.push(`  • ${rule.key} : ${problem}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `\n❌ Configuration invalide : l'application ne peut pas démarrer.\n` +
        `Variables d'environnement à corriger :\n${errors.join('\n')}\n`,
    );
  }

  return config;
}
