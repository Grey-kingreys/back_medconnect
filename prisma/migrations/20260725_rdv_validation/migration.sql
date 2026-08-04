-- RDV avec workflow de validation (rôle Accueil).
--   * Nouveaux statuts EN_ATTENTE / REFUSE (proposition en attente / refus).
--   * `medecinId` devient optionnel (RDV « avec la structure », non encore affecté),
--     avec FK ON DELETE SET NULL pour préserver l'historique si un médecin est retiré.
-- Les ADD VALUE ne sont pas utilisés dans cette migration → compatibles avec la
-- transaction de `prisma migrate deploy` (PostgreSQL 12+).

ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'EN_ATTENTE';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'REFUSE';

ALTER TABLE "RendezVous" ALTER COLUMN "medecinId" DROP NOT NULL;

ALTER TABLE "RendezVous" DROP CONSTRAINT IF EXISTS "RendezVous_medecinId_fkey";
ALTER TABLE "RendezVous"
  ADD CONSTRAINT "RendezVous_medecinId_fkey"
  FOREIGN KEY ("medecinId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
