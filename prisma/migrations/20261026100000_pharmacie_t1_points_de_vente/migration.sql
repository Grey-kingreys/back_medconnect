-- Tranche pharmacie 1, points de vente, postes et référentiels (PB05, M2, D421, D478 à D484).
-- DDL généré par prisma migrate diff (schéma d'avant vers schéma de PB05) ; contrôle d'arrêt, CHECK et reprise écrits à la main.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
BEGIN;

-- Arrêt (plan, section 2) : un point de vente n'est créé que pour une PHARMACIE.
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "Structure" s
  WHERE s."type" <> 'PHARMACIE'
    AND (EXISTS (SELECT 1 FROM "StockMedicament" m WHERE m."structureId" = s."id")
      OR EXISTS (SELECT 1 FROM "Vente" v WHERE v."structureId" = s."id"));
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT s."id"
      FROM "Structure" s
      WHERE s."type" <> 'PHARMACIE'
        AND (EXISTS (SELECT 1 FROM "StockMedicament" m WHERE m."structureId" = s."id")
          OR EXISTS (SELECT 1 FROM "Vente" v WHERE v."structureId" = s."id"))
      ORDER BY s."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M2 arrêtée : % structure(s) qui ne sont pas des pharmacies portent du stock ou des ventes, décision requise avant de créer les points de vente. Structures en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "TypePoste" AS ENUM ('WEB', 'DESKTOP', 'TECHNIQUE');

-- CreateEnum
CREATE TYPE "TypeCoupure" AS ENUM ('BILLET', 'PIECE');

-- CreateEnum
CREATE TYPE "TypeAnomalie" AS ENUM ('STOCK_NEGATIF', 'ECART_INVENTAIRE', 'CONDITIONNEMENT_CONCURRENT', 'REMONTEE_APRES_CLOTURE', 'ECART_CAISSE', 'FOND_NON_COMPTE', 'PLAGE_EPUISEE', 'PRIX_DIVERGENT', 'ORDONNANCE_NON_CONFIRMEE', 'VENTE_UNITE_INTERDITE', 'PRODUIT_ARCHIVE', 'EVENEMENT_REJETE', 'SEQUENCE_MANQUANTE');

-- CreateEnum
CREATE TYPE "StatutAnomalie" AS ENUM ('OUVERTE', 'TRAITEE');

-- CreateTable
CREATE TABLE "PointDeVente" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointDeVente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Poste" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "type" "TypePoste" NOT NULL,
    "appareilId" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "derniereSequenceAppliquee" INTEGER NOT NULL DEFAULT 0,
    "dernierContactLe" TIMESTAMP(3),
    "dernierEtat" JSONB,
    "enregistreParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Poste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompteurTicket" (
    "pointDeVenteId" TEXT NOT NULL,
    "prochainNumero" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CompteurTicket_pkey" PRIMARY KEY ("pointDeVenteId")
);

-- CreateTable
CREATE TABLE "PlageTicket" (
    "id" TEXT NOT NULL,
    "posteId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "debut" INTEGER NOT NULL,
    "fin" INTEGER NOT NULL,
    "attribueeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attribueeParId" TEXT,

    CONSTRAINT "PlageTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParametresPharmacie" (
    "structureId" TEXT NOT NULL,
    "horizonsPeremptionJours" INTEGER[] DEFAULT ARRAY[90, 30, 7]::INTEGER[],
    "seuilEcartCaisse" INTEGER NOT NULL DEFAULT 5000,
    "seuilAvertissementPrixPct" INTEGER NOT NULL DEFAULT 25,
    "seuilStockBas" INTEGER NOT NULL DEFAULT 10,
    "taillePlageTickets" INTEGER NOT NULL DEFAULT 1000,
    "seuilRechargementPlagePct" INTEGER NOT NULL DEFAULT 20,
    "debutFiabiliteMarge" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "debutCaisse" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "misAJourParId" TEXT,

    CONSTRAINT "ParametresPharmacie_pkey" PRIMARY KEY ("structureId")
);

-- CreateTable
CREATE TABLE "ModePaiement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "comptagePhysique" BOOLEAN NOT NULL,
    "referenceAutorisee" BOOLEAN NOT NULL,
    "ordre" INTEGER NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ModePaiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoupureMonnaie" (
    "id" TEXT NOT NULL,
    "devise" TEXT NOT NULL DEFAULT 'GNF',
    "valeurFaciale" INTEGER NOT NULL,
    "type" "TypeCoupure" NOT NULL,
    "ordre" INTEGER NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CoupureMonnaie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fournisseur" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anomalie" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "type" "TypeAnomalie" NOT NULL,
    "statut" "StatutAnomalie" NOT NULL DEFAULT 'OUVERTE',
    "attribueeAId" TEXT,
    "pieceType" TEXT NOT NULL,
    "pieceId" TEXT,
    "details" JSONB NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traiteeLe" TIMESTAMP(3),
    "traiteeParId" TEXT,
    "commentaireTraitement" TEXT,

    CONSTRAINT "Anomalie_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointDeVente_structureId_idx" ON "PointDeVente"("structureId");

-- CreateIndex
CREATE UNIQUE INDEX "PointDeVente_structureId_ordre_key" ON "PointDeVente"("structureId", "ordre");

-- CreateIndex
CREATE UNIQUE INDEX "Poste_pointDeVenteId_code_key" ON "Poste"("pointDeVenteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Poste_pointDeVenteId_appareilId_key" ON "Poste"("pointDeVenteId", "appareilId");

-- CreateIndex
CREATE INDEX "PlageTicket_posteId_idx" ON "PlageTicket"("posteId");

-- CreateIndex
CREATE UNIQUE INDEX "ModePaiement_code_key" ON "ModePaiement"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CoupureMonnaie_devise_valeurFaciale_key" ON "CoupureMonnaie"("devise", "valeurFaciale");

-- CreateIndex
CREATE UNIQUE INDEX "Fournisseur_structureId_nom_key" ON "Fournisseur"("structureId", "nom");

-- CreateIndex
CREATE INDEX "Anomalie_pointDeVenteId_statut_creeLe_idx" ON "Anomalie"("pointDeVenteId", "statut", "creeLe");

-- AddForeignKey
ALTER TABLE "PointDeVente" ADD CONSTRAINT "PointDeVente_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poste" ADD CONSTRAINT "Poste_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompteurTicket" ADD CONSTRAINT "CompteurTicket_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlageTicket" ADD CONSTRAINT "PlageTicket_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlageTicket" ADD CONSTRAINT "PlageTicket_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParametresPharmacie" ADD CONSTRAINT "ParametresPharmacie_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fournisseur" ADD CONSTRAINT "Fournisseur_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anomalie" ADD CONSTRAINT "Anomalie_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Une plage de tickets n'est jamais inversée (fin incluse).
ALTER TABLE "PlageTicket" ADD CONSTRAINT "PlageTicket_fin_debut_check" CHECK ("fin" >= "debut");

-- Reprise (D421) : un point de vente (ordre 1) par pharmacie, son poste technique REPRISE
-- (inactif, porteur des ventes historiques à partir de M6), son compteur de tickets et ses paramètres.
INSERT INTO "PointDeVente" ("id", "structureId", "ordre", "nom")
SELECT gen_random_uuid()::text, s."id", 1, s."nom"
FROM "Structure" s
WHERE s."type" = 'PHARMACIE';

INSERT INTO "Poste" ("id", "pointDeVenteId", "code", "libelle", "type", "actif")
SELECT gen_random_uuid()::text, pv."id", 'REPRISE', 'Reprise des ventes historiques', 'TECHNIQUE', false
FROM "PointDeVente" pv;

INSERT INTO "CompteurTicket" ("pointDeVenteId")
SELECT pv."id" FROM "PointDeVente" pv;

INSERT INTO "ParametresPharmacie" ("structureId")
SELECT s."id" FROM "Structure" s WHERE s."type" = 'PHARMACIE';

-- Référentiels globaux : 3 modes de paiement (O7) ; 6 billets (correction du porteur : rien sous 500 GNF).
INSERT INTO "ModePaiement" ("id", "code", "libelle", "comptagePhysique", "referenceAutorisee", "ordre")
VALUES
  (gen_random_uuid()::text, 'ESPECES', 'Espèces', true, false, 1),
  (gen_random_uuid()::text, 'ORANGE_MONEY', 'Orange Money', false, true, 2),
  (gen_random_uuid()::text, 'MTN_MOMO', 'MTN MoMo', false, true, 3);

INSERT INTO "CoupureMonnaie" ("id", "devise", "valeurFaciale", "type", "ordre")
VALUES
  (gen_random_uuid()::text, 'GNF', 20000, 'BILLET', 1),
  (gen_random_uuid()::text, 'GNF', 10000, 'BILLET', 2),
  (gen_random_uuid()::text, 'GNF', 5000, 'BILLET', 3),
  (gen_random_uuid()::text, 'GNF', 2000, 'BILLET', 4),
  (gen_random_uuid()::text, 'GNF', 1000, 'BILLET', 5),
  (gen_random_uuid()::text, 'GNF', 500, 'BILLET', 6);

COMMIT;
