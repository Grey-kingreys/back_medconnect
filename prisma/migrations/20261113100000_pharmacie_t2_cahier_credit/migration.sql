-- Tranche pharmacie 2, cahier de crédit (M11). Écrit à la main. Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- Ajoute : le client de crédit, le remboursement (immuable), la date limite d'une prise (Vente est immuable : la date vit à part),
-- le rattachement facultatif d'une Vente à un client (colonne ajoutée, aucune donnée existante touchée), le mode de paiement CREDIT
-- et les permissions credit:read et credit:write (titulaire et rôles « Pharmacien » des pharmacies).
BEGIN;

-- CreateTable
CREATE TABLE "ClientCredit" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "nomComplet" TEXT NOT NULL,
    "telephone" TEXT,
    "note" TEXT,
    "auteurId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemboursementCredit" (
    "id" TEXT NOT NULL,
    "clientCreditId" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "note" TEXT,
    "verseEnCaisse" BOOLEAN NOT NULL DEFAULT false,
    "mouvementCaisseId" TEXT,
    "auteurId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemboursementCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcheanceCredit" (
    "venteId" TEXT NOT NULL,
    "dateLimite" DATE NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcheanceCredit_pkey" PRIMARY KEY ("venteId")
);

-- AlterTable
ALTER TABLE "Vente" ADD COLUMN "clientCreditId" TEXT;

-- CreateIndex
CREATE INDEX "ClientCredit_structureId_nomComplet_idx" ON "ClientCredit"("structureId", "nomComplet");

-- CreateIndex
CREATE INDEX "RemboursementCredit_clientCreditId_idx" ON "RemboursementCredit"("clientCreditId");

-- CreateIndex
CREATE INDEX "Vente_clientCreditId_idx" ON "Vente"("clientCreditId");

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_clientCreditId_fkey" FOREIGN KEY ("clientCreditId") REFERENCES "ClientCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCredit" ADD CONSTRAINT "ClientCredit_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemboursementCredit" ADD CONSTRAINT "RemboursementCredit_clientCreditId_fkey" FOREIGN KEY ("clientCreditId") REFERENCES "ClientCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Montant d'un remboursement strictement positif.
ALTER TABLE "RemboursementCredit" ADD CONSTRAINT "RemboursementCredit_montant_check" CHECK ("montant" > 0);

-- Un remboursement est une pièce : ni modification ni suppression (fonction de M4, suppression permise sous la purge).
CREATE TRIGGER "remboursement_credit_immuable"
BEFORE UPDATE OR DELETE ON "RemboursementCredit"
FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();

-- Mode de paiement CREDIT : jamais compté comme argent encaissé (les calculs de caisse l'écartent). Ordre après les modes existants.
INSERT INTO "ModePaiement" ("id", "code", "libelle", "comptagePhysique", "referenceAutorisee", "ordre")
SELECT gen_random_uuid()::text, 'CREDIT', 'Crédit', false, false, COALESCE(MAX(m."ordre"), 0) + 1
FROM "ModePaiement" m
ON CONFLICT ("code") DO NOTHING;

-- Permissions et rôles : titulaire (« Administrateur de structure ») et « Pharmacien » des pharmacies.
INSERT INTO "Permission" ("id", "code", "libelle", "categorie")
VALUES
  (gen_random_uuid()::text, 'credit:read', 'Consulter le cahier de crédit', 'Pharmacie'),
  (gen_random_uuid()::text, 'credit:write', 'Vendre à crédit et enregistrer les remboursements', 'Pharmacie')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("appRoleId", "permissionId")
SELECT r."id", p."id"
FROM "AppRole" r
JOIN "Structure" s ON s."id" = r."structureId" AND s."type" = 'PHARMACIE'
JOIN "Permission" p ON p."code" IN ('credit:read', 'credit:write')
WHERE r."nom" IN ('Administrateur de structure', 'Pharmacien')
ON CONFLICT DO NOTHING;

COMMIT;
