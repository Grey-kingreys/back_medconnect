-- Retour arrière de 20261026100000_pharmacie_t1_points_de_vente (PB05, M2).
-- Supprime les tables et les types de M2 (pertes : postes enregistrés, paramètres modifiés,
-- fournisseurs et anomalies). PostgreSQL le refuse tant qu'une migration suivante y fait
-- référence : défaire d'abord les suivantes, dans l'ordre inverse. À suivre du redéploiement
-- du code précédent. Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DROP TABLE "Anomalie";
DROP TABLE "PlageTicket";
DROP TABLE "CompteurTicket";
DROP TABLE "Poste";
DROP TABLE "PointDeVente";
DROP TABLE "ParametresPharmacie";
DROP TABLE "Fournisseur";
DROP TABLE "CoupureMonnaie";
DROP TABLE "ModePaiement";

DROP TYPE "StatutAnomalie";
DROP TYPE "TypeAnomalie";
DROP TYPE "TypeCoupure";
DROP TYPE "TypePoste";

COMMIT;
