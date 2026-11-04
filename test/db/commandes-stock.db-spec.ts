import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { Client } from 'pg';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  analyserPreMigration,
  comparerCompteur,
  reconstruireStock,
  verifierStock,
} from 'src/pharmacie/stock/commandes-stock';
import { purgerStockPharmacies } from 'src/pharmacie/stock/purge-stock';
import {
  appliquerMigrations,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  fermerPrismaDeTest,
  masquerUrls,
  RACINE_DEPOT,
  supprimerBaseDeTest,
} from './harnais';
import {
  chargerFormatActuel,
  type ResumeFormatActuel,
} from './fixtures/format-actuel';

const JOUR_MS = 24 * 60 * 60 * 1000;

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('Commandes d’exploitation du journal de stock (PB07)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService | undefined;
  let resume: ResumeFormatActuel;
  let avant1: Record<string, number>;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    resume = await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    prisma = creerPrismaDeTest(base);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await fermerPrismaDeTest(prisma);
      }
    } finally {
      if (base) {
        await supprimerBaseDeTest(base);
      }
    }
  });

  function client(): Client {
    if (!base) throw new Error('Base de test non créée.');
    return base.client;
  }

  function lancer(
    script: string,
    env?: NodeJS.ProcessEnv,
  ): { statut: number | null; sortie: string } {
    if (!base) throw new Error('Base de test non créée.');
    const resultat = spawnSync(
      process.execPath,
      [
        path.join(RACINE_DEPOT, 'node_modules', 'ts-node', 'dist', 'bin.js'),
        '--transpile-only',
        path.join('scripts', script),
      ],
      {
        cwd: RACINE_DEPOT,
        env: env ?? { ...process.env, DATABASE_URL: base.url },
        encoding: 'utf8',
        timeout: 120000,
      },
    );
    return {
      statut: resultat.status,
      sortie: masquerUrls((resultat.stdout ?? '') + (resultat.stderr ?? '')),
    };
  }

  async function pointDeVente(structureId: string): Promise<string> {
    const res = await client().query<{ id: string }>(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [structureId],
    );
    return res.rows[0].id;
  }

  async function lotTechnique(stockId: string): Promise<string> {
    const res = await client().query<{ id: string }>(
      'SELECT "id" FROM "LotStock" WHERE "stockMedicamentId" = $1 AND "lotTechnique"',
      [stockId],
    );
    return res.rows[0].id;
  }

  async function mouvement(
    evenementId: string,
    stockId: string,
    lotId: string | null,
    type: string,
    quantite: number,
    piece: string,
  ): Promise<void> {
    await client().query(
      'INSERT INTO "MouvementStock" ("id", "evenementId", "pointDeVenteId", "stockMedicamentId", "lotId", "type", "quantite", "pieceOrigineType") SELECT $1, $1, pv."id", f."id", $3, $4::"TypeMouvementStock", $5, $6::"TypePiece" FROM "StockMedicament" f JOIN "PointDeVente" pv ON pv."structureId" = f."structureId" AND pv."ordre" = 1 WHERE f."id" = $2',
      [evenementId, stockId, lotId, type, quantite, piece],
    );
  }

  async function compterStock(structureId: string) {
    const requete = async (table: string): Promise<number> =>
      (
        await client().query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "${table}" WHERE "pointDeVenteId" IN (SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1)`,
          [structureId],
        )
      ).rows[0].n;
    return {
      lots: await requete('LotStock'),
      mouvements: await requete('MouvementStock'),
      agregatsLot: await requete('AgregatStockLot'),
      agregatsProduit: await requete('AgregatStockProduit'),
      conditionnements: await requete('ConditionnementOuvert'),
    };
  }

  async function photographieAgregats() {
    const produit = await client().query(
      'SELECT "stockMedicamentId", "pointDeVenteId", "quantite" FROM "AgregatStockProduit" ORDER BY 1, 2',
    );
    const lot = await client().query(
      'SELECT "lotId", "stockMedicamentId", "pointDeVenteId", "quantite" FROM "AgregatStockLot" ORDER BY 1',
    );
    return { produit: produit.rows, lot: lot.rows };
  }

  it('les quatre scripts se lancent sur la base migrée et rendent 0', () => {
    const verifier = lancer('stock-verifier.ts');
    expect(verifier.statut).toBe(0);
    expect(verifier.sortie).toContain('Résultat : aucune anomalie.');

    const comparer = lancer('stock-comparer-compteur.ts');
    expect(comparer.statut).toBe(0);
    expect(comparer.sortie).toContain(
      'Résultat : reprise et agrégats cohérents.',
    );

    const pre = lancer('pharmacie-pre-migration.ts');
    expect(pre.statut).toBe(0);
    expect(pre.sortie).toContain('Résultat : migration possible.');
    expect(pre.sortie).toContain(
      'Journal de stock : déjà en place (M4 appliquée)',
    );

    const reconstruire = lancer('stock-reconstruire.ts');
    expect(reconstruire.statut).toBe(0);
    expect(reconstruire.sortie).toContain('Résultat : agrégats reconstruits.');

    const sansUrl: NodeJS.ProcessEnv = { ...process.env };
    delete sansUrl.DATABASE_URL;
    const absente = lancer('stock-verifier.ts', sansUrl);
    expect(absente.statut).toBe(1);
    expect(absente.sortie).toContain("DATABASE_URL n'est pas définie.");
  });

  it('stock:verifier est propre juste après la reprise', async () => {
    const rapport = await verifierStock(client());
    expect(rapport.totalAnomalies).toBe(0);
    expect(rapport.agregatsProduit.nombre).toBe(0);
    expect(rapport.agregatsLot.nombre).toBe(0);
    expect(rapport.lotsNegatifs.nombre).toBe(0);
    expect(rapport.conditionnements.nombre).toBe(0);
    expect(rapport.plagesSuperposees.nombre).toBe(0);
  });

  it('stock:comparer-compteur : reprise prouvée, aucune activité', async () => {
    const rapport = await comparerCompteur(client());
    expect(rapport.fiches).toBe(40);
    expect(rapport.ecartsReprise.nombre).toBe(0);
    expect(rapport.ecartsAgregat.nombre).toBe(0);
    expect(rapport.fichesEnEcartActivite).toBe(0);
    expect(rapport.activite).toEqual([]);
  });

  it("après une vente, l'écart d'activité est ventilé sans être une erreur", async () => {
    await mouvement(
      'cmd-1',
      'stk-06',
      await lotTechnique('stk-06'),
      'VENTE',
      -2,
      'VENTE',
    );
    const rapport = await comparerCompteur(client());
    expect(rapport.ecartsReprise.nombre).toBe(0);
    expect(rapport.ecartsAgregat.nombre).toBe(0);
    expect(rapport.fichesEnEcartActivite).toBe(1);
    expect(rapport.activite).toEqual([
      { typePiece: 'VENTE', mouvements: 1, quantite: -2 },
    ]);
  });

  it('stock:verifier détecte agrégats faussés, conditionnement manquant et plages superposées', async () => {
    const c = client();
    const pv1 = await pointDeVente('str-pharma-1');
    await c.query(
      'UPDATE "AgregatStockProduit" SET "quantite" = "quantite" + 1 WHERE "stockMedicamentId" = \'stk-06\'',
    );
    await c.query(
      'INSERT INTO "LotStock" ("id", "stockMedicamentId", "pointDeVenteId", "numeroLot", "dateExpiration", "quantiteRecue", "coutUnitaire", "coefficientReception", "dateReception", "lotTechnique") VALUES (\'cmd-lot\', \'stk-06\', $1, \'L-CMD\', $2::date, 200, 50, 20, now(), false)',
      [pv1, jourIso(new Date(resume.aujourdhui.getTime() + 400 * JOUR_MS))],
    );
    await mouvement(
      'cmd-2',
      'stk-06',
      'cmd-lot',
      'RECEPTION',
      200,
      'RECEPTION',
    );
    await mouvement('cmd-3', 'stk-06', 'cmd-lot', 'VENTE', -15, 'VENTE');
    await c.query('DELETE FROM "AgregatStockLot" WHERE "lotId" = $1', [
      await lotTechnique('stk-05'),
    ]);
    const poste = await c.query<{ id: string }>(
      'SELECT "id" FROM "Poste" WHERE "pointDeVenteId" = $1 AND "code" = \'REPRISE\'',
      [pv1],
    );
    for (const [id, debut, fin] of [
      ['cmd-pl1', 1, 1000],
      ['cmd-pl2', 1000, 1999],
    ] as const) {
      await c.query(
        'INSERT INTO "PlageTicket" ("id", "posteId", "pointDeVenteId", "debut", "fin") VALUES ($1, $2, $3, $4, $5)',
        [id, poste.rows[0].id, pv1, debut, fin],
      );
    }

    const rapport = await verifierStock(c);
    expect(rapport.agregatsProduit.nombre).toBe(1);
    expect(rapport.agregatsProduit.exemples[0].stockMedicamentId).toBe(
      'stk-06',
    );
    expect(rapport.agregatsProduit.exemples[0].agregat).toBe(
      (rapport.agregatsProduit.exemples[0].recalcul ?? 0) + 1,
    );
    expect(rapport.agregatsLot.nombre).toBe(1);
    expect(rapport.agregatsLot.exemples[0]).toEqual({
      lotId: await lotTechnique('stk-05'),
      agregat: null,
      recalcul: 11,
    });
    expect(rapport.conditionnements).toEqual({
      nombre: 1,
      exemples: [{ lotId: 'cmd-lot', reliquat: 5, ouverts: 0 }],
    });
    expect(rapport.plagesSuperposees.nombre).toBe(1);
    expect(rapport.plagesSuperposees.exemples[0].plageA).toBe('cmd-pl1');
    expect(rapport.plagesSuperposees.exemples[0].plageB).toBe('cmd-pl2');
    expect(rapport.lotsNegatifs.nombre).toBe(0);
    expect(rapport.totalAnomalies).toBe(4);

    const comparaison = await comparerCompteur(c);
    expect(comparaison.ecartsAgregat.nombre).toBe(1);
    expect(comparaison.ecartsAgregat.exemples[0].stockMedicamentId).toBe(
      'stk-06',
    );

    const script = lancer('stock-verifier.ts');
    expect(script.statut).toBe(1);
    expect(script.sortie).toContain('Résultat : 4 anomalie(s).');
  });

  it('stock:reconstruire rétablit les agrégats et ouvre le conditionnement manquant', async () => {
    const c = client();
    await c.query('DELETE FROM "PlageTicket" WHERE "id" = \'cmd-pl2\'');
    const bilan = await reconstruireStock(c);
    const couples = (
      await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM (SELECT DISTINCT "stockMedicamentId", "pointDeVenteId" FROM "MouvementStock") x',
      )
    ).rows[0].n;
    const lots = (
      await c.query<{ n: number }>(
        'SELECT count(DISTINCT "lotId")::int AS n FROM "MouvementStock" WHERE "lotId" IS NOT NULL',
      )
    ).rows[0].n;
    expect(bilan.conditionnementsOuverts).toBe(1);
    expect(bilan.conditionnementsFermes).toBe(0);
    expect(bilan.agregatsProduit).toBe(couples);
    expect(bilan.agregatsLot).toBe(lots);
    expect((await verifierStock(c)).totalAnomalies).toBe(0);
    const ouvert = await c.query(
      'SELECT "unitesParConditionnement", "ouvertParId", "ouvertParPieceId" FROM "ConditionnementOuvert" WHERE "lotId" = \'cmd-lot\' AND "fermeLe" IS NULL',
    );
    expect(ouvert.rows).toEqual([
      {
        unitesParConditionnement: 20,
        ouvertParId: null,
        ouvertParPieceId: null,
      },
    ]);
  });

  it('stock:reconstruire ferme un conditionnement devenu sans reliquat et reste idempotent', async () => {
    const c = client();
    await mouvement('cmd-4', 'stk-06', 'cmd-lot', 'VENTE', -5, 'VENTE');
    expect((await verifierStock(c)).conditionnements.nombre).toBe(1);
    const bilan = await reconstruireStock(c);
    expect(bilan.conditionnementsFermes).toBe(1);
    expect(bilan.conditionnementsOuverts).toBe(0);
    const photo = await photographieAgregats();
    const second = await reconstruireStock(c);
    expect(second.conditionnementsFermes).toBe(0);
    expect(second.conditionnementsOuverts).toBe(0);
    expect(await photographieAgregats()).toEqual(photo);
    expect((await verifierStock(c)).totalAnomalies).toBe(0);
  });

  it("pharmacie:pre-migration sur une base d'avant la tranche", async () => {
    const autre = await creerBaseVide();
    try {
      await appliquerMigrations(autre.client, {
        jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      });
      const r = await chargerFormatActuel(autre.client);
      const rapport = await analyserPreMigration(autre.client);
      expect(rapport.pharmacies).toBe(3);
      expect(rapport.fiches).toBe(40);
      expect(rapport.fichesAvecStock).toBe(33);
      expect(rapport.fichesVides).toBe(7);
      expect(rapport.fichesPrixManquant).toBe(
        r.fiches.filter((f) => f.prixUnitaire === null || f.prixUnitaire === 0)
          .length,
      );
      expect(rapport.fichesPerimees).toBe(
        r.fiches.filter(
          (f) => f.dateExpiration && f.dateExpiration < r.aujourdhui,
        ).length,
      );
      expect(rapport.fichesSansDate).toBe(
        r.fiches.filter((f) => f.dateExpiration === null).length,
      );
      expect(rapport.ventes).toBe(r.ventes.validees + r.ventes.annulees);
      expect(rapport.fichesNegatives.nombre).toBe(0);
      expect(rapport.structuresNonPharmacie.nombre).toBe(0);
      expect(rapport.fichesSansPointDeVente).toBeNull();
      expect(rapport.journalEnPlace).toBe(false);
      expect(rapport.bloquant).toBe(false);

      await autre.client.query(
        'UPDATE "StockMedicament" SET "quantite" = -1 WHERE "id" = \'stk-03\'',
      );
      await autre.client.query(
        'INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "updatedAt") VALUES (\'stk-hopital\', \'med-01\', \'str-hopital-1\', 2, true, now())',
      );
      const bloque = await analyserPreMigration(autre.client);
      expect(bloque.fichesNegatives).toEqual({
        nombre: 1,
        exemples: ['stk-03'],
      });
      expect(bloque.structuresNonPharmacie).toEqual({
        nombre: 1,
        exemples: ['str-hopital-1'],
      });
      expect(bloque.bloquant).toBe(true);
    } finally {
      await supprimerBaseDeTest(autre);
    }
  });

  it('pharmacie:pre-migration sur la base migrée', async () => {
    const rapport = await analyserPreMigration(client());
    expect(rapport.fichesSansPointDeVente).toEqual({
      nombre: 0,
      exemples: [],
    });
    expect(rapport.journalEnPlace).toBe(true);
    expect(rapport.bloquant).toBe(false);
  });

  it('sans contournement, ni mouvement ni lot ne se supprime', async () => {
    if (!prisma) throw new Error('Prisma non créé.');
    const avant = await compterStock('str-pharma-3');
    await expect(
      prisma.mouvementStock.deleteMany({
        where: { pointDeVente: { structureId: 'str-pharma-3' } },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.lotStock.deleteMany({
        where: { pointDeVente: { structureId: 'str-pharma-3' } },
      }),
    ).rejects.toThrow();
    expect(await compterStock('str-pharma-3')).toEqual(avant);
  });

  it('purge démo : purgerStockPharmacies vide le journal des seules structures données', async () => {
    if (!prisma) throw new Error('Prisma non créé.');
    avant1 = await compterStock('str-pharma-1');
    await prisma.$transaction((tx) =>
      purgerStockPharmacies(tx, ['str-pharma-2']),
    );
    expect(await compterStock('str-pharma-2')).toEqual({
      lots: 0,
      mouvements: 0,
      agregatsLot: 0,
      agregatsProduit: 0,
      conditionnements: 0,
    });
    expect(await compterStock('str-pharma-1')).toEqual(avant1);
  });

  it('purge démo : le contournement est retiré à la fin de la purge', async () => {
    if (!prisma) throw new Error('Prisma non créé.');
    await expect(
      prisma.$transaction(async (tx) => {
        await purgerStockPharmacies(tx, ['str-pharma-3']);
        await tx.mouvementStock.deleteMany({
          where: { pointDeVente: { structureId: 'str-pharma-1' } },
        });
      }),
    ).rejects.toThrow();
    expect((await compterStock('str-pharma-3')).lots).toBeGreaterThan(0);
    expect(await compterStock('str-pharma-1')).toEqual(avant1);
  });
});
