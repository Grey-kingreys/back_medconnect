-- Ventes en pharmacie (lot 7, B13) : ventes, lignes, compteur de numérotation, prix du stock en entier.
-- DDL généré par prisma migrate diff ; reprise des permissions écrite à la main.

-- CreateEnum
CREATE TYPE "StatutVente" AS ENUM ('VALIDEE', 'ANNULEE');

-- AlterTable
ALTER TABLE "StockMedicament" ALTER COLUMN "prixUnitaire" SET DATA TYPE INTEGER USING ROUND("prixUnitaire")::INTEGER;

-- CreateTable
CREATE TABLE "Vente" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "vendeurId" TEXT NOT NULL,
    "vendeurNom" TEXT NOT NULL,
    "clientNom" TEXT,
    "clientTelephone" TEXT,
    "ordonnanceVerifiee" BOOLEAN NOT NULL DEFAULT false,
    "total" INTEGER NOT NULL,
    "statut" "StatutVente" NOT NULL DEFAULT 'VALIDEE',
    "annuleeLe" TIMESTAMP(3),
    "annuleeParId" TEXT,
    "motifAnnulation" TEXT,
    "cleIdempotence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneVente" (
    "id" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "medicamentId" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "nomMedicament" TEXT NOT NULL,
    "prixUnitaire" INTEGER NOT NULL,
    "quantite" INTEGER NOT NULL,
    "sousTotal" INTEGER NOT NULL,

    CONSTRAINT "LigneVente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompteurVente" (
    "structureId" TEXT NOT NULL,
    "annee" INTEGER NOT NULL,
    "dernierNumero" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompteurVente_pkey" PRIMARY KEY ("structureId","annee")
);

-- CreateIndex
CREATE INDEX "Vente_structureId_createdAt_idx" ON "Vente"("structureId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_structureId_numero_key" ON "Vente"("structureId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_structureId_cleIdempotence_key" ON "Vente"("structureId", "cleIdempotence");

-- CreateIndex
CREATE INDEX "LigneVente_venteId_idx" ON "LigneVente"("venteId");

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompteurVente" ADD CONSTRAINT "CompteurVente_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permissions des ventes (D112) : catalogue, puis rôles existants des pharmacies.
-- RolesService n'applique les permissions d'un rôle de structure qu'à sa création.
INSERT INTO "Permission" ("id", "code", "libelle", "categorie")
VALUES
  (gen_random_uuid()::text, 'vente:read', 'Consulter les ventes de la pharmacie', 'Pharmacie'),
  (gen_random_uuid()::text, 'vente:write', 'Enregistrer une vente', 'Pharmacie'),
  (gen_random_uuid()::text, 'vente:annuler', 'Annuler une vente du jour', 'Pharmacie')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("appRoleId", "permissionId")
SELECT r."id", p."id"
FROM "AppRole" r
JOIN "Structure" s ON s."id" = r."structureId" AND s."type" = 'PHARMACIE'
JOIN "Permission" p ON (
  (r."nom" = 'Pharmacien' AND p."code" IN ('vente:read', 'vente:write'))
  OR (r."nom" = 'Administrateur de structure' AND p."code" IN ('vente:read', 'vente:write', 'vente:annuler'))
)
ON CONFLICT DO NOTHING;
