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
import {
  chargerFormatActuel,
  type ResumeFormatActuel,
} from './fixtures/format-actuel';

const M1 = '20261026090000_pharmacie_t1_permissions';
const M2 = '20261026100000_pharmacie_t1_points_de_vente';
const M3 = '20261026110000_pharmacie_t1_fiche_produit';
const M4 = '20261026120000_pharmacie_t1_lots_mouvements';
const JOUR_MS = 24 * 60 * 60 * 1000;

function lignesSql(fichier: string): string[] {
  return readFileSync(fichier, 'utf8')
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== '' && !ligne.startsWith('--'));
}

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function compter(client: Client, sql: string): Promise<number> {
  const res = await client.query<{ n: number }>(sql);
  return res.rows[0].n;
}

async function pv(client: Client, structureId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
    [structureId],
  );
  return res.rows[0].id;
}

async function lotTechnique(client: Client, stockId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "LotStock" WHERE "stockMedicamentId" = $1 AND "lotTechnique"',
    [stockId],
  );
  return res.rows[0].id;
}

async function mouvement(
  client: Client,
  m: {
    evenementId: string;
    stockId: string;
    lotId: string | null;
    type: string;
    quantite: number;
    piece: string;
    pointDeVenteId?: string;
  },
): Promise<void> {
  const pointDeVenteId =
    m.pointDeVenteId ??
    (
      await client.query<{ id: string }>(
        'SELECT pv."id" FROM "StockMedicament" f JOIN "PointDeVente" pv ON pv."structureId" = f."structureId" AND pv."ordre" = 1 WHERE f."id" = $1',
        [m.stockId],
      )
    ).rows[0].id;
  await client.query(
    'INSERT INTO "MouvementStock" ("id", "evenementId", "pointDeVenteId", "stockMedicamentId", "lotId", "type", "quantite", "pieceOrigineType") VALUES ($1, $1, $2, $3, $4, $5::"TypeMouvementStock", $6, $7::"TypePiece")',
    [
      m.evenementId,
      pointDeVenteId,
      m.stockId,
      m.lotId,
      m.type,
      m.quantite,
      m.piece,
    ],
  );
}

async function inserer(
  client: Client,
  lot: {
    id: string;
    stockId: string;
    pointDeVenteId: string;
    numeroLot?: string;
    dateExpiration?: string;
    quantiteRecue: number;
    coutUnitaire: number;
    coutAchatBoite?: number;
    coefficientReception: number;
  },
): Promise<void> {
  await client.query(
    'INSERT INTO "LotStock" ("id", "stockMedicamentId", "pointDeVenteId", "numeroLot", "dateExpiration", "quantiteRecue", "coutUnitaire", "coutAchatBoite", "coefficientReception", "dateReception", "lotTechnique") VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, now(), false)',
    [
      lot.id,
      lot.stockId,
      lot.pointDeVenteId,
      lot.numeroLot ?? null,
      lot.dateExpiration ?? null,
      lot.quantiteRecue,
      lot.coutUnitaire,
      lot.coutAchatBoite ?? null,
      lot.coefficientReception,
    ],
  );
}

async function etatFiches(client: Client) {
  const res = await client.query<{
    id: string;
    quantite: number;
    disponible: boolean;
    date: string | null;
  }>(
    'SELECT "id", "quantite", "disponible", to_char("dateExpiration", \'YYYY-MM-DD HH24:MI:SS\') AS "date" FROM "StockMedicament" ORDER BY "id"',
  );
  return res.rows;
}

async function calcule(client: Client) {
  const res = await client.query<{ id: string; q: number }>(
    'SELECT f."id", COALESCE(sum(m."quantite"), 0)::int AS "q" FROM "StockMedicament" f LEFT JOIN "MouvementStock" m ON m."stockMedicamentId" = f."id" GROUP BY f."id" ORDER BY f."id"',
  );
  return res.rows;
}

