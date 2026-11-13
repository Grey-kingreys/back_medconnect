import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'pg';
import { PERMISSION_CATALOG } from 'src/common/rbac/permissions.constants';
import {
  appliquerMigrations,
  appliquerRetourArriere,
  appliquerSql,
  BaseDeTest,
  creerBaseVide,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  DOSSIER_MIGRATIONS,
  DOSSIER_RETOURS_ARRIERE,
  supprimerBaseDeTest,
} from './harnais';
import { chargerFormatActuel } from './fixtures/format-actuel';

const M1 = '20261026090000_pharmacie_t1_permissions';
const M8 = '20261104100000_pharmacie_t1_pharmacien_reception';
const T1 = [
  'caisse:utiliser',
  'caisse:superviser',
  'cloture:gerer',
  'inventaire:write',
  'reception:write',
  'marge:read',
  'anomalie:gerer',
];
const M11 = '20261113100000_pharmacie_t2_cahier_credit';
const CREDIT = ['credit:read', 'credit:write'];
const TITULAIRES = ['rol-p1-admin', 'rol-p2-admin', 'rol-p3-admin'];
const VENDEURS = [
  'rol-p1-pharmacien',
  'rol-p2-pharmacien',
  'rol-p3-pharmacien',
];
const HOPITAL = ['rol-h1-admin', 'rol-h1-medecin'];

function lignesSql(fichier: string): string[] {
  return readFileSync(fichier, 'utf8')
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== '' && !ligne.startsWith('--'));
}

async function codesDuRole(client: Client, roleId: string): Promise<string[]> {
  const res = await client.query<{ code: string }>(
    'SELECT p."code" FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId" WHERE rp."appRoleId" = $1 ORDER BY p."code"',
    [roleId],
  );
  return res.rows.map((l) => l.code);
}

interface EtatRbac {
  permissions: number;
  roles: Record<string, string[]>;
}

async function etatRbac(client: Client): Promise<EtatRbac> {
  const total = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM "Permission"',
  );
  const roles: Record<string, string[]> = {};
  for (const id of [...TITULAIRES, ...VENDEURS, ...HOPITAL]) {
    roles[id] = await codesDuRole(client, id);
  }
  return { permissions: total.rows[0].n, roles };
}

async function lierT1HorsPharmacie(client: Client): Promise<number> {
  const res = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId" JOIN "AppRole" r ON r."id" = rp."appRoleId" LEFT JOIN "Structure" s ON s."id" = r."structureId" WHERE p."code" = ANY($1) AND (s."type" IS NULL OR s."type" <> \'PHARMACIE\')',
    [T1],
  );
  return res.rows[0].n;
}

describe('Migration M1, permissions de la tranche pharmacie 1 (PB03)', () => {
  let base: BaseDeTest | undefined;
  let etatAvant: EtatRbac;
  let appliquees: string[];

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    etatAvant = await etatRbac(base.client);
    appliquees = await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
  });

  afterAll(async () => {
    // Aucun client Prisma n'est ouvert : seule la base jetable est à supprimer.
    if (base) {
      await supprimerBaseDeTest(base);
    }
  });

  function client(): Client {
    if (!base) throw new Error('Base de test non créée.');
    return base.client;
  }

  it('la migration et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)', () => {
    for (const fichier of [
      path.join(DOSSIER_MIGRATIONS, M1, 'migration.sql'),
      path.join(DOSSIER_RETOURS_ARRIERE, `${M1}.down.sql`),
    ]) {
      const lignes = lignesSql(fichier);
      expect(lignes[0]).toBe('BEGIN;');
      expect(lignes.at(-1)).toBe('COMMIT;');
    }
  });

  it('M1 haut : les 7 permissions existent avec les libellés et la catégorie du catalogue', async () => {
    expect(appliquees[0]).toBe(M1);
    const res = await client().query<{
      code: string;
      libelle: string;
      categorie: string;
    }>(
      'SELECT "code", "libelle", "categorie" FROM "Permission" WHERE "code" = ANY($1) ORDER BY "code"',
      [T1],
    );
    expect(res.rows).toHaveLength(7);
    for (const ligne of res.rows) {
      const entree = PERMISSION_CATALOG.find((p) => p.code === ligne.code);
      expect(entree?.libelle).toBe(ligne.libelle);
      expect(entree?.categorie).toBe(ligne.categorie);
    }
  });

  it('M1 haut : titulaires avec les 7, pharmaciens avec caisse:utiliser seulement, rien d autre ne change', async () => {
    for (const id of TITULAIRES) {
      expect(await codesDuRole(client(), id)).toEqual(
        [...etatAvant.roles[id], ...T1, ...CREDIT].sort(),
      );
    }
    // La base porte toutes les migrations : M8 (D732) ajoute reception:write au rôle Pharmacien.
    for (const id of VENDEURS) {
      expect(await codesDuRole(client(), id)).toEqual(
        [
          ...etatAvant.roles[id],
          'caisse:utiliser',
          'reception:write',
          ...CREDIT,
        ].sort(),
      );
    }
    for (const id of HOPITAL) {
      expect(await codesDuRole(client(), id)).toEqual(etatAvant.roles[id]);
    }
  });

  it('M1 haut : aucun rôle hors pharmacie ne reçoit ces permissions', async () => {
    expect(await lierT1HorsPharmacie(client())).toBe(0);
  });

  it('M1 rejouée sur elle-même : aucune erreur ni doublon', async () => {
    const etatApres = await etatRbac(client());
    const sql = readFileSync(
      path.join(DOSSIER_MIGRATIONS, M1, 'migration.sql'),
      'utf8',
    );
    await expect(appliquerSql(client(), sql)).resolves.toBeUndefined();
    expect(await etatRbac(client())).toEqual(etatApres);
  });

  it('retour arrière : haut, bas, haut sur la base chargée', async () => {
    const etatHaut = await etatRbac(client());
    // M11 d'abord (ordre inverse des migrations) : elle s'appuie sur le catalogue de permissions.
    await appliquerRetourArriere(client(), M11);
    await appliquerRetourArriere(client(), M1);
    expect(await etatRbac(client())).toEqual(etatAvant);
    const restantes = await client().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM "Permission" WHERE "code" = ANY($1)',
      [T1],
    );
    expect(restantes.rows[0].n).toBe(0);

    await expect(
      appliquerMigrations(client(), {
        apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
        jusqua: M1,
      }),
    ).resolves.toEqual([M1]);
    // M8 (D732) s'appuie sur les permissions de M1 : la supprimer a retiré le droit des pharmaciens.
    await appliquerSql(
      client(),
      readFileSync(path.join(DOSSIER_MIGRATIONS, M8, 'migration.sql'), 'utf8'),
    );
    await appliquerSql(
      client(),
      readFileSync(path.join(DOSSIER_MIGRATIONS, M11, 'migration.sql'), 'utf8'),
    );
    expect(await etatRbac(client())).toEqual(etatHaut);
  });
});
