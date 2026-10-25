-- Alerte SOS (TB10b) : qualité de la position (précision, heure de mesure, origine)
-- et idempotence de la création (clé du client, bilan de diffusion rejoué).
-- Généré par `prisma migrate diff` (schéma précédent vers schéma courant).

-- CreateEnum
CREATE TYPE "SourcePositionUrgence" AS ENUM ('gps', 'reseau', 'inconnue');

-- AlterTable
ALTER TABLE "Urgence" ADD COLUMN     "bilanDiffusion" JSONB,
ADD COLUMN     "cleIdempotence" TEXT,
ADD COLUMN     "horodatagePosition" TIMESTAMP(3),
ADD COLUMN     "precisionMetres" DOUBLE PRECISION,
ADD COLUMN     "sourcePosition" "SourcePositionUrgence";

-- CreateIndex
CREATE UNIQUE INDEX "Urgence_patientId_cleIdempotence_key" ON "Urgence"("patientId", "cleIdempotence");
