/**
 * Liste, en lecture seule, les comptes qui partagent un même numéro de téléphone
 * normalisé et les numéros non reconnus. À lancer AVANT la migration
 * 20261021120000_tb17_telephone_unique.
 *
 * Usage (dev) : docker compose exec -T backend npm run telephones:doublons
 * Usage (production) :
 *   docker compose -f compose.yml -f compose.prod.yml run --rm --entrypoint "" backend node dist/scripts/telephones-doublons.js
 * (n'applique pas les migrations). Lit DATABASE_URL.
 */
import { Client } from 'pg';
import {
  analyserDoublons,
  type CompteTelephone,
} from '../src/common/telephone/doublons-telephone';

async function principal(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL n'est pas définie.");
    process.exitCode = 1;
    return;
  }
  const client = new Client({ connectionString });
  await client.connect();
  let comptes: CompteTelephone[];
  try {
    await client.query('BEGIN READ ONLY');
    const resultat = await client.query<{
      id: string;
      email: string;
      role: string;
      telephone: string;
      createdAt: Date;
    }>(
      'SELECT id, email, role::text AS role, telephone, "createdAt" FROM "User" WHERE telephone IS NOT NULL',
    );
    comptes = resultat.rows;
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Erreur ignorée : la transaction est en lecture seule.
    }
    await client.end();
  }

  const analyse = analyserDoublons(comptes);
  console.log(
    'Numéros de téléphone en double (lecture seule, aucune donnée modifiée)',
  );
  console.log(`Comptes avec un numéro : ${analyse.total}`);
  for (const groupe of analyse.doublons) {
    console.log('');
    console.log(`${groupe.numero} : ${groupe.comptes.length} comptes`);
    groupe.comptes.forEach((c, i) => {
      console.log(
        `  - ${c.id} | ${c.email} | ${c.role} | créé le ${c.createdAt.toISOString()} | saisi « ${c.telephone} »${i === 0 ? ' (plus ancien)' : ''}`,
      );
    });
  }
  console.log('');
  console.log(
    `Numéros non reconnus, ignorés par l'unicité : ${analyse.nonReconnus.length}`,
  );
  for (const c of analyse.nonReconnus) {
    console.log(
      `  - ${c.id} | ${c.email} | ${c.role} | saisi « ${c.telephone} »`,
    );
  }
  const concernes = analyse.doublons.reduce(
    (somme, g) => somme + g.comptes.length,
    0,
  );
  console.log('');
  console.log(
    `Résultat : ${analyse.doublons.length} numéro(s) en double, ${concernes} compte(s) concerné(s).`,
  );
}

principal().catch((erreur: unknown) => {
  console.error(
    'Échec de la recherche des doublons :',
    erreur instanceof Error ? erreur.message : erreur,
  );
  process.exitCode = 1;
});
