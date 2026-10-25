# B5 : vérification (TB17, un numéro de téléphone par compte)

Date : 2026-10-21
Dépôt : `back_medconnect`, branche `orch/lot2-back` (aucun commit fait par le vérificateur)
Tâche : `docs/plans/runs/2026-10-20-lot2/tasks/B5-telephone-unique.md`

## Résultat des commandes « Done when » (relancées par le vérificateur)

1. `docker compose exec -T backend npx tsc --noEmit` : PASS, sortie vide, code 0.
2. `docker compose exec -T backend npx eslint <17 fichiers touchés>` : PASS, sortie vide, code 0.
3. `docker compose exec -T backend npx jest` : PASS, 43 suites sur 43, 509 tests passés, 3 ignorés (les quatre nouvelles suites téléphone passent, `auth.service.spec.ts` et `user.service.spec.ts` verts).
4. `docker compose exec -T backend npm run telephones:doublons` : PASS, `Résultat : 0 numéro(s) en double, 0 compte(s) concerné(s).` Empreinte relancée : `be03771e6183cfd26b3fcc57673f78fe`. Comparaison avant/après : NON VÉRIFIABLE, aucune empreinte d'avant migration n'est consignée.
5. `prisma migrate status` : PASS, « Database schema is up to date! ». `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` : FAIL, le script n'est pas vide (voir problème 1).
6. Requête base : PASS, `telephone IS NOT NULL AND telephoneNormalise IS NULL` = 0 ; `telephone IS NULL` = 3 ; `pg_indexes` renvoie `CREATE UNIQUE INDEX "User_telephoneNormalise_key" ... WHERE ("telephoneNormalise" IS NOT NULL)`.
7. Unicité en base dans `BEGIN ... ROLLBACK` : PASS, `ERROR: duplicate key value violates unique constraint "User_telephoneNormalise_key"`, `Key ("telephoneNormalise")=(+224622102031) already exists.`, puis ROLLBACK. Le numéro `+224622102031` existe bien en dev.
8. Fumée HTTP `POST /auth/register` : PASS. `00224 622-10-20-31` donne 409 `{"statusCode":409,"message":"Ce numéro est déjà utilisé par un autre compte.","code":"TELEPHONE_DEJA_UTILISE"}`. `12345` donne 400 `"code":"VALIDATION"` avec `"champs":[{"champ":"telephone",...}]` (rejet par le DTO). Compte `tb17-essai@example.test` : 0 ligne.
9. `npx tsc -p tsconfig.build.json --listFilesOnly | grep -c "scripts/telephones-doublons.ts"` : PASS, affiche `1`.
10. Couverture des écritures (grep) : PASS. Les trois lignes restantes sont `Structure.telephone` uniquement : `super-admin.service.ts:78` (createStructure), `structure.service.ts:247` (structureTelephone), `structure.service.ts:533` (updateStructure). Aucune écriture de `User`.
11. Tirets cadratin et demi-cadratin (diff ajouté et nouveaux fichiers, `LC_ALL=C.UTF-8 grep -nP`) : PASS, aucune ligne.

## Revue du diff

- Fichiers : 14 modifiés et 10 nouveaux (src/common/telephone/, scripts/telephones-doublons.ts, migration, demo.telephones.spec.ts), conformes à la liste fermée, sauf `docs/plans/ACTIVE.md` et `docs/plans/runs/2026-10-20-lot2/decisions.md` (voir problème 3).
- Aucune ligne de test supprimée (`git diff` des `*.spec.ts`, lignes `-` absentes). Aucun `.skip` ajouté.
- Secrets : seules les chaînes de test `MotDePasse-de-test-2` et `MotDePasse-de-test-3` dans les specs. Aucun `.env` lu.
- Aucune écriture applicative de `telephoneNormalise`. Pas de `prisma migrate dev` ni `db push`. `package-lock.json` non modifié.
- Migration : seulement le SQL prévu, aucun `UPDATE` de `telephone`.
- Hors sujet : aucun constat. Écart mineur de forme sans effet fonctionnel : `telephone.ts` construit la classe de séparateurs avec `String.fromCharCode` au lieu du littéral `  ` de la spec.

## Verdict

FAIL (critère « Done when » 5 non atteint, pour une cause hors B5). Les points 1, 2, 3, 6, 7, 8, 9, 10 et 11 passent. Le point 4 passe sur la dernière ligne mais ne peut pas être confirmé sur l'empreinte avant/après.

## Problèmes (actionnables)

1. **Done when 5 : `migrate diff` non vide, dérive préexistante sur `AuditLog`.** Le script propose de supprimer la clé étrangère `AuditLog_userId_fkey`, de supprimer les index `AuditLog_createdAt_idx`, `AuditLog_entityType_entityId_idx` et `AuditLog_userId_idx`, puis de recréer la clé étrangère. Le diff de `schema.prisma` par rapport à HEAD ne touche pas `AuditLog` (il ajoute seulement `previewFeatures`, `telephoneNormalise` et l'`@@unique` partiel), donc la dérive ne vient pas de B5. Le tableau d'index est créé par la migration `20260704_add_soft_delete_audit_trail`. Décision à prendre par l'orchestrateur : tâche séparée de réalignement `AuditLog`, ou écart accepté pour B5. Ne pas corriger dans B5.
2. **Done when 4 : empreinte d'avant migration absente.** Aucune valeur d'avant n'est consignée, donc la preuve « migration sans changement de `telephone` » n'est pas démontrable. La migration ne contient aucun `UPDATE` de `telephone`, ce qui est vérifiable par lecture. Le codeur doit fournir l'empreinte relevée avant migration si elle existe, ou l'orchestrateur acte l'écart.
3. **Fichiers `docs/plans/` dans le diff.** `docs/plans/ACTIVE.md` (ligne B5) et `docs/plans/runs/2026-10-20-lot2/decisions.md` (D40 à D51) sont modifiés. La tâche interdit de toucher `docs/plans/`. Probablement écrits par l'orchestrateur (fichiers de run), à confirmer, sinon les retirer du diff de B5.
4. **Écart mineur au texte « exact » de la migration.** Dans `prisma/migrations/20261021120000_tb17_telephone_unique/migration.sql`, la classe `[ \t<U+00A0><U+202F>.-]` contient les caractères insécables bruts en UTF-8 (octets `C2 A0` et `E2 80 AF`), et non les séquences d'échappement `  ` de la spec. Le comportement est correct (la migration a bien produit un index sans écart sur les 20 numéros), mais le texte ne correspond pas à la spec. Aligner ou accepter l'écart.
5. **Information, pas un échec.** Un numéro invalide de 5 à 7 caractères (ex. `12345`) est refusé par le DTO `@Length(8, 20)` avant `exigerTelephone` : la réponse porte le message générique du DTO (« Certaines informations saisies sont manquantes ou invalides... »), pas `MESSAGE_TELEPHONE_INVALIDE`. Conforme à D44 et au Done when 8 (code et champ). Le message non-dev du spec ne s'affiche que pour une saisie de 8 à 20 caractères invalide. Un contrôle `+33612345678` renvoie bien le message exact avec `contraintes: ["formatTelephone"]`, donc le chemin `exigerTelephone` fonctionne.

Aucune commande n'a modifié la base hors transaction annulée (ROLLBACK) et la requête `register` refusée (409 et 400, aucun compte créé). Aucun commit.
