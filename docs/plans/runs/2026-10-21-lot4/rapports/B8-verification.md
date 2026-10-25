# B8 - Vérification (Redis rediss:// et échec d'email)

Date : 2026-10-21
Branche : orch/lot4-back (non committé)
Tâche : docs/plans/runs/2026-10-21-lot4/tasks/B8-redis-tls-echec-email.md

## Commandes relancées par le vérificateur

- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur (code 0).
- `docker compose exec -T backend npx eslint <14 fichiers touchés>` : 0 erreur (code 0, aucune sortie).
- `docker compose exec -T backend npx jest` : 51 suites passent sur 51, 573 tests passent, 3 ignorés (code 0). Les 3 tests ignorés sont préexistants (`stockage-limite-redis.spec.ts`, gardés par `TEST_REDIS_URL`).
- `git status --porcelain -- . ':!docs/plans'` : exactement les 14 fichiers autorisés (9 modifiés, 5 nouveaux).
- Contrôle des tirets cadratin et demi-cadratin sur les lignes ajoutées (suivis et non suivis) : aucune occurrence.
- `grep redisConnection src/queue/queue.module.ts` : aucune occurrence.
- `grep EMAIL_INDISPONIBLE` : une occurrence dans `codes-erreur.ts` (l.30) et une dans `super-admin.service.ts` (l.197).
- Contrôle des `it.skip`, `.only`, `eslint-disable` ajoutés : aucun. Aucune ligne de test supprimée.

## Revue du diff

- Partie 1 : `options-redis.ts` conforme à la spec (host, port, identifiants décodés, db, tls pour rediss). `queue.module.ts` utilise la nouvelle fonction, l'ancienne est supprimée. `redis.module.ts` et `redis-io.adapter.ts` non modifiés.
- Partie 2 : filtre 503 avec code catalogue, sans code la 503 reste en 500 générique. `createStructure`, `resendInvitation` (restauration du jeton, erreur 503 `EMAIL_INDISPONIBLE`), `createMembre`, `sendMemberWelcomeEmail` (booléen) et `forgotPassword` conformes à la spec. Aucune adresse email dans les nouveaux journaux. `super-admin.controller.ts` non modifié.
- Pas de périmètre hors sujet. `docs/plans/ACTIVE.md` et `docs/plans/runs/` sont modifiés par le chef, hors contrôle du codeur, et exclus du périmètre comme prévu.

## Verdict

PASS. Tous les critères « Done when » sont satisfaits.

## Problèmes

Aucun problème bloquant.

Observations non bloquantes :
- Jest signale « A worker process has failed to exit gracefully ». Cet avertissement n'est lié à aucun fichier de la tâche (à vérifier séparément, hors B8).
- Les logs de test affichent un `ERROR DemoSeeder ... base indisponible` pendant un test existant (comportement attendu du test, pas un échec).
