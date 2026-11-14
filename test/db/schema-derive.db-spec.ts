import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  appliquerMigrations,
  creerBaseVide,
  masquerUrls,
  RACINE_DEPOT,
  supprimerBaseDeTest,
} from './harnais';

describe('Schéma Prisma et migrations (D480)', () => {
  it('le schéma Prisma correspond exactement à la base migrée (aucune dérive)', async () => {
    const base = await creerBaseVide();
    try {
      await appliquerMigrations(base.client);
      const resultat = spawnSync(
        process.execPath,
        [
          path.join(
            RACINE_DEPOT,
            'node_modules',
            'prisma',
            'build',
            'index.js',
          ),
          'migrate',
          'diff',
          '--from-config-datasource',
          '--to-schema',
          path.join(RACINE_DEPOT, 'prisma', 'schema.prisma'),
          '--exit-code',
          '--script',
          '--config',
          'test/db/fixtures/schema-courant/prisma.config.ts',
        ],
        {
          cwd: RACINE_DEPOT,
          env: { ...process.env, HARNAIS_DATABASE_URL: base.url },
          encoding: 'utf8',
          timeout: 150000,
        },
      );
      const sortie = masquerUrls(
        (resultat.stdout ?? '') + (resultat.stderr ?? ''),
      ).slice(0, 4000);
      if (resultat.status !== 0) {
        throw new Error(
          `Dérive entre prisma/schema.prisma et les migrations (statut ${String(resultat.status)}) : ${sortie}`,
        );
      }
      expect(resultat.status).toBe(0);
    } finally {
      await supprimerBaseDeTest(base);
    }
  });
});
