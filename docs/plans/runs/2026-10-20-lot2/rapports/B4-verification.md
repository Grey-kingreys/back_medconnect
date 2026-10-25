# Vérification B4 : version minimale, GET /app/version, GET /app/config, numéro d'urgence centralisé

Date : 2026-10-21
Vérificateur : Haiku 5.5 (relance des commandes du « Done when » par le vérificateur, aucun commit)
Dépôt : `back_medconnect`, branche `orch/lot2-back`

## Commandes et résultats

1. `docker compose exec -T backend npx tsc --noEmit` : sortie vide, code 0. OK
2. `docker compose exec -T backend npx eslint` sur les 17 fichiers touchés : code 0, aucune erreur. OK
3. `docker compose exec -T backend npx jest` : 39 suites vertes, 456 tests passés, 3 ignorés (déjà présents avant la tâche). `src/configuration-publique` relancé seul : 2 suites, 25 tests verts. OK
4. `docker compose config --quiet` : code 0. Compteurs `grep -c` : `compose.yml` 3, `.env.example` 3, `back_medconnect/.env.example` 3. OK
5. Contrôle de fumée sur le backend (port 3001) : `/app/version` 200, `cache-control: public, max-age=60`, corps aux défauts 0.0.0 et `urlTelechargement: null` ; `/app/config` 200, `cache-control: public, max-age=300`, `numerosUrgence` = `15`, `cgu` et `politiqueConfidentialite` = `1.0`, fonctions à `false`. Aucune variable TB5 réglée dans le conteneur. OK
6. Contrôle des tirets cadratin et demi-cadratin : aucune ligne ajoutée dans `git diff` ni dans les fichiers nouveaux (`src/configuration-publique/*.ts`, `src/config/numeros-urgence.ts`, `back_medconnect/.env.example`). OK
7. `grep -n '15 ou les secours' src/common/services/ai.service.ts` : aucune ligne (le « 15 » en dur a disparu). OK

## Contrôles complémentaires

- Relecture des fichiers nouveaux (garde, service, versions, contrôleur, numéros d'urgence, constantes, module) : conformes à la spec (algorithme D31 dans l'ordre, défauts tolérants, `@SkipThrottle`, catalogue `VERSION_OBSOLETE`, libellé 426, sept cas HTTP de la spec couverts par les 12 `it`).
- `src/app.module.spec.ts` : la ligne `providers` a été réécrite en `as Array<...>` (même type, sans changement de comportement). C'est la correction exigée par ESLint, et le reste du fichier n'a pas bougé.
- Racine : `.env.example` et `compose.yml` contiennent les 12 variables. Le bloc `SESSIONS_MULTI_APPAREILS` apparaît aussi dans le diff racine : modification non commitée antérieure, hors B4, non retirée.
- `docs/plans/ACTIVE.md` est modifié dans l'arbre de travail : mise à jour de l'index par l'orchestrateur, hors liste fermée de la tâche. Pas une modification du codeur, à ne pas inclure dans le commit B4 si l'orchestrateur le sépare.
- Aucun fichier `.env` réel lu ni modifié. `package.json` et `package-lock.json` inchangés.
- Les WARN Redis dans les logs de Jest sont attendus (tests sans Redis).

## Verdict

VALIDE. Les 7 points du « Done when » passent à la relance. Aucun problème bloquant.

## Problèmes actionnables

Aucun bloquant.

1. Non bloquant : `docs/plans/ACTIVE.md` est modifié hors liste fermée (fait par l'orchestrateur, à vérifier au moment du commit).
2. Non bloquant : `src/app.module.spec.ts` a une ligne existante réécrite (typage seul) pour satisfaire ESLint.
