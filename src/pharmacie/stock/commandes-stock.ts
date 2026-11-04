/**
 * Logique des commandes d'exploitation du journal de stock (PB07, D501) : vérification,
 * reconstruction des agrégats, comparaison avec le compteur gelé et contrôle avant migration.
 * Fichier autonome, importé par les scripts de `scripts/` : aucun Nest, aucun Prisma, seulement
 * le type du client `pg`. Aucune écriture hors `reconstruireStock`.
 */
import type { Client } from 'pg';

export const MAX_EXEMPLES = 50;

export interface Echantillon<T> {
  nombre: number;
  exemples: T[]; // MAX_EXEMPLES au plus, dans l'ordre de la requête
}

export interface RapportVerification {
  agregatsProduit: Echantillon<{
    stockMedicamentId: string;
    pointDeVenteId: string;
    agregat: number | null;
    recalcul: number | null;
  }>;
  agregatsLot: Echantillon<{
    lotId: string;
    agregat: number | null;
    recalcul: number | null;
  }>;
  lotsNegatifs: Echantillon<{ lotId: string; solde: number }>;
  conditionnements: Echantillon<{
    lotId: string;
    reliquat: number;
    ouverts: number;
  }>;
  plagesSuperposees: Echantillon<{
    pointDeVenteId: string;
    plageA: string;
    plageB: string;
  }>;
  allocations: Echantillon<{
    ligneVenteId: string;
    quantite: number;
    alloue: number;
  }>;
  totalAnomalies: number; // somme des six `nombre`
}

export interface BilanReconstruction {
  agregatsProduit: number;
  agregatsLot: number;
  conditionnementsFermes: number;
  conditionnementsOuverts: number;
}

export interface RapportComparaison {
  fiches: number;
  ecartsReprise: Echantillon<{
    stockMedicamentId: string;
    compteur: number;
    reprise: number;
  }>;
  ecartsAgregat: Echantillon<{
    stockMedicamentId: string;
    agregat: number;
    recalcul: number;
  }>;
  fichesEnEcartActivite: number;
  activite: { typePiece: string; mouvements: number; quantite: number }[];
}

export interface RapportPreMigration {
  pharmacies: number;
  fiches: number;
  fichesAvecStock: number;
  fichesVides: number;
  fichesPrixManquant: number;
  fichesPerimees: number;
  fichesSansDate: number;
  ventes: number | null; // null si la table Vente n'existe pas
  fichesNegatives: Echantillon<string>;
  structuresNonPharmacie: Echantillon<string>;
  fichesSansPointDeVente: Echantillon<string> | null; // null si la table PointDeVente n'existe pas
  journalEnPlace: boolean; // vrai si la table LotStock existe (M4 appliquée)
  bloquant: boolean; // fichesNegatives, structuresNonPharmacie ou fichesSansPointDeVente non vide
}

export function echantillon<T>(lignes: T[]): Echantillon<T> {
  return { nombre: lignes.length, exemples: lignes.slice(0, MAX_EXEMPLES) };
}

const SQL_VERIFIER_AGREGATS_PRODUIT = `
SELECT COALESCE(c."stockMedicamentId", a."stockMedicamentId") AS "stockMedicamentId",
       COALESCE(c."pointDeVenteId", a."pointDeVenteId") AS "pointDeVenteId",
       a."quantite" AS "agregat", c."quantite"::int AS "recalcul"
FROM (
  SELECT m."stockMedicamentId", m."pointDeVenteId", sum(m."quantite") AS "quantite"
  FROM "MouvementStock" m
  GROUP BY m."stockMedicamentId", m."pointDeVenteId"
) c
FULL JOIN "AgregatStockProduit" a
  ON a."stockMedicamentId" = c."stockMedicamentId" AND a."pointDeVenteId" = c."pointDeVenteId"
WHERE a."stockMedicamentId" IS NULL OR c."stockMedicamentId" IS NULL OR a."quantite" <> c."quantite"
ORDER BY 1, 2`;

const SQL_VERIFIER_AGREGATS_LOT = `
SELECT COALESCE(c."lotId", a."lotId") AS "lotId", a."quantite" AS "agregat", c."quantite"::int AS "recalcul"
FROM (
  SELECT m."lotId", sum(m."quantite") AS "quantite"
  FROM "MouvementStock" m
  WHERE m."lotId" IS NOT NULL
  GROUP BY m."lotId"
) c
FULL JOIN "AgregatStockLot" a ON a."lotId" = c."lotId"
WHERE a."lotId" IS NULL OR c."lotId" IS NULL OR a."quantite" <> c."quantite"
ORDER BY 1`;

