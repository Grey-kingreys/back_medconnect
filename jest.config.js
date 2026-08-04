/**
 * Configuration Jest — tests unitaires (`*.spec.ts` sous `src/`).
 *
 * Les tests e2e ont leur propre config (`test/jest-e2e.json`, lancée par
 * `npm run test:e2e`) car ils démarrent l'app complète et exigent Postgres/Redis.
 * Ceux-ci n'ont besoin d'aucune infra : Prisma et les services externes sont mockés.
 *
 * `moduleDirectories` inclut la racine du projet pour résoudre les imports en
 * *bare specifier* (`src/...`, `generated/prisma/client`) alignés sur `baseUrl: "./"`
 * du tsconfig — sans quoi ts-jest ne les retrouve pas.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  // Pose l'env factice AVANT le chargement des modules (validateEnv est fail-fast
  // et s'exécute dès l'import d'AppModule).
  setupFiles: ['<rootDir>/test/jest.setup-env.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleDirectories: ['node_modules', '<rootDir>'],
  testEnvironment: 'node',
};
