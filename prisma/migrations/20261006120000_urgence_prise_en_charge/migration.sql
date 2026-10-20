-- Alerte SOS : prise en charge tracée (structure, soignant, heure, délai d'arrivée annoncé)
-- et index de lecture de la dernière alerte d'un patient (anti-relance).
-- Généré par `prisma migrate diff` (schéma précédent vers schéma courant).

-- AlterTable
ALTER TABLE "Urgence" ADD COLUMN     "delaiArriveeMinutes" INTEGER,
ADD COLUMN     "priseEnChargeAt" TIMESTAMP(3),
ADD COLUMN     "priseEnChargeParId" TEXT,
ADD COLUMN     "structurePriseEnChargeId" TEXT;

-- CreateIndex
CREATE INDEX "Urgence_patientId_createdAt_idx" ON "Urgence"("patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "Urgence" ADD CONSTRAINT "Urgence_structurePriseEnChargeId_fkey" FOREIGN KEY ("structurePriseEnChargeId") REFERENCES "Structure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