const SQL_VERIFIER_LOTS_NEGATIFS = `
SELECT m."lotId", sum(m."quantite")::int AS "solde"
FROM "MouvementStock" m
WHERE m."lotId" IS NOT NULL
GROUP BY m."lotId"
HAVING sum(m."quantite") < 0
ORDER BY 1`;

// Le reliquat est dérivé du journal (D405)
const SQL_VERIFIER_CONDITIONNEMENTS = `
SELECT r."lotId", r."reliquat", COALESCE(o."ouverts", 0)::int AS "ouverts"
FROM (
  SELECT l."id" AS "lotId", l."coefficientReception" AS "coefficient",
         CASE WHEN COALESCE(s."solde", 0) > 0 AND l."coefficientReception" > 1
              THEN (s."solde" % l."coefficientReception")::int ELSE 0 END AS "reliquat"
  FROM "LotStock" l
  LEFT JOIN (
    SELECT m."lotId", sum(m."quantite") AS "solde" FROM "MouvementStock" m WHERE m."lotId" IS NOT NULL GROUP BY m."lotId"
  ) s ON s."lotId" = l."id"
) r
LEFT JOIN (
  SELECT c."lotId", count(*) AS "ouverts", min(c."unitesParConditionnement") AS "unitesMin", max(c."unitesParConditionnement") AS "unitesMax"
  FROM "ConditionnementOuvert" c
  WHERE c."fermeLe" IS NULL
  GROUP BY c."lotId"
) o ON o."lotId" = r."lotId"
WHERE (r."reliquat" > 0 AND (o."ouverts" IS NULL OR o."ouverts" > 1 OR o."unitesMin" <> r."coefficient" OR o."unitesMax" <> r."coefficient"))
   OR (r."reliquat" = 0 AND o."ouverts" IS NOT NULL)
ORDER BY 1`;

const SQL_VERIFIER_PLAGES = `
SELECT a."pointDeVenteId", a."id" AS "plageA", b."id" AS "plageB"
FROM "PlageTicket" a
JOIN "PlageTicket" b
  ON b."pointDeVenteId" = a."pointDeVenteId" AND a."id" < b."id" AND a."debut" <= b."fin" AND b."debut" <= a."fin"
ORDER BY 1, 2, 3`;

const SQL_VERIFIER_TABLE_ALLOCATIONS = `SELECT to_regclass('"AllocationLot"') IS NOT NULL AS "present"`;

const SQL_VERIFIER_ALLOCATIONS = `
SELECT l."id" AS "ligneVenteId", l."quantite" AS "quantite", COALESCE(sum(a."quantite") FILTER (WHERE a."statut" = 'DEFINITIVE'), 0)::int AS "alloue"
FROM "LigneVente" l
JOIN "AllocationLot" a ON a."ligneVenteId" = l."id"
GROUP BY l."id", l."quantite"
HAVING count(*) FILTER (WHERE a."statut" = 'PROVISOIRE') = 0
   AND COALESCE(sum(a."quantite") FILTER (WHERE a."statut" = 'DEFINITIVE'), 0) <> l."quantite"
ORDER BY l."id"`;

const SQL_RECONSTRUIRE_PRODUIT = `
INSERT INTO "AgregatStockProduit" ("stockMedicamentId", "pointDeVenteId", "quantite", "misAJourLe")
SELECT m."stockMedicamentId", m."pointDeVenteId", sum(m."quantite")::int, now()
FROM "MouvementStock" m
GROUP BY m."stockMedicamentId", m."pointDeVenteId"`;

const SQL_RECONSTRUIRE_LOT = `
INSERT INTO "AgregatStockLot" ("lotId", "stockMedicamentId", "pointDeVenteId", "quantite", "misAJourLe")
SELECT m."lotId", m."stockMedicamentId", m."pointDeVenteId", sum(m."quantite")::int, now()
FROM "MouvementStock" m
WHERE m."lotId" IS NOT NULL
GROUP BY m."lotId", m."stockMedicamentId", m."pointDeVenteId"`;

