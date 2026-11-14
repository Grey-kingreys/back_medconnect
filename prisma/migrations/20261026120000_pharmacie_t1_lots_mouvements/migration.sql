-- Tranche pharmacie 1, lots, journal de stock, agrégats et reprise (PB07, M4, D401, D403 à D405, D418, D431, D493 à D505).
-- DDL généré par prisma migrate diff (schéma de PB06 vers schéma de PB07) ; contrôles, CHECK, fonctions,
-- triggers et reprise écrits à la main.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- À lancer avant le déploiement : npm run pharmacie:pre-migration (lecture seule).
BEGIN;

-- Arrêt (plan, section 2) : aucune quantité négative, et toute fiche avec du stock a un point de vente.
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "StockMedicament" f
  WHERE f."quantite" < 0;
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT f."id" FROM "StockMedicament" f WHERE f."quantite" < 0 ORDER BY f."id" LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M4 arrêtée : % fiche(s) de stock ont une quantité négative, à corriger avant la reprise. Fiches en cause (50 au plus) : %', nombre, en_cause;
  END IF;

  SELECT count(*)::int INTO nombre
  FROM "StockMedicament" f
  WHERE f."quantite" > 0
    AND NOT EXISTS (
      SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = f."structureId" AND pv."ordre" = 1
    );
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT f."id"
      FROM "StockMedicament" f
      WHERE f."quantite" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = f."structureId" AND pv."ordre" = 1
        )
      ORDER BY f."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M4 arrêtée : % fiche(s) avec du stock appartiennent à une structure sans point de vente. Fiches en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "TypeMouvementStock" AS ENUM ('RECEPTION', 'VENTE', 'RETOUR', 'INVENTAIRE', 'PERTE', 'PEREMPTION', 'TRANSFERT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "TypePiece" AS ENUM ('MIGRATION', 'VENTE', 'ANNULATION', 'RECEPTION', 'INVENTAIRE', 'SORTIE_MANUELLE', 'RESOLUTION', 'QUALIFICATION', 'AJUSTEMENT');

