-- Tranche pharmacie 2, réception hors ligne : type d'anomalie RECEPTION_COEFFICIENT_DIFFERENT.
-- Migration additive : une valeur ajoutée à l'enum TypeAnomalie, après SEQUENCE_MANQUANTE. Aucune anomalie existante ne change.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- La valeur n'est utilisée par aucune instruction de cette transaction.
-- Retour arrière : prisma/retours-arriere/20261115100000_pharmacie_t2_anomalie_reception_coefficient.down.sql.
BEGIN;

-- AlterEnum
ALTER TYPE "TypeAnomalie" ADD VALUE IF NOT EXISTS 'RECEPTION_COEFFICIENT_DIFFERENT' AFTER 'SEQUENCE_MANQUANTE';

COMMIT;
