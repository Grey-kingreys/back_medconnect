-- Retour arrière de 20261026090000_pharmacie_t1_permissions (PB03, M1, D467).
-- Retire les 7 permissions de TOUS les rôles (personnalisés et Super Administrateur compris),
-- puis du catalogue. À suivre du redéploiement du code précédent : sinon le démarrage les recrée.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DELETE FROM "RolePermission"
WHERE "permissionId" IN (
  SELECT "id" FROM "Permission"
  WHERE "code" IN ('caisse:utiliser', 'caisse:superviser', 'cloture:gerer', 'inventaire:write', 'reception:write', 'marge:read', 'anomalie:gerer')
);

DELETE FROM "Permission"
WHERE "code" IN ('caisse:utiliser', 'caisse:superviser', 'cloture:gerer', 'inventaire:write', 'reception:write', 'marge:read', 'anomalie:gerer');

COMMIT;
