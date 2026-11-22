-- Tranche pharmacie 2, fiches hors ligne : type d'anomalie FICHE_MODIFIEE_ENTRETEMPS.
-- Migration additive : une valeur ajoutée à l'enum TypeAnomalie, après RECEPTION_COEFFICIENT_DIFFERENT. Aucune anomalie existante ne change.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- La valeur n'est utilisée par aucune instruction de cette transaction.
-- Retour arrière : prisma/retours-arriere/20261116100000_pharmacie_t2_anomalie_fiche_modifiee_entretemps.down.sql.
BEGIN;

-- AlterEnum
ALTER TYPE "TypeAnomalie" ADD VALUE IF NOT EXISTS 'FICHE_MODIFIEE_ENTRETEMPS' AFTER 'RECEPTION_COEFFICIENT_DIFFERENT';

COMMIT;
