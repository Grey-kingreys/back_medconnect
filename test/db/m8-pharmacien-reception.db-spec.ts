import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'pg';
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

const M7 = '20261103100000_pharmacie_t1_unite_plaquette';
const M8 = '20261104100000_pharmacie_t1_pharmacien_reception';
const DROIT = 'reception:write';
const PHARMACIENS = [
  'rol-p1-pharmacien',
  'rol-p2-pharmacien',
  'rol-p3-pharmacien',
];
const TITULAIRES = ['rol-p1-admin', 'rol-p2-admin', 'rol-p3-admin'];
const PHARMACIEN_HOPITAL = 'rol-h1-pharmacien-test';
const PERSONNALISE_PHARMACIE = 'rol-p1-personnalise-test';

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

async function etatRoles(client: Client): Promise<Record<string, string[]>> {
  const ids = [
    ...PHARMACIENS,
    ...TITULAIRES,
    PHARMACIEN_HOPITAL,
    PERSONNALISE_PHARMACIE,
  ];
  const etat: Record<string, string[]> = {};
  for (const id of ids) etat[id] = await codesDuRole(client, id);
  return etat;
}

async function nombreLiaisons(client: Client): Promise<number> {
  const res = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM "RolePermission"',
  );
  return res.rows[0].n;
}

describe('Migration M8, réception pour le rôle Pharmacien (D732)', () => {
  let base: BaseDeTest | undefined;
  let avant: Record<string, string[]>;
  let liaisonsAvant: number;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      jusqua: M7,
    });
    // Un rôle nommé Pharmacien dans un hôpital et un rôle personnalisé de pharmacie,
    // tous deux porteurs de stock:read pour que la ligne existe.
    await base.client.query(
      `INSERT INTO "AppRole" ("id", "nom", "isSystem", "structureId", "updatedAt")
       VALUES ($1, 'Pharmacien', false, 'str-hopital-1', now()),
              ($2, 'Vendeur senior (test)', false, 'str-pharma-1', now())`,
      [PHARMACIEN_HOPITAL, PERSONNALISE_PHARMACIE],
    );
    await base.client.query(
      `INSERT INTO "RolePermission" ("appRoleId", "permissionId")
       SELECT r."id", p."id" FROM "AppRole" r, "Permission" p
       WHERE r."id" IN ($1, $2) AND p."code" = 'caisse:utiliser'`,
      [PHARMACIEN_HOPITAL, PERSONNALISE_PHARMACIE],
    );
    avant = await etatRoles(base.client);
    liaisonsAvant = await nombreLiaisons(base.client);
  });

  afterAll(async () => {
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
      path.join(DOSSIER_MIGRATIONS, M8, 'migration.sql'),
      path.join(DOSSIER_RETOURS_ARRIERE, `${M8}.down.sql`),
    ]) {
      const lignes = lignesSql(fichier);
      expect(lignes[0]).toBe('BEGIN;');
      expect(lignes.at(-1)).toBe('COMMIT;');
    }
  });

  it("avant M8, aucun rôle Pharmacien n'a le droit", () => {
    for (const id of PHARMACIENS) expect(avant[id]).not.toContain(DROIT);
  });

  it('M8 haut : les rôles Pharmacien des pharmacies reçoivent le droit, rien d autre ne change', async () => {
    expect(await appliquerMigrations(client(), { apres: M7 })).toEqual([M8]);
    const apres = await etatRoles(client());
    for (const id of PHARMACIENS) {
      expect(apres[id]).toEqual([...avant[id], DROIT].sort());
      expect(apres[id]).not.toContain('inventaire:write');
      expect(apres[id]).not.toContain('marge:read');
    }
    // Titulaires, rôle Pharmacien d'un hôpital, rôle personnalisé : inchangés
    for (const id of [
      ...TITULAIRES,
      PHARMACIEN_HOPITAL,
      PERSONNALISE_PHARMACIE,
    ]) {
      expect(apres[id]).toEqual(avant[id]);
    }
    expect(await nombreLiaisons(client())).toBe(liaisonsAvant + 3);
  });

  it('un second passage n ajoute rien', async () => {
    const etat = await etatRoles(client());
    const liaisons = await nombreLiaisons(client());
    await appliquerSql(
      client(),
      readFileSync(path.join(DOSSIER_MIGRATIONS, M8, 'migration.sql'), 'utf8'),
    );
    expect(await etatRoles(client())).toEqual(etat);
    expect(await nombreLiaisons(client())).toBe(liaisons);
  });

  it('retour arrière : le droit est retiré des seuls rôles Pharmacien des pharmacies, puis haut de nouveau', async () => {
    await appliquerRetourArriere(client(), M8);
    expect(await etatRoles(client())).toEqual(avant);
    expect(await nombreLiaisons(client())).toBe(liaisonsAvant);
    // Le droit des titulaires, lui, est conservé
    for (const id of TITULAIRES) expect(avant[id]).toContain(DROIT);

    expect(await appliquerMigrations(client(), { apres: M7 })).toEqual([M8]);
    for (const id of PHARMACIENS) {
      expect(await codesDuRole(client(), id)).toContain(DROIT);
    }
  });
});
