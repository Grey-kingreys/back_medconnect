# B2 - Vérification : limiteur de débit Redis, SOS permissif

Date : 2026-10-20
Branche : orch/lot1-back (arbre principal, rien commité)
Tâche : docs/plans/runs/2026-10-20-lot1/tasks/B2-limiteur-redis.md

## Commandes relancées par le vérificateur

Toutes lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (conteneurs backend, redis, postgres en cours d'exécution).

1. `docker compose exec -T backend npx tsc --noEmit` : exit 0, aucune erreur.
2. `docker compose exec -T backend npx eslint <10 fichiers touchés>` : exit 0, 0 erreur. 15 avertissements, tous dans `src/auth/auth.controller.ts` (`no-unsafe-argument`) sur des lignes absentes du diff de B2 (préexistants). Les 9 autres fichiers : 0 avertissement.
3. `docker compose exec -T backend npx jest` : exit 0. 35 suites passent, 396 tests passent, 3 sautés (le bloc Redis réel, sans `TEST_REDIS_URL`). Suites 8b (`user-throttler.guard.spec.ts`) et 8c (`carnet-sante.urgence.spec.ts`, describe ajouté) vertes.
4. `docker compose exec -T -e TEST_REDIS_URL=redis://redis:6379 backend npx jest src/common/redis/stockage-limite-redis.spec.ts --verbose` : exit 0. 8 tests sur 8 passent, 0 sauté, dont les 3 tests contre le vrai Redis (compte puis bloque, clés indépendantes, repart de zéro après blocage).
5. `git status --porcelain` hors `docs/plans/` : 11 fichiers, soit les 10 fichiers de « Done when » plus `CLAUDE.md`. Conforme. Les modifications de `docs/plans/` (ACTIVE.md, decisions.md, rapports/B1-chef.md) sont exclues du périmètre.
6. Recherche de tirets cadratin (U+2014) et demi-cadratin (U+2013) :
   - lignes ajoutées par B2 (diff + fichiers non suivis) : 0 occurrence. Conforme.
   - fichiers entiers : occurrences préexistantes, identiques au HEAD (`app.module.ts` 1, `carnet-sante.controller.ts` 1, `carnet-sante.service.ts` 2, `CLAUDE.md` 8). Le critère « aucune occurrence » tel qu'écrit ne peut pas être atteint sans toucher des lignes hors tâche (voir problème 2).

## Revue du diff

- Décorateur, garde (`getTracker` avec vérification du jeton, `generateKey` préfixé `permissif:`, `suivreParIp`), stockage Redis (script Lua reproduit, délai 250 ms, repli permissif ou mémoire, avertissement limité à 1 par minute), `app.module.ts` (`forRootAsync` avec `StockageLimiteRedis`), `carnet-sante.controller.ts` (décorateur ajouté, limite inchangée), `carnet-sante.service.ts` (`DELAI_FILE_SOS_MS`, `enfilerSansBloquer` sur email et SMS, charges utiles inchangées), `CLAUDE.md` (puce ajoutée après « Sessions (TB3) ») : conformes à la spec.
- Aucun test existant supprimé ni affaibli (aucune ligne `it(`/`describe(` retirée du diff).
- Aucun secret ajouté. Le logger de `enfilerSansBloquer` ne journalise ni le numéro ni l'email du proche (testé dans `carnet-sante.urgence.spec.ts`).
- Aucune dépendance, migration ou variable d'environnement nouvelle.

## Verdict

PASS. Tous les critères vérifiables passent (tsc, eslint sur les fichiers touchés, jest complet, jest Redis réel sans saut, périmètre git, tirets dans les lignes ajoutées).

## Problèmes

1. (mineur, actionnable) `src/auth/auth.controller.ts` : l'import `suivreParIp` est placé au milieu du fichier, après `JetonRenouvellementDto` et avant la constante `AUTH_THROTTLE`, et les imports `AuthGuard`, `RegisterDto`, `LoginDto` suivent cette constante. Le déplacer avec les autres imports en tête de fichier. Pas bloquant (compile et lint propres).
2. (spec, non bloquant) Le critère 6 de « Done when » est littéralement inatteignable : 12 tirets préexistants figurent dans des lignes non touchées (`app.module.ts`, `carnet-sante.controller.ts`, `carnet-sante.service.ts`, `CLAUDE.md`). Le critère utile est « aucun tiret dans les lignes ajoutées », qui est satisfait. À reformuler dans la spec.
3. (info) `auth.controller.ts` garde 15 avertissements eslint `no-unsafe-argument` préexistants, hors périmètre de B2.
