/**
 * Liste, en lecture seule, les comptes dont le rattachement à un établissement est
 * incomplet ou incohérent (User.structureId et Structure.adminId). N'écrit rien et ne
 * propose aucune requête : le rattrapage éventuel est une décision du porteur.
 *
 * Usage (dev, worktree ou arbre principal) : npm run structures:rattachements
 * Usage (production) :
 *   docker compose -f compose.yml -f compose.prod.yml run --rm --entrypoint "" backend node dist/scripts/structures-rattachements.js
 * Lit DATABASE_URL.
 */
import { Client } from 'pg';
import {
  analyserRattachements,
  ROLES_ETABLISSEMENT,
  type CompteRattachement,
} from '../src/user/rattachements-structure';

async function principal(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL n'est pas définie.");
    process.exitCode = 1;
    return;
  }
  const client = new Client({ connectionString });
  await client.connect();
  let comptes: CompteRattachement[];
  try {
    await client.query('BEGIN READ ONLY');
    const marqueurs = ROLES_ETABLISSEMENT.map((_, i) => `$${i + 1}`).join(', ');
    const resultat = await client.query<CompteRattachement>(
      `SELECT u.id, u.email, u.role::text AS role, u."structureId",
       m.nom AS "structureNom",
       a.id AS "structureAdministreeId", a.nom AS "structureAdministreeNom"
FROM "User" u
LEFT JOIN "Structure" m ON m.id = u."structureId"
LEFT JOIN "Structure" a ON a."adminId" = u.id
WHERE u.role::text IN (${marqueurs}) OR a.id IS NOT NULL
ORDER BY u."createdAt"`,
      [...ROLES_ETABLISSEMENT],
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

  const analyse = analyserRattachements(comptes);
  console.log(
    'Rattachement des comptes aux établissements (lecture seule, aucune donnée modifiée)',
  );
  console.log(`Comptes examinés : ${analyse.total}`);

  console.log('');
  console.log(
    `Administrateurs sans établissement de rattachement : ${analyse.adminsSansStructure.length}`,
  );
  for (const c of analyse.adminsSansStructure) {
    console.log(
      `  - ${c.id} | ${c.email} | ${c.role} | administre « ${c.structureAdministreeNom} » (${c.structureAdministreeId})`,
    );
  }

  console.log('');
  console.log(
    `Administrateurs rattachés à un autre établissement que celui qu'ils administrent : ${analyse.adminsRattachesAilleurs.length}`,
  );
  for (const c of analyse.adminsRattachesAilleurs) {
    console.log(
      `  - ${c.id} | ${c.email} | ${c.role} | rattaché à « ${c.structureNom} » (${c.structureId}) | administre « ${c.structureAdministreeNom} » (${c.structureAdministreeId})`,
    );
  }

  console.log('');
  console.log(
    `Comptes d'un rôle d'établissement sans aucun établissement : ${analyse.rolesSansStructure.length}`,
  );
  for (const c of analyse.rolesSansStructure) {
    console.log(`  - ${c.id} | ${c.email} | ${c.role}`);
  }

  const aVerifier =
    analyse.adminsSansStructure.length +
    analyse.adminsRattachesAilleurs.length +
    analyse.rolesSansStructure.length;
  console.log('');
  console.log(`Résultat : ${aVerifier} compte(s) à vérifier.`);
}

principal().catch((erreur: unknown) => {
  console.error(
    'Échec du contrôle des rattachements :',
    erreur instanceof Error ? erreur.message : erreur,
  );
  process.exitCode = 1;
});
