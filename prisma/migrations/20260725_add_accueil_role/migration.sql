-- Ajout du rôle ACCUEIL (front desk d'une structure) à l'enum Role.
-- On ne fait qu'ajouter la valeur (aucune donnée ne l'utilise dans cette migration),
-- donc l'ADD VALUE est compatible avec l'exécution de `prisma migrate deploy`.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCUEIL';
