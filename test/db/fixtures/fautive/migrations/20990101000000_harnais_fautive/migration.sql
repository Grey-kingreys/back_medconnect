-- Migration volontairement fautive (harnais PB01) : la seconde insertion viole la clé primaire.
-- Constat D451 : Prisma n'enveloppe PAS un fichier de migration dans une transaction,
-- donc ce fichier porte BEGIN/COMMIT explicites, comme toute migration de la tranche (D432).
-- Appliquée sur une base jetable, elle ne doit rien laisser.
BEGIN;
CREATE TABLE "HarnaisTemoinFautif" ("id" INTEGER PRIMARY KEY);
INSERT INTO "HarnaisTemoinFautif" ("id") VALUES (1);
INSERT INTO "HarnaisTemoinFautif" ("id") VALUES (1);
COMMIT;
