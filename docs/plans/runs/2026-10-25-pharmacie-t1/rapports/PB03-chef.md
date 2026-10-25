# PB03 : validation du chef

Branche orch/pharmacie-t1-back. Verdict : validé.

## Ce qui a été fait
- Relecture complète du diff (16 fichiers de code et de test, 2 SQL, CLAUDE.md) : conforme à la fiche.
- Permissions : 7 codes T1 dans `PERMISSIONS`, catalogue (catégorie Pharmacie, juste après `vente:annuler`), liste blanche et réserve pharmacie, rôles par défaut (Pharmacien 9, Administrateur 17), `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` à 12. HOPITAL, CLINIQUE, rôles système et non délégables intouchés.
- M1 et retour arrière identiques à la fiche à l'octet près : `BEGIN;`/`COMMIT;`, rejouable (`ON CONFLICT DO NOTHING`), liaison limitée aux rôles des structures PHARMACIE.
- `AccesPharmacieService` : sélections exactes, ordre 404 puis 403 générique puis 403 désactivée (un non-membre n'apprend pas la désactivation), enum `role` non lu. Les deux anciens contrôles sont supprimés, imports inutiles retirés, 7 + 4 appels recâblés.
- Contrôle de sécurité ajouté par le chef : toutes les routes de stock de `pharmacie.controller.ts` portent `AuthGuard` + `PermissionsGuard` + `@RequirePermissions(stock:read, stock:write)`, et les ventes leurs `vente:*`. L'abandon de l'enum `role` n'ouvre donc l'accès qu'aux membres porteurs de la permission (effet voulu du plan, section 3).
- Injection : `PharmacieService` et `VenteService` ne sont fournis que par `PharmacieModule`, qui fournit aussi `AccesPharmacieService` (`app.module.spec.ts` vert).
- `masquerCouts` / `cheminsCout` : copie sans mutation, même référence avec `marge:read`, objets simples seulement, motif `/cout|marge/i` sans drapeau `g`. Non branché (prévu PB16).

## Preuves (relancées par le chef)
- `docker compose exec -T backend npx tsc --noEmit` : exit 0.
- `npx eslint` sur les 16 fichiers .ts touchés : exit 0, aucun avertissement.
- `npm test` : 64 suites, 740 réussis, 3 ignorés (715 + 25).
- `npm run test:db` : 3 suites, 26 tests verts (harnais 11, PB02 9, M1 6).
- `git status --short test/db/instantanes` : vide. Bases `mc_test_%` restantes : 0.
- `grep checkPharmacieAccess|verifierPharmacie` sur src et test : rien. Tirets cadratin et demi-cadratin (`LC_ALL=C.UTF-8 grep -P`) : rien.

## Décisions prises
- Aucune nouvelle décision ; D464 à D468 appliquées telles quelles.
- ACTIVE.md : statut de PB02 corrigé (validé, commit 2004c97, la ligne était restée « à faire ») et PB03 passé à validé.

## Réserves
- D467 : cache `perms:v3` non versionné, les nouvelles permissions apparaissent au plus 5 min après déploiement (aucune route ne les exige en J1).
- D465 : l'éditeur de rôles (`listCatalog`, non filtré par type) montre les 7 permissions à un administrateur d'hôpital, comme `vente:*` aujourd'hui ; elles y restent inopérantes. Hors tranche.
- Changement visible voulu : un administrateur de pharmacie (`adminId`) non membre par `structureId` accède désormais au stock ; une structure non PHARMACIE sur les routes de stock renvoie 403 au lieu de 400 (D464). Le front qui afficherait l'ancien message 400 ou « Vous n'êtes pas autorisé à gérer cette pharmacie » est à vérifier dans les tâches front.
