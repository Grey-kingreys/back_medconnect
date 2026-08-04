/**
 * Variables d'environnement factices pour les tests unitaires.
 *
 * `validateEnv` (fail-fast, cf. src/config/env.validation.ts) s'exécute dès l'import
 * d'`AppModule` via `ConfigModule.forRoot`. Sans ces valeurs, tout test important le
 * module échouerait au chargement. Aucune n'ouvre de connexion : les specs unitaires
 * ne compilent pas le module Nest (Prisma/Redis sont mockés ou jamais instanciés).
 *
 * Les valeurs respectent les règles de validation (préfixes, longueurs, hex) sans
 * être de vrais secrets. `setupFiles` garantit leur présence avant les imports.
 */
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/medconnecte_test';
process.env.JWT_SECRET ??= 'test-secret-non-utilise-pour-signer-quoi-que-ce-soit';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.RESEND_API_KEY ??= 're_test_dummy_key';
process.env.SUPER_ADMIN_EMAIL ??= 'superadmin@test.local';
process.env.SUPER_ADMIN_PASSWORD ??= 'mot-de-passe-test-robuste';
// Stockage R2 (cf. src/storage/) — valeurs factices : aucun appel réseau en test.
process.env.R2_ACCOUNT_ID ??= 'test-account-id';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key-id';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-access-key';
process.env.R2_BUCKET_PUBLIC ??= 'medconnecte-public-test';
process.env.R2_BUCKET_PRIVATE ??= 'medconnecte-private-test';
process.env.R2_PUBLIC_URL ??= 'https://cdn.test.local';
process.env.NODE_ENV ??= 'test';
