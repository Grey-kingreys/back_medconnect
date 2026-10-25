// Configuration Prisma réservée au harnais (PB05, D480) : compare une base jetable
// migrée au schéma courant (prisma migrate diff). Ne lit que HARNAIS_DATABASE_URL et
// refuse toute base hors mc_test_.
import path from 'node:path';
import { defineConfig } from 'prisma/config';

const url = process.env['HARNAIS_DATABASE_URL'] ?? '';
if (!/\/mc_test_[0-9a-f]{12}(\?|$)/.test(url)) {
  throw new Error(
    'Configuration réservée au harnais de test : base mc_test_ attendue.',
  );
}

const racine = process.cwd();

export default defineConfig({
  schema: path.join(racine, 'prisma', 'schema.prisma'),
  migrations: { path: path.join(racine, 'prisma', 'migrations') },
  datasource: { url },
});
