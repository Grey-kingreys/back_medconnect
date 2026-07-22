/**
 * Validation centralisée des variables d'environnement (fail-fast au boot).
 *
 * Branchée sur `ConfigModule.forRoot({ validate: validateEnv })` → l'application
 * refuse de démarrer avec un message clair listant TOUTES les variables
 * manquantes/invalides d'un coup, plutôt que de planter de façon opaque dans le
 * constructeur d'un service (EncryptionService, EmailService…).
 *
 * Choix : validation maison (zéro dépendance) plutôt que Joi/class-validator,
 * pour ne pas alourdir le lock (cf. CLAUDE.md — node_modules = volume Docker).
 */

const WEAK_SECRETS = new Set(['secret', 'medconnecte-secret-key', 'changeme', 'password']);

type Rule = {
  key: string;
  required: boolean;
  /** Retourne un message d'erreur si invalide, sinon null. Non appelé si absent. */
  validate?: (value: string) => string | null;
  /** Valeur par défaut appliquée à process.env si absente (et non requise). */
  default?: string;
};

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
        return 'valeur trop faible/par défaut — générez un secret aléatoire (ex. `openssl rand -hex 32`)';
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
      v.startsWith('re_') ? null : "format inattendu (clé Resend attendue, préfixe 're_')",
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
  // Compte SUPER_ADMIN initial — créé automatiquement au boot par SuperAdminSeeder
  // s'il n'existe pas encore. Obligatoires : pas de mot de passe par défaut faible
  // sur un compte qui a tous les droits.
  {
    key: 'SUPER_ADMIN_EMAIL',
    required: true,
    validate: (v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'doit être une adresse email valide',
  },
  {
    key: 'SUPER_ADMIN_PASSWORD',
    required: true,
    validate: (v) => {
      if (WEAK_SECRETS.has(v.toLowerCase())) {
        return 'valeur trop faible/par défaut — choisissez un mot de passe robuste';
      }
      if (v.length < 12) {
        return `doit faire au moins 12 caractères (actuellement ${v.length})`;
      }
      return null;
    },
  },
];

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
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
      `\n❌ Configuration invalide — l'application ne peut pas démarrer.\n` +
        `Variables d'environnement à corriger :\n${errors.join('\n')}\n`,
    );
  }

  return config;
}