async function photographie(client: Client) {
  const lots = await client.query(
    'SELECT * FROM "LotStock" ORDER BY "stockMedicamentId", "id"',
  );
  const mouvements = await client.query(
    'SELECT * FROM "MouvementStock" ORDER BY "evenementId"',
  );
  const agregatsLot = await client.query(
    'SELECT "lotId", "stockMedicamentId", "pointDeVenteId", "quantite" FROM "AgregatStockLot" ORDER BY "lotId"',
  );
  const agregatsProduit = await client.query(
    'SELECT "stockMedicamentId", "pointDeVenteId", "quantite" FROM "AgregatStockProduit" ORDER BY "stockMedicamentId", "pointDeVenteId"',
  );
  return {
    lots: lots.rows,
    mouvements: mouvements.rows,
    agregatsLot: agregatsLot.rows,
    agregatsProduit: agregatsProduit.rows,
  };
}

describe('Migration M4, lots, journal de stock et agrégats (PB07)', () => {
  let base: BaseDeTest | undefined;
  let appliquees: string[];
  let resume: ResumeFormatActuel;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    resume = await chargerFormatActuel(base.client);
    // Jamais au-delà de M4 : le retour arrière doit rester applicable quand M5 et M6 existeront.
    appliquees = await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      jusqua: M4,
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

  const plus = (jours: number): Date =>
    new Date(resume.aujourdhui.getTime() + jours * JOUR_MS);

  it('M4 et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)', () => {
    for (const fichier of [
      path.join(DOSSIER_MIGRATIONS, M4, 'migration.sql'),
      path.join(DOSSIER_RETOURS_ARRIERE, `${M4}.down.sql`),
    ]) {
      const lignes = lignesSql(fichier);
      expect(lignes[0]).toBe('BEGIN;');
      expect(lignes.at(-1)).toBe('COMMIT;');
    }
    const texte = readFileSync(
      path.join(DOSSIER_MIGRATIONS, M4, 'migration.sql'),
      'utf8',
    ).split(/\r?\n/);
    expect(
      texte.filter(
        (l) => l === '-- REPRISE: DEBUT (rejouable sans doublon, D418, D497)',
      ),
    ).toHaveLength(1);
    expect(texte.filter((l) => l === '-- REPRISE: FIN')).toHaveLength(1);
  });

  it("premier test : stock calculé égal au compteur d'origine, fiche par fiche", async () => {
    expect(appliquees).toEqual([M1, M2, M3, M4]);
    const attendu = resume.fiches
      .map((f) => ({ id: f.id, q: f.quantite }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(resume.fiches).toHaveLength(40);
    expect(await calcule(client())).toEqual(attendu);
    const agregat = await client().query<{ id: string; q: number }>(
      'SELECT f."id", COALESCE(sum(a."quantite"), 0)::int AS "q" FROM "StockMedicament" f LEFT JOIN "AgregatStockProduit" a ON a."stockMedicamentId" = f."id" GROUP BY f."id" ORDER BY f."id"',
    );
    expect(agregat.rows).toEqual(attendu);
  });

  it('reprise : un lot technique par fiche à quantité positive, aucune trace pour les fiches vides', async () => {
    expect(
      await compter(client(), 'SELECT count(*)::int AS n FROM "LotStock"'),
    ).toBe(33);
    for (const f of resume.fiches) {
      const lots = await client().query<{
        numeroLot: string | null;
        lotTechnique: boolean;
        coutUnitaire: number;
        coutAchatBoite: number | null;
        coefficientReception: number;
        quantiteRecue: number;
        fournisseurId: string | null;
        receptionId: string | null;
        auteurId: string | null;
        pointDeVenteId: string;
        jour: string | null;
      }>(
        'SELECT l.*, to_char(l."dateExpiration", \'YYYY-MM-DD\') AS "jour" FROM "LotStock" l WHERE l."stockMedicamentId" = $1',
        [f.id],
      );
      const agregats = await client().query(
        'SELECT "quantite" FROM "AgregatStockLot" WHERE "lotId" IN (SELECT "id" FROM "LotStock" WHERE "stockMedicamentId" = $1)',
        [f.id],
      );
      if (f.quantite === 0) {
        expect(lots.rows).toHaveLength(0);
        expect(agregats.rows).toHaveLength(0);
        expect(
          await compter(
            client(),
            `SELECT count(*)::int AS n FROM "MouvementStock" WHERE "stockMedicamentId" = '${f.id}'`,
          ),
        ).toBe(0);
        expect(
          await compter(
            client(),
            `SELECT count(*)::int AS n FROM "AgregatStockProduit" WHERE "stockMedicamentId" = '${f.id}'`,
          ),
        ).toBe(0);
        continue;
      }
      expect(lots.rows).toHaveLength(1);
      const lot = lots.rows[0];
      expect(lot.numeroLot).toBeNull();
      expect(lot.lotTechnique).toBe(true);
      expect(lot.coutUnitaire).toBe(0);
      expect(lot.coutAchatBoite).toBeNull();
      expect(lot.coefficientReception).toBe(1);
      expect(lot.quantiteRecue).toBe(f.quantite);
      expect(lot.fournisseurId).toBeNull();
      expect(lot.receptionId).toBeNull();
      expect(lot.auteurId).toBeNull();
      expect(lot.pointDeVenteId).toBe(await pv(client(), f.structureId));
      expect(lot.jour).toBe(
        f.dateExpiration ? jourIso(f.dateExpiration) : null,
      );
      expect(agregats.rows).toEqual([{ quantite: f.quantite }]);
    }
  });

  it('reprise : un mouvement RECEPTION pièce MIGRATION par lot, auteur système', async () => {
    const res = await client().query<{
      evenementId: string;
      stockMedicamentId: string;
      type: string;
      pieceOrigineType: string;
      pieceOrigineId: string | null;
      motif: string | null;
      lotId: string;
      quantite: number;
      auteurId: string | null;
      posteId: string | null;
      sequencePoste: number | null;
    }>('SELECT * FROM "MouvementStock" ORDER BY "stockMedicamentId"');
    expect(res.rows).toHaveLength(33);
    for (const m of res.rows) {
      const fiche = resume.fiches.find((f) => f.id === m.stockMedicamentId);
      expect(fiche).toBeDefined();
      expect(m.evenementId).toBe('migration:' + m.stockMedicamentId);
      expect(m.type).toBe('RECEPTION');
      expect(m.pieceOrigineType).toBe('MIGRATION');
      expect(m.pieceOrigineId).toBe(M4);
      expect(m.motif).toBe('Reprise du stock existant');
      expect(m.lotId).toBe(await lotTechnique(client(), m.stockMedicamentId));
      expect(m.quantite).toBe(fiche?.quantite);
      expect(m.auteurId).toBeNull();
      expect(m.posteId).toBeNull();
      expect(m.sequencePoste).toBeNull();
    }
  });

  it('reprise rejouable sans doublon', async () => {
    const texte = readFileSync(
      path.join(DOSSIER_MIGRATIONS, M4, 'migration.sql'),
      'utf8',
    );
    const debut = texte.indexOf('-- REPRISE: DEBUT');
    const finMarque = '-- REPRISE: FIN';
    const fin = texte.indexOf(finMarque) + finMarque.length;
    const bloc = texte.slice(debut, fin);
    const avant = await photographie(client());
    await appliquerSql(client(), bloc);
    expect(await photographie(client())).toEqual(avant);
  });

  it('agrégats égaux au recalcul après un scénario mixte, sorties partielles et totales acceptées', async () => {
    const c = client();
    const pv1 = await pv(c, 'str-pharma-1');
    const tech06 = await lotTechnique(c, 'stk-06');
    const tech02 = await lotTechnique(c, 'stk-02');
    const tech05 = await lotTechnique(c, 'stk-05');
    const tech04 = await lotTechnique(c, 'stk-04');
    const tech03 = await lotTechnique(c, 'stk-03');

    // (a) sortie partielle d'un lot technique
    await mouvement(c, {
      evenementId: 'essai-1',
      stockId: 'stk-06',
      lotId: tech06,
      type: 'VENTE',
      quantite: -1,
      piece: 'VENTE',
    });
    // (b) sortie sans lot : le produit devient négatif
    await mouvement(c, {
      evenementId: 'essai-2',
      stockId: 'stk-02',
      lotId: null,
      type: 'VENTE',
      quantite: -5,
      piece: 'VENTE',
    });
    // (c) nouveau lot reçu puis entamé
    await inserer(c, {
      id: 'lot-essai-06',
      stockId: 'stk-06',
      pointDeVenteId: pv1,
      numeroLot: 'L-ESSAI',
      dateExpiration: jourIso(plus(400)),
      quantiteRecue: 200,
      coutUnitaire: 50,
      coutAchatBoite: 1000,
      coefficientReception: 20,
    });
    await mouvement(c, {
      evenementId: 'essai-3',
      stockId: 'stk-06',
      lotId: 'lot-essai-06',
      type: 'RECEPTION',
      quantite: 200,
      piece: 'RECEPTION',
    });
    await mouvement(c, {
      evenementId: 'essai-4',
      stockId: 'stk-06',
      lotId: 'lot-essai-06',
      type: 'VENTE',
      quantite: -15,
      piece: 'VENTE',
    });
    // (d) sortie qui vide exactement un lot, puis nouveau lot
    await mouvement(c, {
      evenementId: 'essai-5',
      stockId: 'stk-05',
      lotId: tech05,
      type: 'VENTE',
      quantite: -11,
      piece: 'VENTE',
    });
    await inserer(c, {
      id: 'lot-essai-05',
      stockId: 'stk-05',
      pointDeVenteId: pv1,
      numeroLot: 'L-05',
      dateExpiration: jourIso(plus(400)),
      quantiteRecue: 5,
      coutUnitaire: 0,
      coefficientReception: 1,
    });
    await mouvement(c, {
      evenementId: 'essai-6',
      stockId: 'stk-05',
      lotId: 'lot-essai-05',
      type: 'RECEPTION',
      quantite: 5,
      piece: 'RECEPTION',
    });
    // (e) vidage total d'un lot technique
    await mouvement(c, {
      evenementId: 'essai-7',
      stockId: 'stk-04',
      lotId: tech04,
      type: 'VENTE',
      quantite: -10,
      piece: 'VENTE',
    });
    // (f) inventaire à écart nul
    await mouvement(c, {
      evenementId: 'essai-8',
      stockId: 'stk-03',
      lotId: tech03,
      type: 'INVENTAIRE',
      quantite: 0,
      piece: 'INVENTAIRE',
    });

    const produit = await c.query<{ quantite: number; recalcul: number }>(
      'SELECT a."stockMedicamentId", a."pointDeVenteId", a."quantite", COALESCE(r."q", 0)::int AS "recalcul" FROM "AgregatStockProduit" a LEFT JOIN (SELECT "stockMedicamentId", "pointDeVenteId", sum("quantite") AS "q" FROM "MouvementStock" GROUP BY 1, 2) r ON r."stockMedicamentId" = a."stockMedicamentId" AND r."pointDeVenteId" = a."pointDeVenteId"',
    );
    expect(produit.rows.length).toBeGreaterThan(0);
    for (const l of produit.rows) {
      expect(l.quantite).toBe(l.recalcul);
    }
    const lots = await c.query<{ quantite: number; recalcul: number }>(
      'SELECT a."lotId", a."quantite", COALESCE(r."q", 0)::int AS "recalcul" FROM "AgregatStockLot" a LEFT JOIN (SELECT "lotId", sum("quantite") AS "q" FROM "MouvementStock" WHERE "lotId" IS NOT NULL GROUP BY 1) r ON r."lotId" = a."lotId"',
    );
    expect(lots.rows.length).toBeGreaterThan(0);
    for (const l of lots.rows) {
      expect(l.quantite).toBe(l.recalcul);
    }

    const produitDe = async (id: string): Promise<number> =>
      (
        await c.query<{ q: number }>(
          'SELECT "quantite" AS "q" FROM "AgregatStockProduit" WHERE "stockMedicamentId" = $1',
          [id],
        )
      ).rows[0].q;
    const lotDe = async (id: string): Promise<number> =>
      (
        await c.query<{ q: number }>(
          'SELECT "quantite" AS "q" FROM "AgregatStockLot" WHERE "lotId" = $1',
          [id],
        )
      ).rows[0].q;
    expect(await produitDe('stk-06')).toBe(424);
    expect(await produitDe('stk-02')).toBe(-4);
    expect(await produitDe('stk-05')).toBe(5);
    expect(await produitDe('stk-04')).toBe(0);
    expect(await produitDe('stk-03')).toBe(9);
    expect(await lotDe(tech06)).toBe(239);
    expect(await lotDe('lot-essai-06')).toBe(185);
    expect(await lotDe(tech02)).toBe(1);
    expect(await lotDe(tech05)).toBe(0);
    expect(await lotDe(tech04)).toBe(0);
  });

  it("un lot n'est jamais négatif", async () => {
    const c = client();
    const tech03 = await lotTechnique(c, 'stk-03');
    const nombre = await compter(
      c,
      'SELECT count(*)::int AS n FROM "MouvementStock"',
    );
    await expect(
      mouvement(c, {
        evenementId: 'essai-negatif',
        stockId: 'stk-03',
        lotId: tech03,
        type: 'VENTE',
        quantite: -10,
        piece: 'VENTE',
      }),
    ).rejects.toMatchObject({ constraint: 'AgregatStockLot_quantite_check' });
    expect(
      await compter(c, 'SELECT count(*)::int AS n FROM "MouvementStock"'),
    ).toBe(nombre);
    const res = await c.query<{ quantite: number }>(
      'SELECT "quantite" FROM "AgregatStockLot" WHERE "lotId" = $1',
      [tech03],
    );
    expect(res.rows[0].quantite).toBe(9);
  });

  it('mouvement à quantité nulle refusé sauf inventaire', async () => {
    await expect(
      mouvement(client(), {
        evenementId: 'essai-zero',
        stockId: 'stk-03',
        lotId: null,
        type: 'VENTE',
        quantite: 0,
        piece: 'VENTE',
      }),
    ).rejects.toMatchObject({ constraint: 'MouvementStock_quantite_check' });
  });

  it('journal immuable : ni modification, ni suppression, ni troncature ; la purge ne fait que supprimer', async () => {
    const c = client();
    for (const requete of [
      'UPDATE "MouvementStock" SET "motif" = \'x\' WHERE "evenementId" = \'essai-1\'',
      'DELETE FROM "MouvementStock" WHERE "evenementId" = \'essai-1\'',
      'TRUNCATE "MouvementStock" CASCADE',
    ]) {
      await expect(c.query(requete)).rejects.toThrow(
        'ne se modifient ni ne se suppriment jamais',
      );
    }
    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    await expect(
      c.query(
        'UPDATE "MouvementStock" SET "motif" = \'x\' WHERE "evenementId" = \'essai-1\'',
      ),
    ).rejects.toThrow('ne se modifient ni ne se suppriment jamais');
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    const suppression = await c.query(
      'DELETE FROM "MouvementStock" WHERE "evenementId" = \'essai-1\'',
    );
    expect(suppression.rowCount).toBe(1);
    await c.query('ROLLBACK');
    expect(
      await compter(
        c,
        'SELECT count(*)::int AS n FROM "MouvementStock" WHERE "evenementId" = \'essai-1\'',
      ),
    ).toBe(1);
  });

  it('mouvement incohérent refusé', async () => {
    const c = client();
    const tech06 = await lotTechnique(c, 'stk-06');
    const pv2 = await pv(c, 'str-pharma-2');
    await expect(
      mouvement(c, {
        evenementId: 'incoherent-1',
        stockId: 'stk-03',
        lotId: tech06,
        type: 'VENTE',
        quantite: -1,
        piece: 'VENTE',
      }),
    ).rejects.toThrow("n'appartient pas à la fiche");
    await expect(
      mouvement(c, {
        evenementId: 'incoherent-2',
        stockId: 'stk-03',
        lotId: null,
        type: 'VENTE',
        quantite: -1,
        piece: 'VENTE',
        pointDeVenteId: pv2,
      }),
    ).rejects.toThrow("n'appartient pas à la pharmacie de la fiche");
    await expect(
      inserer(c, {
        id: 'lot-incoherent',
        stockId: 'stk-03',
        pointDeVenteId: pv2,
        quantiteRecue: 1,
        coutUnitaire: 0,
        coefficientReception: 1,
      }),
    ).rejects.toThrow("n'appartient pas à la pharmacie de la fiche");
  });

  it('lot figé après insertion', async () => {
    const c = client();
    const pv1 = await pv(c, 'str-pharma-1');
    const modifier = (colonnes: string) =>
      c.query(`UPDATE "LotStock" SET ${colonnes} WHERE "id" = 'lot-essai-06'`);

    const date = await modifier(`"dateExpiration" = '${jourIso(plus(401))}'`);
    expect(date.rowCount).toBe(1);
    await modifier(`"dateExpiration" = '${jourIso(plus(400))}'`);
    await expect(modifier('"quantiteRecue" = 300')).rejects.toThrow(
      'seule sa date de péremption',
    );
    await expect(modifier('"coefficientReception" = 10')).rejects.toThrow(
      'que sur un lot technique',
    );
    await expect(
      c.query('DELETE FROM "LotStock" WHERE "id" = \'lot-essai-06\''),
    ).rejects.toThrow('ne peut pas être supprimé');

    const tech03 = await lotTechnique(c, 'stk-03');
    await c.query('BEGIN');
    const technique = await c.query(
      'UPDATE "LotStock" SET "coefficientReception" = 20 WHERE "id" = $1',
      [tech03],
    );
    expect(technique.rowCount).toBe(1);
    await c.query('ROLLBACK');

    await expect(
      inserer(c, {
        id: 'lot-coef-nul',
        stockId: 'stk-03',
        pointDeVenteId: pv1,
        quantiteRecue: 1,
        coutUnitaire: 0,
        coefficientReception: 0,
      }),
    ).rejects.toMatchObject({
      constraint: 'LotStock_coefficientReception_check',
    });
    await expect(
      inserer(c, {
        id: 'lot-cout-negatif',
        stockId: 'stk-03',
        pointDeVenteId: pv1,
        quantiteRecue: 1,
        coutUnitaire: -1,
        coefficientReception: 1,
      }),
    ).rejects.toMatchObject({ constraint: 'LotStock_coutUnitaire_check' });
  });

  it('compteur gelé : quantite et disponible ne s écrivent plus', async () => {
    const c = client();
    await expect(
      c.query(
        'UPDATE "StockMedicament" SET "quantite" = 5 WHERE "id" = \'stk-03\'',
      ),
    ).rejects.toThrow('sont gelées');
    await expect(
      c.query(
        'UPDATE "StockMedicament" SET "disponible" = false WHERE "id" = \'stk-03\'',
      ),
    ).rejects.toThrow('sont gelées');

    await c.query('BEGIN');
    const autre = await c.query(
      'UPDATE "StockMedicament" SET "quantite" = 9, "prixUnitaire" = 2600 WHERE "id" = \'stk-03\'',
    );
    expect(autre.rowCount).toBe(1);
    await c.query('ROLLBACK');

    await expect(
      c.query(
        'INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "updatedAt") VALUES (\'stk-gel\', \'med-20\', \'str-pharma-2\', 3, true, now())',
      ),
    ).rejects.toThrow("la quantité ne s'écrit plus");

    await c.query('BEGIN');
    const creation = await c.query(
      'INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "updatedAt") VALUES (\'stk-gel\', \'med-20\', \'str-pharma-2\', 0, true, now())',
    );
    expect(creation.rowCount).toBe(1);
    await c.query('ROLLBACK');
  });

  it('un seul conditionnement ouvert par fiche, lot et point de vente (CA6 en base)', async () => {
    const c = client();
    const pv1 = await pv(c, 'str-pharma-1');
    const ouvrir = (id: string, unites: number) =>
      c.query(
        'INSERT INTO "ConditionnementOuvert" ("id", "stockMedicamentId", "lotId", "pointDeVenteId", "unitesParConditionnement") VALUES ($1, \'stk-06\', \'lot-essai-06\', $2, $3)',
        [id, pv1, unites],
      );
    await ouvrir('co-1', 20);
    await expect(ouvrir('co-2', 20)).rejects.toMatchObject({
      constraint:
        'ConditionnementOuvert_stockMedicamentId_lotId_pointDeVenteI_key',
    });
    await c.query(
      'UPDATE "ConditionnementOuvert" SET "fermeLe" = now() WHERE "id" = \'co-1\'',
    );
    await ouvrir('co-2', 20);
    await expect(ouvrir('co-3', 1)).rejects.toMatchObject({
      constraint: 'ConditionnementOuvert_unitesParConditionnement_check',
    });
    await c.query('DELETE FROM "ConditionnementOuvert"');
  });

  it('point de vente non nul sur lot et mouvement (CA26 partiel)', async () => {
    const c = client();
    for (const table of ['LotStock', 'MouvementStock']) {
      const res = await c.query<{ is_nullable: string }>(
        "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'pointDeVenteId'",
        [table],
      );
      expect(res.rows[0].is_nullable).toBe('NO');
    }
    await expect(
      c.query(
        'INSERT INTO "MouvementStock" ("id", "evenementId", "pointDeVenteId", "stockMedicamentId", "type", "quantite", "pieceOrigineType") VALUES (\'sans-pv\', \'sans-pv\', NULL, \'stk-03\', \'VENTE\', -1, \'VENTE\')',
      ),
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('retour arrière après activité : compteur restauré depuis le journal, négatif écrêté et signalé, dates depuis les lots en stock', async () => {
    const c = client();
    const notices: string[] = [];
    const ecouteur = (n: { message?: string }) => {
      notices.push(n.message ?? '');
    };
    c.on('notice', ecouteur);
    try {
      await appliquerRetourArriere(c, M4);
    } finally {
      c.off('notice', ecouteur);
    }
    expect(
      notices.some(
        (m) =>
          m.includes('1 fiche(s) au stock calculé négatif remises à 0') &&
          m.includes('stk-02'),
      ),
    ).toBe(true);

    const attendu = resume.fiches
      .map((f) => ({
        id: f.id,
        quantite: f.quantite,
        disponible: f.quantite > 0,
        date: f.dateExpiration
          ? f.dateExpiration.toISOString().slice(0, 19).replace('T', ' ')
          : null,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const modifier = (
      id: string,
      champs: Partial<{
        quantite: number;
        disponible: boolean;
        date: string | null;
      }>,
    ) => {
      const fiche = attendu.find((f) => f.id === id);
      if (!fiche) throw new Error(`Fiche absente : ${id}`);
      Object.assign(fiche, champs);
    };
    modifier('stk-06', { quantite: 424, disponible: true });
    modifier('stk-02', { quantite: 0, disponible: false });
    modifier('stk-05', {
      quantite: 5,
      disponible: true,
      date: jourIso(plus(400)) + ' 00:00:00',
    });
    modifier('stk-04', { quantite: 0, disponible: false });
    expect(await etatFiches(c)).toEqual(attendu);

    for (const table of [
      'LotStock',
      'MouvementStock',
      'AgregatStockLot',
      'AgregatStockProduit',
      'ConditionnementOuvert',
    ]) {
      const res = await c.query<{ r: string | null }>(
        'SELECT to_regclass($1)::text AS "r"',
        [`"${table}"`],
      );
      expect(res.rows[0].r).toBeNull();
    }
    expect(
      await compter(
        c,
        "SELECT count(*)::int AS n FROM pg_type WHERE typname IN ('TypePiece', 'TypeMouvementStock')",
      ),
    ).toBe(0);
    expect(
      await compter(
        c,
        "SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('journal_refuser_modification', 'lot_stock_proteger', 'mouvement_stock_agreger', 'stock_medicament_geler_compteur')",
      ),
    ).toBe(0);

    await c.query('BEGIN');
    const libre = await c.query(
      'UPDATE "StockMedicament" SET "quantite" = 1 WHERE "id" = \'stk-03\'',
    );
    expect(libre.rowCount).toBe(1);
    await c.query('ROLLBACK');
  });

  it('retour arrière puis haut de nouveau : reprise depuis les compteurs restaurés', async () => {
    const c = client();
    expect(await appliquerMigrations(c, { apres: M3, jusqua: M4 })).toEqual([
      M4,
    ]);
    const compteurs = (await etatFiches(c)).map((f) => ({
      id: f.id,
      q: f.quantite,
    }));
    expect(await calcule(c)).toEqual(compteurs);
    expect(
      await compter(c, 'SELECT count(*)::int AS n FROM "MouvementStock"'),
    ).toBe(compteurs.filter((f) => f.q > 0).length);
    expect(compteurs.filter((f) => f.q > 0)).toHaveLength(31);
  });

  describe('arrêts de M4', () => {
    let autre: BaseDeTest | undefined;
    let jeu: ResumeFormatActuel;

    beforeAll(async () => {
      autre = await creerBaseVide();
      await appliquerMigrations(autre.client, {
        jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      });
      jeu = await chargerFormatActuel(autre.client);
      await appliquerMigrations(autre.client, {
        apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
        jusqua: M3,
      });
    });

    afterAll(async () => {
      if (autre) {
        await supprimerBaseDeTest(autre);
      }
    });

    function cible(): Client {
      if (!autre) throw new Error('Base de test non créée.');
      return autre.client;
    }

    it('arrêt : fiches à quantité négative listées, rien est créé', async () => {
      const c = cible();
      await c.query(
        'UPDATE "StockMedicament" SET "quantite" = -2 WHERE "id" IN (\'stk-03\', \'stk-09\')',
      );
      const echec = appliquerMigrations(c, { apres: M3, jusqua: M4 });
      await expect(echec).rejects.toThrow(`La migration ${M4} a échoué`);
      await expect(
        appliquerMigrations(c, { apres: M3, jusqua: M4 }),
      ).rejects.toThrow('2 fiche(s) de stock ont une quantité négative');
      await expect(
        appliquerMigrations(c, { apres: M3, jusqua: M4 }),
      ).rejects.toThrow('Fiches en cause (50 au plus) : stk-03, stk-09');
      const lots = await c.query<{ r: string | null }>(
        'SELECT to_regclass(\'"LotStock"\')::text AS "r"',
      );
      expect(lots.rows[0].r).toBeNull();
      expect(
        await compter(
          c,
          "SELECT count(*)::int AS n FROM pg_type WHERE typname = 'TypePiece'",
        ),
      ).toBe(0);
      expect(
        await compter(
          c,
          "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'mouvement_stock_agreger'",
        ),
      ).toBe(0);
    });

    it("arrêt : fiche avec du stock d'une structure sans point de vente, puis M4 passe une fois corrigée", async () => {
      const c = cible();
      for (const id of ['stk-03', 'stk-09']) {
        const fiche = jeu.fiches.find((f) => f.id === id);
        await c.query(
          'UPDATE "StockMedicament" SET "quantite" = $2 WHERE "id" = $1',
          [id, fiche?.quantite],
        );
      }
      await c.query(
        `INSERT INTO "Structure" ("id", "nom", "type", "email", "ville", "isActive", "isConfigured", "createdAt", "updatedAt") VALUES ('str-pharma-sans-pv', 'Pharmacie sans point de vente (harnais)', 'PHARMACIE', 'sanspv@harnais.test', 'Conakry', true, true, now(), now())`,
      );
      await c.query(
        'INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "updatedAt") VALUES (\'stk-sans-pv\', \'med-01\', \'str-pharma-sans-pv\', 3, true, now())',
      );
      await expect(
        appliquerMigrations(c, { apres: M3, jusqua: M4 }),
      ).rejects.toThrow(
        '1 fiche(s) avec du stock appartiennent à une structure sans point de vente',
      );
      await expect(
        appliquerMigrations(c, { apres: M3, jusqua: M4 }),
      ).rejects.toThrow('Fiches en cause (50 au plus) : stk-sans-pv');
      await c.query(
        'DELETE FROM "StockMedicament" WHERE "id" = \'stk-sans-pv\'',
      );
      expect(await appliquerMigrations(c, { apres: M3, jusqua: M4 })).toEqual([
        M4,
      ]);
    });
  });
});