-- CreateTable
CREATE TABLE "LotStock" (
    "id" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "numeroLot" TEXT,
    "dateExpiration" DATE,
    "quantiteRecue" INTEGER NOT NULL,
    "coutUnitaire" INTEGER NOT NULL,
    "coutAchatBoite" INTEGER,
    "coefficientReception" INTEGER NOT NULL,
    "fournisseurId" TEXT,
    "receptionId" TEXT,
    "dateReception" TIMESTAMP(3) NOT NULL,
    "lotTechnique" BOOLEAN NOT NULL DEFAULT false,
    "auteurId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementStock" (
    "id" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "lotId" TEXT,
    "type" "TypeMouvementStock" NOT NULL,
    "quantite" INTEGER NOT NULL,
    "pieceOrigineType" "TypePiece" NOT NULL,
    "pieceOrigineId" TEXT,
    "motif" TEXT,
    "auteurId" TEXT,
    "horodatageServeur" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horodatageLocal" TIMESTAMP(3),
    "posteId" TEXT,
    "sequencePoste" INTEGER,

    CONSTRAINT "MouvementStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgregatStockLot" (
    "lotId" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "misAJourLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgregatStockLot_pkey" PRIMARY KEY ("lotId")
);

-- CreateTable
CREATE TABLE "AgregatStockProduit" (
    "stockMedicamentId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "misAJourLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgregatStockProduit_pkey" PRIMARY KEY ("stockMedicamentId","pointDeVenteId")
);

-- CreateTable
CREATE TABLE "ConditionnementOuvert" (
    "id" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "unitesParConditionnement" INTEGER NOT NULL,
    "ouvertLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ouvertParId" TEXT,
    "ouvertParPieceId" TEXT,
    "fermeLe" TIMESTAMP(3),

    CONSTRAINT "ConditionnementOuvert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LotStock_stockMedicamentId_pointDeVenteId_dateExpiration_da_idx" ON "LotStock"("stockMedicamentId", "pointDeVenteId", "dateExpiration", "dateReception");

-- CreateIndex
CREATE INDEX "LotStock_pointDeVenteId_dateExpiration_idx" ON "LotStock"("pointDeVenteId", "dateExpiration");

-- CreateIndex
CREATE UNIQUE INDEX "MouvementStock_evenementId_key" ON "MouvementStock"("evenementId");

-- CreateIndex
CREATE INDEX "MouvementStock_stockMedicamentId_pointDeVenteId_idx" ON "MouvementStock"("stockMedicamentId", "pointDeVenteId");

-- CreateIndex
CREATE INDEX "MouvementStock_lotId_idx" ON "MouvementStock"("lotId");

-- CreateIndex
CREATE INDEX "MouvementStock_pieceOrigineType_pieceOrigineId_idx" ON "MouvementStock"("pieceOrigineType", "pieceOrigineId");

-- CreateIndex
CREATE INDEX "AgregatStockLot_stockMedicamentId_pointDeVenteId_idx" ON "AgregatStockLot"("stockMedicamentId", "pointDeVenteId");

-- CreateIndex
CREATE INDEX "AgregatStockProduit_pointDeVenteId_quantite_idx" ON "AgregatStockProduit"("pointDeVenteId", "quantite");

-- CreateIndex
CREATE INDEX "ConditionnementOuvert_lotId_idx" ON "ConditionnementOuvert"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "ConditionnementOuvert_stockMedicamentId_lotId_pointDeVenteI_key" ON "ConditionnementOuvert"("stockMedicamentId", "lotId", "pointDeVenteId") WHERE ("fermeLe" IS NULL);

-- AddForeignKey
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockLot" ADD CONSTRAINT "AgregatStockLot_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockLot" ADD CONSTRAINT "AgregatStockLot_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockLot" ADD CONSTRAINT "AgregatStockLot_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockProduit" ADD CONSTRAINT "AgregatStockProduit_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockProduit" ADD CONSTRAINT "AgregatStockProduit_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionnementOuvert" ADD CONSTRAINT "ConditionnementOuvert_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionnementOuvert" ADD CONSTRAINT "ConditionnementOuvert_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionnementOuvert" ADD CONSTRAINT "ConditionnementOuvert_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contraintes (plan 1.3, D494)
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_quantiteRecue_check" CHECK ("quantiteRecue" >= 0);
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_coutUnitaire_check" CHECK ("coutUnitaire" >= 0);
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_coutAchatBoite_check" CHECK ("coutAchatBoite" IS NULL OR "coutAchatBoite" >= 0);
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_coefficientReception_check" CHECK ("coefficientReception" >= 1);
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_quantite_check" CHECK ("quantite" <> 0 OR "type" = 'INVENTAIRE');
ALTER TABLE "AgregatStockLot" ADD CONSTRAINT "AgregatStockLot_quantite_check" CHECK ("quantite" >= 0);
ALTER TABLE "ConditionnementOuvert" ADD CONSTRAINT "ConditionnementOuvert_unitesParConditionnement_check" CHECK ("unitesParConditionnement" >= 2);

-- Immuabilité du journal (D431) : ni modification ni suppression ni troncature, sauf suppression et
-- troncature sous SET LOCAL medconnecte.purge_autorisee = 'on' (purge démo et harnais). Réutilisée par M5 et M6.
CREATE FUNCTION "journal_refuser_modification"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') AND current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Écriture refusée sur la table % : le journal de stock et les pièces ne se modifient ni ne se suppriment jamais.', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER "mouvement_stock_immuable"
BEFORE UPDATE OR DELETE ON "MouvementStock"
FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();

CREATE TRIGGER "mouvement_stock_sans_troncature"
BEFORE TRUNCATE ON "MouvementStock"
FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- Lot : point de vente de la pharmacie de la fiche ; figé après insertion, sauf dateExpiration, et
-- coefficientReception et coutUnitaire d'un lot technique (qualification, PB13) ; jamais supprimé hors purge.
CREATE FUNCTION "lot_stock_proteger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Le lot % ne peut pas être supprimé : un lot de stock est conservé définitivement.', OLD."id";
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1
    FROM "StockMedicament" f
    JOIN "PointDeVente" pv ON pv."structureId" = f."structureId"
    WHERE f."id" = NEW."stockMedicamentId" AND pv."id" = NEW."pointDeVenteId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lot refusé : le point de vente % n''appartient pas à la pharmacie de la fiche %.', NEW."pointDeVenteId", NEW."stockMedicamentId";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."stockMedicamentId" IS DISTINCT FROM OLD."stockMedicamentId"
    OR NEW."pointDeVenteId" IS DISTINCT FROM OLD."pointDeVenteId"
    OR NEW."numeroLot" IS DISTINCT FROM OLD."numeroLot"
    OR NEW."quantiteRecue" IS DISTINCT FROM OLD."quantiteRecue"
    OR NEW."coutAchatBoite" IS DISTINCT FROM OLD."coutAchatBoite"
    OR NEW."fournisseurId" IS DISTINCT FROM OLD."fournisseurId"
    OR NEW."receptionId" IS DISTINCT FROM OLD."receptionId"
    OR NEW."dateReception" IS DISTINCT FROM OLD."dateReception"
    OR NEW."lotTechnique" IS DISTINCT FROM OLD."lotTechnique"
    OR NEW."auteurId" IS DISTINCT FROM OLD."auteurId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Le lot % ne peut pas être modifié : seule sa date de péremption se corrige après la réception.', OLD."id";
  END IF;
  IF NOT OLD."lotTechnique"
    AND (NEW."coefficientReception" IS DISTINCT FROM OLD."coefficientReception"
      OR NEW."coutUnitaire" IS DISTINCT FROM OLD."coutUnitaire") THEN
    RAISE EXCEPTION 'Le lot % ne peut pas être modifié : le coefficient et le coût ne changent que sur un lot technique, à la qualification de la fiche.', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "lot_stock_proteger"
BEFORE INSERT OR UPDATE OR DELETE ON "LotStock"
FOR EACH ROW EXECUTE FUNCTION "lot_stock_proteger"();

-- Agrégats de lecture (D403) : tenus dans la transaction du mouvement, jamais par le code applicatif.
-- Un lot ne descend jamais sous zéro (AgregatStockLot_quantite_check) ; le produit peut être négatif (O11).
CREATE FUNCTION "mouvement_stock_agreger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."lotId" IS NOT NULL THEN
    PERFORM 1
    FROM "LotStock" l
    WHERE l."id" = NEW."lotId"
      AND l."stockMedicamentId" = NEW."stockMedicamentId"
      AND l."pointDeVenteId" = NEW."pointDeVenteId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mouvement refusé : le lot % n''appartient pas à la fiche % dans le point de vente %.', NEW."lotId", NEW."stockMedicamentId", NEW."pointDeVenteId";
    END IF;
  ELSE
    PERFORM 1
    FROM "StockMedicament" f
    JOIN "PointDeVente" pv ON pv."structureId" = f."structureId"
    WHERE f."id" = NEW."stockMedicamentId" AND pv."id" = NEW."pointDeVenteId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mouvement refusé : le point de vente % n''appartient pas à la pharmacie de la fiche %.', NEW."pointDeVenteId", NEW."stockMedicamentId";
    END IF;
  END IF;

  INSERT INTO "AgregatStockProduit" ("stockMedicamentId", "pointDeVenteId", "quantite", "misAJourLe")
  VALUES (NEW."stockMedicamentId", NEW."pointDeVenteId", NEW."quantite", now())
  ON CONFLICT ("stockMedicamentId", "pointDeVenteId") DO UPDATE
  SET "quantite" = "AgregatStockProduit"."quantite" + EXCLUDED."quantite",
      "misAJourLe" = EXCLUDED."misAJourLe";

  -- Pas de ON CONFLICT ici : PostgreSQL vérifie le CHECK sur la ligne proposée à l'insertion
  -- (une sortie négative serait refusée même quand le solde reste positif). Le premier mouvement
  -- d'un lot est écrit dans la transaction qui crée le lot, sous verrou de la fiche (D500).
  IF NEW."lotId" IS NOT NULL THEN
    UPDATE "AgregatStockLot"
    SET "quantite" = "quantite" + NEW."quantite",
        "misAJourLe" = now()
    WHERE "lotId" = NEW."lotId";
    IF NOT FOUND THEN
      INSERT INTO "AgregatStockLot" ("lotId", "stockMedicamentId", "pointDeVenteId", "quantite", "misAJourLe")
      VALUES (NEW."lotId", NEW."stockMedicamentId", NEW."pointDeVenteId", NEW."quantite", now());
    END IF;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER "mouvement_stock_agreger"
AFTER INSERT ON "MouvementStock"
FOR EACH ROW EXECUTE FUNCTION "mouvement_stock_agreger"();

-- REPRISE: DEBUT (rejouable sans doublon, D418, D497)
-- Un lot technique par fiche à quantité positive : sans numéro, date de péremption de la fiche (O4),
-- coût 0 (non valorisable), coefficient 1, point de vente d'ordre 1 de la pharmacie.
INSERT INTO "LotStock" ("id", "stockMedicamentId", "pointDeVenteId", "numeroLot", "dateExpiration", "quantiteRecue", "coutUnitaire", "coutAchatBoite", "coefficientReception", "fournisseurId", "receptionId", "dateReception", "lotTechnique", "auteurId")
SELECT gen_random_uuid()::text, f."id", pv."id", NULL, f."dateExpiration"::date, f."quantite", 0, NULL, 1, NULL, NULL, now(), true, NULL
FROM "StockMedicament" f
JOIN "PointDeVente" pv ON pv."structureId" = f."structureId" AND pv."ordre" = 1
WHERE f."quantite" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "LotStock" l WHERE l."stockMedicamentId" = f."id" AND l."lotTechnique"
  );

-- Un mouvement RECEPTION par lot repris, pièce MIGRATION, auteur système ; les agrégats suivent par trigger.
INSERT INTO "MouvementStock" ("id", "evenementId", "pointDeVenteId", "stockMedicamentId", "lotId", "type", "quantite", "pieceOrigineType", "pieceOrigineId", "motif", "auteurId")
SELECT gen_random_uuid()::text, 'migration:' || f."id", l."pointDeVenteId", f."id", l."id", 'RECEPTION', l."quantiteRecue", 'MIGRATION', '20261026120000_pharmacie_t1_lots_mouvements', 'Reprise du stock existant', NULL
FROM "LotStock" l
JOIN "StockMedicament" f ON f."id" = l."stockMedicamentId"
WHERE l."lotTechnique" AND f."quantite" > 0
ON CONFLICT ("evenementId") DO NOTHING;
-- REPRISE: FIN

-- Contrôle final : le stock calculé égale le compteur, fiche par fiche, sinon rien n'est appliqué.
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "StockMedicament" f
  WHERE f."quantite" <> COALESCE((SELECT sum(a."quantite") FROM "AgregatStockProduit" a WHERE a."stockMedicamentId" = f."id"), 0);
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT f."id"
      FROM "StockMedicament" f
      WHERE f."quantite" <> COALESCE((SELECT sum(a."quantite") FROM "AgregatStockProduit" a WHERE a."stockMedicamentId" = f."id"), 0)
      ORDER BY f."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M4 arrêtée : le stock calculé diffère du compteur pour % fiche(s). Fiches en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- Gel du compteur (plan 2, D493) : quantite et disponible ne s'écrivent plus ; une fiche se crée à quantité nulle.
CREATE FUNCTION "stock_medicament_geler_compteur"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."quantite" <> 0 THEN
      RAISE EXCEPTION 'Fiche de stock refusée : la quantité ne s''écrit plus sur la fiche (créer la fiche à quantité nulle, le stock vient du journal MouvementStock).';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."quantite" IS DISTINCT FROM OLD."quantite" OR NEW."disponible" IS DISTINCT FROM OLD."disponible" THEN
    RAISE EXCEPTION 'Fiche de stock % : quantite et disponible sont gelées depuis la reprise, le stock s''écrit par le journal MouvementStock.', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "stock_medicament_geler_compteur"
BEFORE INSERT OR UPDATE ON "StockMedicament"
FOR EACH ROW EXECUTE FUNCTION "stock_medicament_geler_compteur"();

COMMIT;
