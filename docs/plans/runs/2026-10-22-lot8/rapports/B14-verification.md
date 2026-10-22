# B14 : rapport de vérification

Date : 2026-10-22
Vérificateur : Haiku 5.5
Dépôt : back_medconnect, branche orch/lot8-back (arbre principal, rien commité)
Fiche : docs/plans/runs/2026-10-22-lot8/tasks/B14-admin-pharmacie-stock-demo-recu.md

## Commandes (relancées par le vérificateur)

- `docker compose exec -T backend npx tsc --noEmit` : sortie 0.
- `docker compose exec -T backend npx eslint` sur les 8 fichiers du Done when : sortie 0, 0 erreur, 0 avertissement.
- `docker compose exec -T backend npx jest` : 62 suites sur 62 passées, 711 tests passés, 3 ignorés (déjà ignorés avant la tâche), 0 échec.
- Jest ciblé, verbeux : `roles.service.spec.ts` 6/6 verts (cas 1 à 6), `demo.vitrine.spec.ts` 3/3 verts, `demo.controller.spec.ts` vert (test renommé, ordre 7 puis 8), `vente.service.spec.ts` vert avec les 2 cas « reçu » (détail et annulation, reçu sans logo).
- Tirets : aucune ligne ajoutée du diff ni du fichier `roles.service.spec.ts` ne contient de tiret cadratin ou demi-cadratin (fichiers non suivis compris).
- `git diff --stat` : 9 fichiers modifiés (CLAUDE.md, permissions.constants.ts, roles.service.ts, demo.controller.spec.ts, demo.donnees.ts, demo.vitrine.spec.ts, vente.controller.ts, vente.service.spec.ts, docs/plans/ACTIVE.md) et 1 fichier créé (roles.service.spec.ts). Aucun fichier sous `prisma/` modifié, aucune migration.
- `grep B14 CLAUDE.md` : la puce « Ventes en pharmacie (B13, lot 7 ; B14, lot 8) » contient `STOCK_INTROUVABLE`, `arrayMaxSize`, `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` et `logoUrl`. `grep "Pharmacie de Kaloum" CLAUDE.md` : la phrase du mode démo est présente (ligne 142).
- Contrôle croisé de la doc : noms de contraintes (`arrayMinSize`, `arrayMaxSize`, `isString`, `isNotEmpty`, `isInt`, `min`, `max`, `maxLength`, `isBoolean`, `length`, `matches`) et messages de succès (création, rejeu, détail, liste, annulation et variante) relus dans `vente.dto.ts` et `vente.service.ts` : conformes.
- Démarrage du conteneur : journal « Rôles d'administrateur de pharmacie complétés : 4 permission(s) ajoutée(s) sur 2 rôle(s). » présent ; « Nest application successfully started » présent.

## Appel réel (localhost:3101, étapes 1 à 8)

1. `GET /auth/demo/comptes` : 200 ; `admin.kaloum@demo.medconnecte.gn`, structureNom « Pharmacie de Kaloum », description conforme à la fiche ; id 9224afd8-ccb1-487e-8798-0c15f3f14a54.
2. `POST /auth/demo/connexion` : 200 ; jeton d'accès présent dans `data.access_token` (valeur non reproduite).
3. `GET /auth/me` : 200 ; `structureType` PHARMACIE ; `stock:read`, `stock:write`, `vente:read`, `vente:write`, `vente:annuler` présents ; structure 4adb3b70-eed7-49f2-b483-4efa942bad78 (Pharmacie de Kaloum).
4. `GET /pharmacie/stock/4adb3b70-...` : 200 ; 8 lignes de stock ; ligne choisie Doliprane 1000mg, quantité initiale 240, prix 15000.
5. `POST /pharmacie/4adb3b70-.../ventes` (Idempotency-Key neuve) : 201 ; numero V-2026-000009 ; total 15000 ; `pharmacie` avec les 6 clés ; `logoUrl` null.
6. `GET /pharmacie/4adb3b70-.../ventes/<venteId>` : 200 ; `data.pharmacie` identique à l'étape 5.
7. `POST .../annuler` `{ motif: "Test de recette B14" }` : 200 ; statut ANNULEE ; stock 240 avant, 240 après annulation (quantité remise).
8. Contre-épreuve : connexion `admin.donka` : 200 ; `/auth/me` structureType HOPITAL, aucune permission `stock:*` ni `vente:*` ; `GET /pharmacie/stock/<Kaloum>` : 403 PERMISSION_REFUSEE.

Note : la vente V-2026-000009 créée par ce test reste en base de développement, à l'état ANNULEE.

## Revue du diff

- Périmètre respecté : pas de changement sur le rôle Pharmacien, sur les rôles HOPITAL/CLINIQUE, sur `permissions-type-structure.ts`, `permissions.service.ts` ou les migrations.
- `roles.service.ts` : le diff de 171 lignes comporte beaucoup de reformatage prettier, issu de `eslint --fix` (autorisé par la section 2.5). La logique ajoutée correspond à la fiche : `completerRolesAdminPharmacie` (ajout seul, skipDuplicates, invalidation seulement si count > 0, journal seulement si total > 0), appel dans `onApplicationBootstrap` après `seedExistingStructures` et avant `backfillUsers`, catch `unknown` avec `P2002` vérifié par cast.
- `vente.controller.ts` : seuls deux `@ApiResponse` ajoutés, aucun changement de logique.
- `demo.donnees.ts` : compte `admin.kaloum` ajouté après `admin.donka`, description exacte, commentaire de `COMPTES_VITRINE` mis à jour.

## Verdict

PASS, sous réserve d'un point à confirmer.

## Problèmes

1. (À confirmer, non bloquant) `docs/plans/ACTIVE.md` apparaît modifié dans `git diff --stat`. Le Done when 5 n'autorise que les fichiers du point 2 et `CLAUDE.md`, et la fiche interdit de modifier `docs/plans/`. Le contenu (index du run lot8, ligne B14 « à faire ») ressemble à la mise à jour du chef d'équipe et non à celle du codeur. À confirmer avant le commit : si le codeur l'a touché, le revenir à son état d'origine ; sinon le laisser hors du staging ciblé de B14.
2. Rien d'autre à corriger. Aucun test supprimé ou affaibli : le test `demo.vitrine.spec.ts` remplacé couvre désormais les deux administrateurs, et le test `demo.controller.spec.ts` a été étendu (titre renommé comme demandé).
