# Chef d'équipe back : B4 (TB5 version minimale, /app/version, /app/config, numéro d'urgence)

Date : 2026-10-21. Branche `orch/lot2-back`. Verdict : validé.

## Ce qui a été fait

- Relecture complète du diff (9 fichiers modifiés, 10 nouveaux) contre la spec `tasks/B4-version-configuration-publique.md` : conforme point par point (catalogue `VERSION_OBSOLETE`, libellé 426, source unique du numéro d'urgence, garde D31 dans l'ordre, service, contrôleur `@SkipThrottle`, module, câblage avant `UserThrottlerGuard`, 12 règles `validateEnv`, CLAUDE.md, `.env.example` back).
- Relance des commandes clés depuis la racine du monorepo.

## Preuves (une ligne chacune)

- `docker compose exec -T backend npx tsc --noEmit` : code 0, sortie vide.
- `docker compose exec -T backend npx eslint <17 fichiers de la tâche>` : code 0.
- `docker compose exec -T backend npx jest` : 39 suites vertes, 456 passés, 3 ignorés (préexistants).
- `docker compose config --quiet` : code 0 ; diff racine `.env.example` et `compose.yml` = ajout des 12 variables seulement (plus le bloc `SESSIONS_MULTI_APPAREILS` antérieur).
- Fumée : `/app/version` 200 `public, max-age=60`, `/app/config` 200 `public, max-age=300`, corps aux défauts ; `/auth/me` en mobile android 0.0.1 avec minimale par défaut : 401 (pas 426, la garde laisse passer).
- Tirets cadratin et demi-cadratin : aucune ligne ; `15 ou les secours` absent de `ai.service.ts`.

## Décisions prises

- Écarts mineurs acceptés : `426` littéral au lieu de `HttpStatus.UPGRADE_REQUIRED` dans la garde (même valeur) ; réécriture typée (`as Array<...>`) de la ligne `providers` dans `app.module.spec.ts`, exigée par ESLint, sans effet de comportement.
- Commit limité aux fichiers de la tâche + `docs/plans/runs/2026-10-20-lot2/` + `docs/plans/ACTIVE.md`. Les fichiers du dépôt racine (`.env.example`, `compose.yml`) ne sont pas commités ici (dépôt distinct, l'orchestrateur principal les reprend).

## Réserves

- Q04 ouverte (numéros d'urgence de Guinée) : seul « 15 » est servi par défaut, déjà parquée dans ACTIVE.md.
- Sécurité : routes publiques sans donnée sensible (`toEqual` strict dans le test) ; la garde ne lit que des en-têtes, aucun accès base ni Redis. Un client mobile qui ment sur sa version contourne la garde : c'est voulu (garde de compatibilité, pas de sécurité).
- Aucune régression web : la garde exige `X-Client: mobile`, le front n'envoie pas cet en-tête.
- ACTIVE.md marque encore B4 « à faire » : à basculer en « fait » avec le hash par l'orchestrateur.
