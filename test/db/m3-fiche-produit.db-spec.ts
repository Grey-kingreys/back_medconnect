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
import {
  chargerFormatActuel,
  type ResumeFormatActuel,
} from './fixtures/format-actuel';

const M1 = '20261026090000_pharmacie_t1_permissions';
const M2 = '20261026100000_pharmacie_t1_points_de_vente';
const M3 = '20261026110000_pharmacie_t1_fiche_produit';
const COLONNES_AVANT = [
  'dateExpiration',
  'disponible',
  'id',
  'medicamentId',
  'notes',
  'prixUnitaire',
  'quantite',
  'structureId',
  'updatedAt',
];
const PAR_DEFAUT =
  'SELECT count(*)::int AS n FROM "StockMedicament" WHERE "uniteMinimale" = \'UNITE\' AND "coefficientBoite" = 1 AND "prixUnite" IS NULL AND NOT "deconditionnable" AND "toleranceInventaire" IS NULL AND NOT "qualifie" AND "archiveLe" IS NULL';

function lignesSql(fichier: string): string[] {
  return readFileSync(fichier, 'utf8')
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== '' && !ligne.startsWith('--'));
}

async function compter(client: Client, sql: string): Promise<number> {
  const res = await client.query<{ n: number }>(sql);
  return res.rows[0].n;
}

async function colonnes(client: Client): Promise<string[]> {
  const res = await client.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StockMedicament' ORDER BY column_name",
  );
  return res.rows.map((l) => l.column_name);
}

async function fiches(client: Client) {
  const res = await client.query<{
    id: string;
    quantite: number;
    prixUnitaire: number | null;
  }>(
    'SELECT "id", "quantite", "prixUnitaire" FROM "StockMedicament" ORDER BY "id"',
  );
  return res.rows;
}

describe('Migration M3, fiche produit étendue (PB06)', () => {
  let base: BaseDeTest | undefined;
  let appliquees: string[];
  let resume: ResumeFormatActuel;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    resume = await chargerFormatActuel(base.client);
    // Jamais au-delà de M3 : le retour arrière doit rester applicable quand M4 référencera ces colonnes.
    appliquees = await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      jusqua: M3,
    });
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
      path.join(DOSSIER_MIGRATIONS, M3, 'migration.sql'),
      path.join(DOSSIER_RETOURS_ARRIERE, `${M3}.down.sql`),
    ]) {
      const lignes = lignesSql(fichier);
      expect(lignes[0]).toBe('BEGIN;');
      expect(lignes.at(-1)).toBe('COMMIT;');
    }
  });

  it('M3 haut : appliquée après M2, les 40 fiches prennent les valeurs par défaut, quantités et prix intacts', async () => {
    expect(appliquees).toEqual([M1, M2, M3]);
    expect(await compter(client(), PAR_DEFAUT)).toBe(40);
    expect(await fiches(client())).toEqual(
      resume.fiches
        .map((f) => ({
          id: f.id,
          quantite: f.quantite,
          prixUnitaire: f.prixUnitaire,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    expect(
      await compter(
        client(),
        'SELECT count(*)::int AS n FROM "StockMedicament" WHERE "createdAt" > now() - interval \'10 minutes\'',
      ),
    ).toBe(40);
  });

  it('M3 haut : enum UniteMinimale dans l ordre du plan', async () => {
    const res = await client().query<{ r: string }>(
      'SELECT enum_range(NULL::"UniteMinimale")::text AS r',
    );
    expect(res.rows[0].r).toBe(
      '{COMPRIME,GELULE,ML,SACHET,GRAMME,AMPOULE,UNITE}',
    );
  });

  it('M3 haut : les quatre contraintes refusent une fiche incohérente', async () => {
    const refusees: [string, string][] = [
      [
        'UPDATE "StockMedicament" SET "coefficientBoite" = 0 WHERE "id" = \'stk-06\'',
        'StockMedicament_coefficientBoite_check',
      ],
      [
        'UPDATE "StockMedicament" SET "prixUnite" = 100 WHERE "id" = \'stk-06\'',
        'StockMedicament_prixUnite_deconditionnable_check',
      ],
      [
        'UPDATE "StockMedicament" SET "deconditionnable" = true, "prixUnite" = 0 WHERE "id" = \'stk-06\'',
        'StockMedicament_prixUnite_check',
      ],
      [
        'UPDATE "StockMedicament" SET "toleranceInventaire" = -1 WHERE "id" = \'stk-06\'',
        'StockMedicament_toleranceInventaire_check',
      ],
    ];
    for (const [requete, contrainte] of refusees) {
      await expect(client().query(requete)).rejects.toMatchObject({
        constraint: contrainte,
      });
    }
    const ok = await client().query(
      'UPDATE "StockMedicament" SET "deconditionnable" = true, "prixUnite" = 100, "coefficientBoite" = 20, "toleranceInventaire" = 0 WHERE "id" = \'stk-06\'',
    );
    expect(ok.rowCount).toBe(1);
  });

  it('retour arrière : haut, bas, haut sur la base chargée', async () => {
    const avant = await fiches(client());
    await appliquerRetourArriere(client(), M3);
    expect(await colonnes(client())).toEqual(COLONNES_AVANT);
    expect(
      await compter(
        client(),
        "SELECT count(*)::int AS n FROM pg_type WHERE typname = 'UniteMinimale'",
      ),
    ).toBe(0);
    expect(
      await compter(
        client(),
        "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = '\"StockMedicament\"'::regclass AND contype = 'c'",
      ),
    ).toBe(0);
    expect(await fiches(client())).toEqual(avant);
    expect(
      await compter(client(), 'SELECT count(*)::int AS n FROM "PointDeVente"'),
    ).toBe(3);
    expect(
      await appliquerMigrations(client(), { apres: M2, jusqua: M3 }),
    ).toEqual([M3]);
    expect(await compter(client(), PAR_DEFAUT)).toBe(40);
  });
});
