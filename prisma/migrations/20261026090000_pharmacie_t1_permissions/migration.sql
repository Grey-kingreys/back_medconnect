-- Tranche pharmacie 1, permissions (PB03, M1, D408) : catalogue puis rôles existants des pharmacies.
-- Écrit à la main. Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- Rejouable : ON CONFLICT DO NOTHING. Libellés identiques à PERMISSION_CATALOG.
BEGIN;

INSERT INTO "Permission" ("id", "code", "libelle", "categorie")
VALUES
  (gen_random_uuid()::text, 'caisse:utiliser', 'Encaisser les ventes au comptoir (ouvrir et fermer sa caisse)', 'Pharmacie'),
  (gen_random_uuid()::text, 'caisse:superviser', 'Superviser les caisses de tous les vendeurs', 'Pharmacie'),
  (gen_random_uuid()::text, 'cloture:gerer', 'Clôturer la journée de la pharmacie', 'Pharmacie'),
  (gen_random_uuid()::text, 'inventaire:write', 'Faire un inventaire du stock', 'Pharmacie'),
  (gen_random_uuid()::text, 'reception:write', 'Enregistrer une réception de marchandises', 'Pharmacie'),
  (gen_random_uuid()::text, 'marge:read', 'Voir les coûts d’achat et les marges', 'Pharmacie'),
  (gen_random_uuid()::text, 'anomalie:gerer', 'Traiter les anomalies de caisse et de stock', 'Pharmacie')
ON CONFLICT ("code") DO NOTHING;

-- Titulaire (« Administrateur de structure ») : les 7 ; vendeur (« Pharmacien ») : caisse:utiliser.
INSERT INTO "RolePermission" ("appRoleId", "permissionId")
SELECT r."id", p."id"
FROM "AppRole" r
JOIN "Structure" s ON s."id" = r."structureId" AND s."type" = 'PHARMACIE'
JOIN "Permission" p ON (
  (r."nom" = 'Administrateur de structure' AND p."code" IN ('caisse:utiliser', 'caisse:superviser', 'cloture:gerer', 'inventaire:write', 'reception:write', 'marge:read', 'anomalie:gerer'))
  OR (r."nom" = 'Pharmacien' AND p."code" = 'caisse:utiliser')
)
ON CONFLICT DO NOTHING;

COMMIT;