const SQL_FERMER_CONDITIONNEMENTS = `
UPDATE "ConditionnementOuvert" c
SET "fermeLe" = now()
FROM "LotStock" l
LEFT JOIN "AgregatStockLot" a ON a."lotId" = l."id"
WHERE c."lotId" = l."id"
  AND c."fermeLe" IS NULL
  AND (COALESCE(a."quantite", 0) <= 0
    OR l."coefficientReception" <= 1
    OR a."quantite" % l."coefficientReception" = 0
    OR c."unitesParConditionnement" <> l."coefficientReception")`;

const SQL_OUVRIR_CONDITIONNEMENTS = `
INSERT INTO "ConditionnementOuvert" ("id", "stockMedicamentId", "lotId", "pointDeVenteId", "unitesParConditionnement", "ouvertLe")
SELECT gen_random_uuid()::text, l."stockMedicamentId", l."id", l."pointDeVenteId", l."coefficientReception", now()
FROM "LotStock" l
JOIN "AgregatStockLot" a ON a."lotId" = l."id"
WHERE a."quantite" > 0
  AND l."coefficientReception" > 1
  AND a."quantite" % l."coefficientReception" <> 0
  AND NOT EXISTS (
    SELECT 1 FROM "ConditionnementOuvert" c WHERE c."lotId" = l."id" AND c."fermeLe" IS NULL
  )`;

const SQL_COMPARER_REPRISE = `
SELECT f."id" AS "stockMedicamentId", f."quantite" AS "compteur", COALESCE(m."quantite", 0)::int AS "reprise"
FROM "StockMedicament" f
LEFT JOIN (
  SELECT x."stockMedicamentId", sum(x."quantite") AS "quantite" FROM "MouvementStock" x WHERE x."pieceOrigineType" = 'MIGRATION' GROUP BY x."stockMedicamentId"
) m ON m."stockMedicamentId" = f."id"
WHERE f."quantite" <> COALESCE(m."quantite", 0)
ORDER BY f."id"`;

const SQL_COMPARER_AGREGAT = `
SELECT f."id" AS "stockMedicamentId", COALESCE(a."quantite", 0)::int AS "agregat", COALESCE(c."quantite", 0)::int AS "recalcul"
FROM "StockMedicament" f
LEFT JOIN (SELECT p."stockMedicamentId", sum(p."quantite") AS "quantite" FROM "AgregatStockProduit" p GROUP BY p."stockMedicamentId") a ON a."stockMedicamentId" = f."id"
LEFT JOIN (SELECT m."stockMedicamentId", sum(m."quantite") AS "quantite" FROM "MouvementStock" m GROUP BY m."stockMedicamentId") c ON c."stockMedicamentId" = f."id"
WHERE COALESCE(a."quantite", 0) <> COALESCE(c."quantite", 0)
ORDER BY f."id"`;

const SQL_COMPARER_ACTIVITE_FICHES = `
SELECT count(*)::int AS "n"
FROM "StockMedicament" f
LEFT JOIN (SELECT m."stockMedicamentId", sum(m."quantite") AS "quantite" FROM "MouvementStock" m GROUP BY m."stockMedicamentId") c ON c."stockMedicamentId" = f."id"
WHERE f."quantite" <> COALESCE(c."quantite", 0)`;

const SQL_COMPARER_ACTIVITE = `
SELECT m."pieceOrigineType"::text AS "typePiece", count(*)::int AS "mouvements", sum(m."quantite")::int AS "quantite"
FROM "MouvementStock" m
WHERE m."pieceOrigineType" <> 'MIGRATION'
GROUP BY m."pieceOrigineType"
ORDER BY 1`;

const SQL_PRE_TABLES = `SELECT to_regclass('"PointDeVente"') IS NOT NULL AS "pointsDeVente", to_regclass('"LotStock"') IS NOT NULL AS "lots", to_regclass('"Vente"') IS NOT NULL AS "ventes"`;

const SQL_PRE_PHARMACIES = `SELECT count(*)::int AS "n" FROM "Structure" WHERE "type" = 'PHARMACIE'`;

