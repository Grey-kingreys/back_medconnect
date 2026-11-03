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

const M6 = '20261026140000_pharmacie_t1_ventes_pieces';
const M7 = '20261103100000_pharmacie_t1_unite_plaquette';
const AVANT = '{COMPRIME,GELULE,ML,SACHET,GRAMME,AMPOULE,UNITE}';
const APRES = '{COMPRIME,GELULE,ML,SACHET,GRAMME,AMPOULE,PLAQUETTE,UNITE}';

function lignesSql(fichier: string): string[] {
  return readFileSync(fichier, 'utf8')
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== '' && !ligne.startsWith('--'));
}

async function valeursEnum(client: Client): Promise<string> {
  const res = await client.query<{ r: string }>(
    'SELECT enum_range(NULL::"UniteMinimale")::text AS r',
  );
  return res.rows[0].r;
}

async function defautUnite(client: Client): Promise<string> {
  const res = await client.query<{ d: string }>(
    "SELECT column_default AS d FROM information_schema.columns WHERE table_name = 'StockMedicament' AND column_name = 'uniteMinimale'",
  );
  return res.rows[0].d;
}

describe('Migration M7, unité PLAQUETTE (PB21)', () => {
  let base: BaseDeTest | undefined;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      jusqua: M6,
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
      path.join(DOSSIER_MIGRATIONS, M7, 'migration.sql'),
      path.join(DOSSIER_RETOURS_ARRIERE, `${M7}.down.sql`),
    ]) {
      const lignes = lignesSql(fichier);
      expect(lignes[0]).toBe('BEGIN;');
      expect(lignes.at(-1)).toBe('COMMIT;');
    }
  });

  it('haut, écriture, bas refusé, bas accepté, haut de nouveau', async () => {
    expect(await valeursEnum(client())).toBe(AVANT);
    const fiches = await client().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM "StockMedicament"',
    );

    // Haut : 8 valeurs dans l'ordre, les fiches existantes ne changent pas
    expect(
      await appliquerMigrations(client(), { apres: M6, jusqua: M7 }),
    ).toEqual([M7]);
    expect(await valeursEnum(client())).toBe(APRES);
    expect(
      (
        await client().query<{ n: number }>(
          'SELECT count(*)::int AS n FROM "StockMedicament"',
        )
      ).rows[0].n,
    ).toBe(fiches.rows[0].n);

    // Une fiche PLAQUETTE écrite
    await client().query(
      'UPDATE "StockMedicament" SET "uniteMinimale" = \'PLAQUETTE\', "coefficientBoite" = 10 WHERE "id" = \'stk-06\'',
    );

    // Bas refusé tant qu'elle existe, rien n'est modifié
    await expect(appliquerRetourArriere(client(), M7)).rejects.toThrow(
      /1 fiche\(s\) produit utilisent l'unité PLAQUETTE/,
    );
    expect(await valeursEnum(client())).toBe(APRES);
    expect(
      (
        await client().query<{ u: string }>(
          'SELECT "uniteMinimale"::text AS u FROM "StockMedicament" WHERE "id" = \'stk-06\'',
        )
      ).rows[0].u,
    ).toBe('PLAQUETTE');

    // Fiche changée, bas accepté : 7 valeurs, défaut UNITE
    await client().query(
      'UPDATE "StockMedicament" SET "uniteMinimale" = \'COMPRIME\' WHERE "id" = \'stk-06\'',
    );
    await appliquerRetourArriere(client(), M7);
    expect(await valeursEnum(client())).toBe(AVANT);
    expect(await defautUnite(client())).toContain("'UNITE'");
    expect(
      (
        await client().query<{ u: string }>(
          'SELECT "uniteMinimale"::text AS u FROM "StockMedicament" WHERE "id" = \'stk-06\'',
        )
      ).rows[0].u,
    ).toBe('COMPRIME');
    const anciens = await client().query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_type WHERE typname = 'UniteMinimale_ancien'",
    );
    expect(anciens.rows[0].n).toBe(0);

    // Haut de nouveau
    expect(
      await appliquerMigrations(client(), { apres: M6, jusqua: M7 }),
    ).toEqual([M7]);
    expect(await valeursEnum(client())).toBe(APRES);
  });
});
