-- Tranche pharmacie 2, import Excel hors ligne : type d'anomalie IMPORT_DIFFERE_PARTIEL.
-- Migration additive : une valeur ajoutée à l'enum TypeAnomalie, après CREDIT_TROP_PERCU. Aucune anomalie existante ne change.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- La valeur n'est utilisée par aucune instruction de cette transaction.
-- Retour arrière : prisma/retours-arriere/20261119100000_pharmacie_t2_anomalie_import_differe_partiel.down.sql.
BEGIN;

-- AlterEnum
ALTER TYPE "TypeAnomalie" ADD VALUE IF NOT EXISTS 'IMPORT_DIFFERE_PARTIEL' AFTER 'CREDIT_TROP_PERCU';

COMMIT;
