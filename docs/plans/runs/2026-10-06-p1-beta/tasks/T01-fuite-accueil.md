# T01 - Point 8 : ne plus exposer le dossier médical à l'accueil

Tier: spécifié (agent implementeur-specifie)
Audience: dev (forme de la réponse JSON) ; aucun texte visible ajouté
Visuel: n/a
Background-safe: oui

## Spec

Constat (vérifié) : `GET /users/patients/my` (`src/user/user.controller.ts:63-68`, permission `PATIENT_READ`) appelle `UserService.getPatientsForDoctor(structureId)` (`src/user/user.service.ts:312` et suivantes). Les deux requêtes Prisma (consultations et autorisations) sélectionnent `profilMedical: { groupeSanguin, allergies }`. Conséquences :
- le rôle Accueil (et l'administrateur de structure), qui ont `PATIENT_READ` mais **pas** `CARNET_READ` (`src/common/rbac/permissions.constants.ts`), reçoivent le groupe sanguin en clair ;
- `allergies` est stocké chiffré (`carnet-sante.service.ts:232`) et remonte chiffré, jamais déchiffré.

À faire :
1. Dans le contrôleur, déterminer si l'appelant possède la permission `PERMISSIONS.CARNET_READ`, en réutilisant `PermissionsService.hasPermissions(userId, [code])` (`src/common/rbac/permissions.service.ts`, déjà utilisé par `PermissionsGuard`). Vérifier que `UserModule` peut l'injecter (RbacModule global ou import) ; sinon l'importer, sans autre changement.
2. Passer ce booléen à `getPatientsForDoctor(structureId, peutVoirCarnet)`.
3. Sans `CARNET_READ` : ne **pas** sélectionner `profilMedical` du tout dans les deux requêtes (aucune donnée médicale dans la réponse, pas même chiffrée).
4. Avec `CARNET_READ` : garder `profilMedical`, mais renvoyer `allergies` déchiffré via `this.encryptionService.decrypt(...)` (déjà injecté dans `UserService`), pour les patients issus des consultations comme des autorisations.
5. Ne rien changer d'autre (ni le reste de la forme de réponse, ni les autres méthodes).
6. Ajouter un test unitaire `src/user/user.service.spec.ts` (ou compléter s'il existe) avec Prisma et EncryptionService simulés : sans carnet, aucun `profilMedical` dans les éléments renvoyés ; avec carnet, `allergies` déchiffré. S'inspirer de la forme de `src/carnet-sante/carnet-sante.service.spec.ts`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (commentaires en français, aucun tiret cadratin ni demi-cadratin). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Ne pas commiter : l'orchestrateur commite.

## Done when

- `npx --no-install tsc --noEmit` : 0 erreur.
- `npx --no-install eslint <fichiers touchés>` : 0 erreur, en appliquant la procédure D07 de `docs/plans/runs/2026-10-06-p1-beta/decisions.md` (dette préexistante : `user.service.ts` environ 60 erreurs, `user.controller.ts` environ 26).
- `npm test` : tout vert, le nouveau test inclus.
- Grep : `getPatientsForDoctor` ne sélectionne plus `profilMedical` quand l'appelant n'a pas `CARNET_READ`.

## Return

Liste des fichiers modifiés + preuve (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
