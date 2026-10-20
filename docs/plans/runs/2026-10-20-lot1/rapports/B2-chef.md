# B2 - Rapport du chef d'équipe back : limiteur de débit Redis, SOS permissif

Date : 2026-10-20
Branche : orch/lot1-back
Verdict : validé (commit de la tâche B2, hash indiqué dans le retour à l'orchestrateur et via `git log -1`)

## Ce qui a été fait

- `UserThrottlerGuard` compte par utilisateur en vérifiant lui-même la signature du jeton Bearer (la garde globale passe avant l'AuthGuard), sinon par IP ; `suivreParIp` exporté et forcé sur les routes d'auth (register, login, forgot-password, reset-password).
- Nouveau stockage `StockageLimiteRedis` (script Lua atomique, délai 250 ms) : Redis absent ou lent, les routes `@LimitePermissiveSiRedisIndisponible()` (SOS seulement) passent, les autres sont comptées en mémoire locale ; avertissement au plus une fois par minute.
- `app.module.ts` : `ThrottlerModule.forRootAsync` avec le client Redis partagé.
- SOS : email et SMS au proche mis en file avec un délai borné à 2 s (`enfilerSansBloquer`), l'alerte réussit même si la file est en panne ; le log ne contient ni téléphone ni email du proche.
- Tests : `stockage-limite-redis.spec.ts` (5 unitaires + 3 contre un vrai Redis), `user-throttler.guard.spec.ts` (6), describe ajouté dans `carnet-sante.urgence.spec.ts` (2). `CLAUDE.md` du dépôt mis à jour.

## Preuves (relancées par le chef)

- `docker compose exec -T backend npx tsc --noEmit` : exit 0.
- `docker compose exec -T backend npx eslint <10 fichiers>` : 0 erreur, 15 avertissements préexistants dans `auth.controller.ts` (lignes hors diff).
- `docker compose exec -T backend npx jest` : 35 suites, 396 passés, 3 sautés (bloc Redis réel sans `TEST_REDIS_URL`).
- `docker compose exec -T -e TEST_REDIS_URL=redis://redis:6379 backend npx jest src/common/redis/stockage-limite-redis.spec.ts` : 8/8, 0 sauté.
- Tirets cadratin et demi-cadratin dans les lignes ajoutées : 0.

## Décisions prises

1. Correction faite par le chef (problème 1 du vérificateur) : l'import `suivreParIp` et les imports qui suivaient la constante `AUTH_THROTTLE` ont été regroupés en tête de `auth.controller.ts`, la constante placée après les imports. Changement purement d'ordre, tsc, eslint et jest relancés après.
2. Critère 6 de « Done when » interprété comme « aucun tiret dans les lignes ajoutées » : les 12 tirets restants sont préexistants sur des lignes non touchées ; les corriger sortirait du périmètre. À reformuler dans les futures specs.
3. Les modifications préexistantes de `docs/plans/` (ACTIVE.md, decisions.md, B1-chef.md) sont incluses dans le commit, comme demandé (dossier du run + ACTIVE.md).

## Réserves

- La vérification du jeton dans la garde ne contrôle pas la révocation (voulu par la spec) : un jeton révoqué mais non expiré reste compté sur son utilisateur pendant au plus 15 min. Sans effet sur la sécurité (l'AuthGuard refuse ensuite la requête), seulement sur le compteur.
- Le coût d'un `verifyAsync` par requête authentifiée est ajouté (HMAC, négligeable).
- Pas de test e2e HTTP du 429 : couvert par les tests de la garde avec les vraies métadonnées des contrôleurs.
- Aucune régression web ou mobile attendue : contrats d'API et message du 429 inchangés ; le mobile (refresh dans le corps, `X-Client: mobile`) passe par les mêmes routes d'auth comptées par IP.
