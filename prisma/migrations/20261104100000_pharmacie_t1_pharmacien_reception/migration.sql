-- Tranche pharmacie 1, réception pour le rôle « Pharmacien » (D732, révise D704 pour la réception).
-- Écrit à la main, sans changement de schéma. Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- Ajoute reception:write aux seuls rôles de nom « Pharmacien » des structures de type PHARMACIE. Les rôles
-- personnalisés (autre nom) et les rôles des hôpitaux et cliniques ne sont pas touchés. inventaire:write reste au titulaire (D598).
-- Appliquée une seule fois par Prisma ; ON CONFLICT DO NOTHING évite tout doublon si un rôle a déjà le droit.
BEGIN;

INSERT INTO "RolePermission" ("appRoleId", "permissionId")
SELECT r."id", p."id"
FROM "AppRole" r
JOIN "Structure" s ON s."id" = r."structureId" AND s."type" = 'PHARMACIE'
JOIN "Permission" p ON p."code" = 'reception:write'
WHERE r."nom" = 'Pharmacien'
ON CONFLICT DO NOTHING;

COMMIT;
