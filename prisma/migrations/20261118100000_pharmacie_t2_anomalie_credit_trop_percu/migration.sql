-- Tranche pharmacie 2, cahier de crédit hors ligne : type d'anomalie CREDIT_TROP_PERCU.
-- Migration additive : une valeur ajoutée à l'enum TypeAnomalie, après THEORIQUE_DIVERGENT. Aucune anomalie existante ne change.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- La valeur n'est utilisée par aucune instruction de cette transaction.
-- Retour arrière : prisma/retours-arriere/20261118100000_pharmacie_t2_anomalie_credit_trop_percu.down.sql.
BEGIN;

-- AlterEnum
ALTER TYPE "TypeAnomalie" ADD VALUE IF NOT EXISTS 'CREDIT_TROP_PERCU' AFTER 'THEORIQUE_DIVERGENT';

COMMIT;
