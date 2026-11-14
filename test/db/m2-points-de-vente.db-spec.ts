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

const M1 = '20261026090000_pharmacie_t1_permissions';
const M2 = '20261026100000_pharmacie_t1_points_de_vente';
const TABLES_M2 = [
  'PointDeVente',
  'Poste',
  'CompteurTicket',
  'PlageTicket',
  'ParametresPharmacie',
  'ModePaiement',
  'CoupureMonnaie',
  'Fournisseur',
  'Anomalie',
];
const TYPES_M2 = ['TypePoste', 'TypeCoupure', 'TypeAnomalie', 'StatutAnomalie'];

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

async function tablesPresentes(client: Client): Promise<number> {
  const res = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)",
    [TABLES_M2],
  );
  return res.rows[0].n;
}

async function typesPresents(client: Client): Promise<number> {
  const res = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM pg_type WHERE typname = ANY($1)',
    [TYPES_M2],
  );
  return res.rows[0].n;
}

describe('Migration M2, points de vente, postes et référentiels (PB05)', () => {
  let base: BaseDeTest | undefined;
  let appliquees: string[];

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    // Jamais au-delà de M2 : le retour arrière doit rester applicable quand M4 référencera ces tables.
    appliquees = await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      jusqua: M2,
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
      path.join(DOSSIER_MIGRATIONS, M2, 'migration.sql'),
      path.join(DOSSIER_RETOURS_ARRIERE, `${M2}.down.sql`),
    ]) {
      const lignes = lignesSql(fichier);
      expect(lignes[0]).toBe('BEGIN;');
      expect(lignes.at(-1)).toBe('COMMIT;');
    }
  });

  it('M2 haut : appliquée après M1, un point de vente d ordre 1 par pharmacie, aucun pour l hôpital', async () => {
    expect(appliquees).toEqual([M1, M2]);
    const res = await client().query(
      'SELECT "structureId", "ordre", "nom", "actif" FROM "PointDeVente" ORDER BY "structureId"',
    );
    expect(res.rows).toEqual([
      {
        structureId: 'str-pharma-1',
        ordre: 1,
        nom: 'Pharmacie de Kaloum (harnais)',
        actif: true,
      },
      {
        structureId: 'str-pharma-2',
        ordre: 1,
        nom: 'Pharmacie de Matoto (harnais)',
        actif: true,
      },
      {
        structureId: 'str-pharma-3',
        ordre: 1,
        nom: 'Pharmacie de Ratoma (harnais)',
        actif: true,
      },
    ]);
  });

  it('M2 haut : un poste REPRISE technique et inactif, un compteur à 1 par point de vente, aucune plage, aucun fournisseur, aucune anomalie', async () => {
    const postes = await client().query<{
      structureId: string;
      code: string;
      libelle: string;
      type: string;
      actif: boolean;
      appareilId: string | null;
      derniereSequenceAppliquee: number;
    }>(
      'SELECT pv."structureId", p."code", p."libelle", p."type"::text AS "type", p."actif", p."appareilId", p."derniereSequenceAppliquee" FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" ORDER BY pv."structureId"',
    );
    expect(postes.rows).toHaveLength(3);
    for (const ligne of postes.rows) {
      expect(ligne.code).toBe('REPRISE');
      expect(ligne.libelle).toBe('Reprise des ventes historiques');
      expect(ligne.type).toBe('TECHNIQUE');
      expect(ligne.actif).toBe(false);
      expect(ligne.appareilId).toBeNull();
      expect(ligne.derniereSequenceAppliquee).toBe(0);
    }
    expect(
      await compter(
        client(),
        'SELECT count(*)::int AS n FROM "CompteurTicket" c JOIN "PointDeVente" pv ON pv."id" = c."pointDeVenteId" WHERE c."prochainNumero" = 1',
      ),
    ).toBe(3);
    for (const table of ['PlageTicket', 'Fournisseur', 'Anomalie']) {
      expect(
        await compter(client(), `SELECT count(*)::int AS n FROM "${table}"`),
      ).toBe(0);
    }
  });

  it('M2 haut : paramètres par défaut pour chaque pharmacie (O9, seuil de stock bas en boîtes)', async () => {
    const res = await client().query<{
      structureId: string;
      horizonsPeremptionJours: number[];
      seuilEcartCaisse: number;
      seuilAvertissementPrixPct: number;
      seuilStockBas: number;
      taillePlageTickets: number;
      seuilRechargementPlagePct: number;
      debutFiabiliteMarge: Date;
      debutCaisse: Date;
      misAJourParId: string | null;
    }>('SELECT * FROM "ParametresPharmacie" ORDER BY "structureId"');
    expect(res.rows.map((l) => l.structureId)).toEqual([
      'str-pharma-1',
      'str-pharma-2',
      'str-pharma-3',
    ]);
    for (const ligne of res.rows) {
      expect(ligne.horizonsPeremptionJours).toEqual([90, 30, 7]);
      expect(ligne.seuilEcartCaisse).toBe(5000);
      expect(ligne.seuilAvertissementPrixPct).toBe(25);
      expect(ligne.seuilStockBas).toBe(10);
      expect(ligne.taillePlageTickets).toBe(1000);
      expect(ligne.seuilRechargementPlagePct).toBe(20);
      expect(ligne.misAJourParId).toBeNull();
      expect(ligne.debutFiabiliteMarge.getTime()).toBe(
        ligne.debutCaisse.getTime(),
      );
      expect(Math.abs(Date.now() - ligne.debutCaisse.getTime())).toBeLessThan(
        10 * 60 * 1000,
      );
    }
  });

  it('M2 haut : 3 modes de paiement et 6 billets de 20 000 à 500 GNF, rien en dessous', async () => {
    const modes = await client().query(
      'SELECT "code", "libelle", "comptagePhysique", "referenceAutorisee", "ordre", "actif" FROM "ModePaiement" ORDER BY "ordre"',
    );
    expect(modes.rows).toEqual([
      {
        code: 'ESPECES',
        libelle: 'Espèces',
        comptagePhysique: true,
        referenceAutorisee: false,
        ordre: 1,
        actif: true,
      },
      {
        code: 'ORANGE_MONEY',
        libelle: 'Orange Money',
        comptagePhysique: false,
        referenceAutorisee: true,
        ordre: 2,
        actif: true,
      },
      {
        code: 'MTN_MOMO',
        libelle: 'MTN MoMo',
        comptagePhysique: false,
        referenceAutorisee: true,
        ordre: 3,
        actif: true,
      },
    ]);
    const coupures = await client().query(
      'SELECT "devise", "valeurFaciale", "type"::text AS "type", "ordre", "actif" FROM "CoupureMonnaie" ORDER BY "ordre"',
    );
    expect(coupures.rows).toEqual(
      [20000, 10000, 5000, 2000, 1000, 500].map((valeurFaciale, i) => ({
        devise: 'GNF',
        valeurFaciale,
        type: 'BILLET',
        ordre: i + 1,
        actif: true,
      })),
    );
    expect(
      await compter(
        client(),
        'SELECT count(*)::int AS n FROM "CoupureMonnaie" WHERE "valeurFaciale" < 500',
      ),
    ).toBe(0);
  });

  it('arrêt : les structures non pharmacies qui portent du stock ou des ventes sont listées, rien n est créé', async () => {
    const autre = await creerBaseVide();
    try {
      await appliquerMigrations(autre.client, {
        jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      });
      await chargerFormatActuel(autre.client);
      await autre.client.query(
        `INSERT INTO "Structure" ("id", "nom", "type", "email", "ville", "isActive", "isConfigured", "createdAt", "updatedAt") VALUES ('str-clinique-1', 'Clinique de Dixinn (harnais)', 'CLINIQUE', 'clinique1@harnais.test', 'Conakry', true, true, now(), now())`,
      );
      await autre.client.query(
        `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "updatedAt") VALUES ('st-hopital-1', 'med-01', 'str-hopital-1', 3, true, now())`,
      );
      await autre.client.query(
        `INSERT INTO "Vente" ("id", "structureId", "numero", "vendeurId", "vendeurNom", "total") VALUES ('vte-clinique-1', 'str-clinique-1', 'V-2026-000001', 'usr-medecin-h1', 'Mariama Sylla', 1000)`,
      );
      await appliquerMigrations(autre.client, {
        apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
        jusqua: M1,
      });

      const erreur: unknown = await appliquerMigrations(autre.client, {
        apres: M1,
        jusqua: M2,
      }).catch((e: unknown) => e);
      expect(erreur).toBeInstanceOf(Error);
      const message = (erreur as Error).message;
      expect(message).toContain(`La migration ${M2} a échoué`);
      expect(message).toContain('2 structure(s)');
      expect(message).toContain(
        'Structures en cause (50 au plus) : str-clinique-1, str-hopital-1',
      );

      expect(await tablesPresentes(autre.client)).toBe(0);
      expect(await typesPresents(autre.client)).toBe(0);
      expect(
        await compter(
          autre.client,
          `SELECT count(*)::int AS n FROM "Permission" WHERE "code" = 'caisse:utiliser'`,
        ),
      ).toBe(1);
    } finally {
      await supprimerBaseDeTest(autre);
    }
  });

  it('retour arrière : haut, bas, haut sur la base chargée', async () => {
    const nombreStocks = await compter(
      client(),
      'SELECT count(*)::int AS n FROM "StockMedicament"',
    );
    const nombreVentes = await compter(
      client(),
      'SELECT count(*)::int AS n FROM "Vente"',
    );

    await appliquerRetourArriere(client(), M2);
    expect(await tablesPresentes(client())).toBe(0);
    expect(await typesPresents(client())).toBe(0);
    expect(
      await compter(
        client(),
        `SELECT count(*)::int AS n FROM "Permission" WHERE "code" = 'caisse:utiliser'`,
      ),
    ).toBe(1);
    expect(
      await compter(
        client(),
        'SELECT count(*)::int AS n FROM "StockMedicament"',
      ),
    ).toBe(nombreStocks);
    expect(
      await compter(client(), 'SELECT count(*)::int AS n FROM "Vente"'),
    ).toBe(nombreVentes);

    await expect(
      appliquerMigrations(client(), { apres: M1, jusqua: M2 }),
    ).resolves.toEqual([M2]);
    const attendus: [string, number][] = [
      ['PointDeVente', 3],
      ['Poste', 3],
      ['ModePaiement', 3],
      ['CoupureMonnaie', 6],
      ['ParametresPharmacie', 3],
    ];
    for (const [table, n] of attendus) {
      expect(
        await compter(client(), `SELECT count(*)::int AS n FROM "${table}"`),
      ).toBe(n);
    }
  });
});