const SQL_PRE_FICHES = `
SELECT count(*)::int AS "fiches",
       count(*) FILTER (WHERE "quantite" > 0)::int AS "avecStock",
       count(*) FILTER (WHERE "quantite" = 0)::int AS "vides",
       count(*) FILTER (WHERE "prixUnitaire" IS NULL OR "prixUnitaire" = 0)::int AS "prixManquant",
       count(*) FILTER (WHERE "dateExpiration" IS NOT NULL AND "dateExpiration"::date < current_date)::int AS "perimees",
       count(*) FILTER (WHERE "dateExpiration" IS NULL)::int AS "sansDate"
FROM "StockMedicament"`;

const SQL_PRE_NEGATIVES = `SELECT "id" FROM "StockMedicament" WHERE "quantite" < 0 ORDER BY "id"`;

const SQL_NON_PHARMACIES_AVEC_VENTES = `
SELECT s."id"
FROM "Structure" s
WHERE s."type" <> 'PHARMACIE'
  AND (EXISTS (SELECT 1 FROM "StockMedicament" m WHERE m."structureId" = s."id")
    OR EXISTS (SELECT 1 FROM "Vente" v WHERE v."structureId" = s."id"))
ORDER BY s."id"`;

const SQL_NON_PHARMACIES_SANS_VENTES = `
SELECT s."id"
FROM "Structure" s
WHERE s."type" <> 'PHARMACIE'
  AND (EXISTS (SELECT 1 FROM "StockMedicament" m WHERE m."structureId" = s."id"))
ORDER BY s."id"`;

const SQL_PRE_VENTES = `SELECT count(*)::int AS "n" FROM "Vente"`;

const SQL_PRE_SANS_POINT_DE_VENTE = `
SELECT f."id"
FROM "StockMedicament" f
WHERE f."quantite" > 0
  AND NOT EXISTS (SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = f."structureId" AND pv."ordre" = 1)
ORDER BY f."id"`;

/** Termine une transaction en lecture seule : rien à écrire, l'annulation suffit. */
async function terminerLectureSeule(client: Client): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Transaction en lecture seule : rien à annuler.
  }
}

export async function verifierStock(
  client: Client,
): Promise<RapportVerification> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const produit = await client.query<{
      stockMedicamentId: string;
      pointDeVenteId: string;
      agregat: number | null;
      recalcul: number | null;
    }>(SQL_VERIFIER_AGREGATS_PRODUIT);
    const lot = await client.query<{
      lotId: string;
      agregat: number | null;
      recalcul: number | null;
    }>(SQL_VERIFIER_AGREGATS_LOT);
    const negatifs = await client.query<{ lotId: string; solde: number }>(
      SQL_VERIFIER_LOTS_NEGATIFS,
    );
    const conditionnements = await client.query<{
      lotId: string;
      reliquat: number;
      ouverts: number;
    }>(SQL_VERIFIER_CONDITIONNEMENTS);
    const plages = await client.query<{
      pointDeVenteId: string;
      plageA: string;
      plageB: string;
    }>(SQL_VERIFIER_PLAGES);
    const tableAllocations = await client.query<{ present: boolean }>(
      SQL_VERIFIER_TABLE_ALLOCATIONS,
    );
    const allocations = tableAllocations.rows[0].present
      ? (
          await client.query<{
            ligneVenteId: string;
            quantite: number;
            alloue: number;
          }>(SQL_VERIFIER_ALLOCATIONS)
        ).rows
      : [];

    const rapport: RapportVerification = {
      agregatsProduit: echantillon(produit.rows),
      agregatsLot: echantillon(lot.rows),
      lotsNegatifs: echantillon(negatifs.rows),
      conditionnements: echantillon(conditionnements.rows),
      plagesSuperposees: echantillon(plages.rows),
      allocations: echantillon(allocations),
      totalAnomalies: 0,
    };
    rapport.totalAnomalies =
      rapport.agregatsProduit.nombre +
      rapport.agregatsLot.nombre +
      rapport.lotsNegatifs.nombre +
      rapport.conditionnements.nombre +
      rapport.plagesSuperposees.nombre +
      rapport.allocations.nombre;
    return rapport;
  } finally {
    await terminerLectureSeule(client);
  }
}

