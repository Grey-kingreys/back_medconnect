import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'pg';
import {
  appliquerMigrations,
  appliquerRetourArriere,
  BaseDeTest,
  creerBaseVide,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  DOSSIER_MIGRATIONS,
  DOSSIER_RETOURS_ARRIERE,
  supprimerBaseDeTest,
} from './harnais';
import { chargerFormatActuel } from './fixtures/format-actuel';

const M10 = '20261112100000_pharmacie_t2_telephone_prescripteur';
const M11 = '20261113100000_pharmacie_t2_cahier_credit';
const PHARMACIENS = [
  'rol-p1-pharmacien',
  'rol-p2-pharmacien',
  'rol-p3-pharmacien',
];
const TITULAIRES = ['rol-p1-admin', 'rol-p2-admin', 'rol-p3-admin'];
const PHARMACIEN_HOPITAL = 'rol-h1-pharmacien-test';
const DROITS = ['credit:read', 'credit:write'];

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

async function nombre(client: Client, requete: string): Promise<number> {
  const res = await client.query<{ n: number }>(requete);
  return Number(res.rows[0].n);
}

describe('Migration M11, cahier de crédit', () => {
  let base: BaseDeTest | undefined;
  let avant: Record<string, string[]>;
  let ventesAvant: number;

  function client(): Client {
    if (!base) throw new Error('Base de test non créée.');
    return base.client;
  }

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      jusqua: M10,
    });
    await base.client.query(
      `INSERT INTO "AppRole" ("id", "nom", "isSystem", "structureId", "updatedAt") VALUES ($1, 'Pharmacien', false, 'str-hopital-1', now())`,
      [PHARMACIEN_HOPITAL],
    );
    avant = {};
    for (const id of [...PHARMACIENS, ...TITULAIRES, PHARMACIEN_HOPITAL]) {
      avant[id] = await codesDuRole(base.client, id);
    }
    ventesAvant = await nombre(
      base.client,
      'SELECT count(*) AS n FROM "Vente"',
    );
  });

  afterAll(async () => {
    if (base) await supprimerBaseDeTest(base);
  });

  it('la migration et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)', () => {
    for (const fichier of [
      path.join(DOSSIER_MIGRATIONS, M11, 'migration.sql'),
      path.join(DOSSIER_RETOURS_ARRIERE, `${M11}.down.sql`),
    ]) {
      const lignes = lignesSql(fichier);
      expect(lignes[0]).toBe('BEGIN;');
      expect(lignes.at(-1)).toBe('COMMIT;');
    }
  });

  it('M11 haut : tables, mode CREDIT, droits des titulaires et des Pharmacien des pharmacies seulement', async () => {
    expect(
      await appliquerMigrations(client(), { apres: M10, jusqua: M11 }),
    ).toEqual([M11]);
    for (const table of [
      'ClientCredit',
      'RemboursementCredit',
      'EcheanceCredit',
    ]) {
      expect(
        await nombre(
          client(),
          `SELECT count(*) AS n FROM information_schema.tables WHERE table_name = '${table}'`,
        ),
      ).toBe(1);
    }
    expect(
      await nombre(
        client(),
        `SELECT count(*) AS n FROM "ModePaiement" WHERE "code" = 'CREDIT' AND "comptagePhysique" = false AND "referenceAutorisee" = false`,
      ),
    ).toBe(1);
    for (const id of [...PHARMACIENS, ...TITULAIRES]) {
      const codes = await codesDuRole(client(), id);
      expect(codes).toEqual([...avant[id], ...DROITS].sort());
    }
    expect(await codesDuRole(client(), PHARMACIEN_HOPITAL)).toEqual(
      avant[PHARMACIEN_HOPITAL],
    );
    expect(await nombre(client(), 'SELECT count(*) AS n FROM "Vente"')).toBe(
      ventesAvant,
    );
  });

  it('un remboursement est immuable', async () => {
    const c = client();
    await c.query(
      `INSERT INTO "ClientCredit" ("id", "structureId", "nomComplet", "auteurId", "updatedAt") VALUES ('cc-1', 'str-pharma-1', 'Client test', 'usr-pharm-p1', now())`,
    );
    await c.query(
      `INSERT INTO "RemboursementCredit" ("id", "clientCreditId", "montant", "auteurId") VALUES ('rb-1', 'cc-1', 1000, 'usr-pharm-p1')`,
    );
    await expect(
      c.query(`UPDATE "RemboursementCredit" SET "montant" = 2000`),
    ).rejects.toThrow();
    await expect(
      c.query(
        `INSERT INTO "RemboursementCredit" ("id", "clientCreditId", "montant", "auteurId") VALUES ('rb-2', 'cc-1', 0, 'usr-pharm-p1')`,
      ),
    ).rejects.toThrow();
  });

  it('retour arrière : tout est retiré, les droits repartent, puis M11 monte de nouveau', async () => {
    // Le client et son remboursement n'ont aucune vente : le retour est permis.
    await appliquerRetourArriere(client(), M11);
    for (const table of [
      'ClientCredit',
      'RemboursementCredit',
      'EcheanceCredit',
    ]) {
      expect(
        await nombre(
          client(),
          `SELECT count(*) AS n FROM information_schema.tables WHERE table_name = '${table}'`,
        ),
      ).toBe(0);
    }
    expect(
      await nombre(
        client(),
        `SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'Vente' AND column_name = 'clientCreditId'`,
      ),
    ).toBe(0);
    expect(
      await nombre(
        client(),
        `SELECT count(*) AS n FROM "ModePaiement" WHERE "code" = 'CREDIT'`,
      ),
    ).toBe(0);
    for (const id of [...PHARMACIENS, ...TITULAIRES, PHARMACIEN_HOPITAL]) {
      expect(await codesDuRole(client(), id)).toEqual(avant[id]);
    }
    expect(
      await appliquerMigrations(client(), { apres: M10, jusqua: M11 }),
    ).toEqual([M11]);
    for (const id of PHARMACIENS) {
      expect(await codesDuRole(client(), id)).toEqual(
        expect.arrayContaining(DROITS),
      );
    }
  });

  it('retour arrière refusé tant qu une vente à crédit existe', async () => {
    const c = client();
    // Paiement CREDIT sur une vente de la reprise : suffit à bloquer le retour (pièce immuable).
    const vente = await c.query<{ id: string }>(
      `SELECT "id" FROM "Vente" LIMIT 1`,
    );
    if (vente.rows.length === 0) return;
    await c.query(
      `INSERT INTO "Paiement" ("id", "venteId", "sessionCaisseId", "modePaiementId", "montant")
       SELECT 'pa-credit', v."id", v."sessionCaisseId", m."id", 1 FROM "Vente" v, "ModePaiement" m WHERE m."code" = 'CREDIT' LIMIT 1`,
    );
    await expect(appliquerRetourArriere(c, M11)).rejects.toThrow(/refusé/);
  });
});
