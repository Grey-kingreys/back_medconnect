-- Retour arrière de 20261104100000_pharmacie_t1_pharmacien_reception (D732).
-- Retire reception:write des rôles « Pharmacien » des pharmacies. Un titulaire qui l'avait donné lui-même
-- à son rôle Pharmacien avant la migration le perd aussi (les deux cas sont indiscernables). Aucune autre donnée n'est modifiée.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DELETE FROM "RolePermission" rp
USING "AppRole" r, "Structure" s, "Permission" p
WHERE rp."appRoleId" = r."id"
  AND rp."permissionId" = p."id"
  AND p."code" = 'reception:write'
  AND r."nom" = 'Pharmacien'
  AND s."id" = r."structureId"
  AND s."type" = 'PHARMACIE';

COMMIT;