export async function reconstruireStock(
  client: Client,
): Promise<BilanReconstruction> {
  await client.query('BEGIN');
  try {
    // Verrou contre les écritures concurrentes du journal pendant le recalcul (D500)
    await client.query(
      'LOCK TABLE "MouvementStock", "ConditionnementOuvert" IN SHARE ROW EXCLUSIVE MODE',
    );
    await client.query('TRUNCATE "AgregatStockLot", "AgregatStockProduit"');
    const produit = await client.query(SQL_RECONSTRUIRE_PRODUIT);
    const lot = await client.query(SQL_RECONSTRUIRE_LOT);
    const fermes = await client.query(SQL_FERMER_CONDITIONNEMENTS);
    const ouverts = await client.query(SQL_OUVRIR_CONDITIONNEMENTS);
    await client.query('COMMIT');
    return {
      agregatsProduit: produit.rowCount ?? 0,
      agregatsLot: lot.rowCount ?? 0,
      conditionnementsFermes: fermes.rowCount ?? 0,
      conditionnementsOuverts: ouverts.rowCount ?? 0,
    };
  } catch (erreur) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // La connexion est déjà fermée ou la transaction déjà annulée : l'erreur d'origine prime.
    }
    throw erreur;
  }
}

export async function comparerCompteur(
  client: Client,
): Promise<RapportComparaison> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const fiches = await client.query<{ n: number }>(
      'SELECT count(*)::int AS "n" FROM "StockMedicament"',
    );
    const reprise = await client.query<{
      stockMedicamentId: string;
      compteur: number;
      reprise: number;
    }>(SQL_COMPARER_REPRISE);
    const agregat = await client.query<{
      stockMedicamentId: string;
      agregat: number;
      recalcul: number;
    }>(SQL_COMPARER_AGREGAT);
    const enEcart = await client.query<{ n: number }>(
      SQL_COMPARER_ACTIVITE_FICHES,
    );
    const activite = await client.query<{
      typePiece: string;
      mouvements: number;
      quantite: number;
    }>(SQL_COMPARER_ACTIVITE);
    return {
      fiches: fiches.rows[0].n,
      ecartsReprise: echantillon(reprise.rows),
      ecartsAgregat: echantillon(agregat.rows),
      fichesEnEcartActivite: enEcart.rows[0].n,
      activite: activite.rows,
    };
  } finally {
    await terminerLectureSeule(client);
  }
}

export async function analyserPreMigration(
  client: Client,
): Promise<RapportPreMigration> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const tables = (
      await client.query<{
        pointsDeVente: boolean;
        lots: boolean;
        ventes: boolean;
      }>(SQL_PRE_TABLES)
    ).rows[0];
    const pharmacies = (await client.query<{ n: number }>(SQL_PRE_PHARMACIES))
      .rows[0].n;
    const fiches = (
      await client.query<{
        fiches: number;
        avecStock: number;
        vides: number;
        prixManquant: number;
        perimees: number;
        sansDate: number;
      }>(SQL_PRE_FICHES)
    ).rows[0];
    const negatives = await client.query<{ id: string }>(SQL_PRE_NEGATIVES);
    const nonPharmacies = await client.query<{ id: string }>(
      tables.ventes
        ? SQL_NON_PHARMACIES_AVEC_VENTES
        : SQL_NON_PHARMACIES_SANS_VENTES,
    );
    const ventes = tables.ventes
      ? (await client.query<{ n: number }>(SQL_PRE_VENTES)).rows[0].n
      : null;
    const sansPointDeVente = tables.pointsDeVente
      ? echantillon(
          (
            await client.query<{ id: string }>(SQL_PRE_SANS_POINT_DE_VENTE)
          ).rows.map((l) => l.id),
        )
      : null;

    const fichesNegatives = echantillon(negatives.rows.map((l) => l.id));
    const structuresNonPharmacie = echantillon(
      nonPharmacies.rows.map((l) => l.id),
    );
    return {
      pharmacies,
      fiches: fiches.fiches,
      fichesAvecStock: fiches.avecStock,
      fichesVides: fiches.vides,
      fichesPrixManquant: fiches.prixManquant,
      fichesPerimees: fiches.perimees,
      fichesSansDate: fiches.sansDate,
      ventes,
      fichesNegatives,
      structuresNonPharmacie,
      fichesSansPointDeVente: sansPointDeVente,
      journalEnPlace: tables.lots,
      bloquant:
        fichesNegatives.nombre > 0 ||
        structuresNonPharmacie.nombre > 0 ||
        (sansPointDeVente?.nombre ?? 0) > 0,
    };
  } finally {
    await terminerLectureSeule(client);
  }
}
