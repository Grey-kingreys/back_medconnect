# T04 - Point 15 : Swagger hors production + limite de débit sur l'inscription

Tier: spécifié (agent implementeur-specifie)
Audience: dev (Swagger) ; message 429 visible traité par T05
Visuel: n/a
Background-safe: oui

## Spec

Constats (vérifiés) :
- `src/main.ts` (bloc « Swagger », lignes 56 à 64 environ) expose Swagger sur `/api` sans condition, y compris en production, et logue « Swagger disponible » sans condition.
- `src/auth/auth.controller.ts` : `POST /auth/register` n'a pas de `@Throttle` (seul le palier global de 120 req/min s'applique), alors que login, forgot-password et reset-password ont `@Throttle(AUTH_THROTTLE)` (10 req/min).

À faire :
1. Swagger : ne monter Swagger (création du document, `SwaggerModule.setup`, et log « Swagger disponible ») que si `process.env.NODE_ENV !== 'production'` **ou** si `process.env.SWAGGER_ENABLED === 'true'` (ouverture volontaire, par exemple sur une préproduction). Ne pas supprimer le code : l'entourer de la condition, commentaire en français expliquant pourquoi (surface d'attaque, cartographie de l'API).
2. Déclarer `SWAGGER_ENABLED` dans `src/config/env.validation.ts` comme variable optionnelle (`required: false`), avec une validation `'true'` ou `'false'`, en suivant exactement la forme des règles existantes (lire le fichier). Ne pas ajouter de valeur par défaut.
3. `POST /auth/register` : ajouter `@Throttle(AUTH_THROTTLE)` (même palier que la connexion ; réutiliser la constante existante).
4. Dans `main.ts`, remplacer l'appel final `bootstrap();` par `void bootstrap();` seulement si eslint le réclame (règle `no-floating-promises`).
5. Documenter `SWAGGER_ENABLED` dans le `CLAUDE.md` de ce dépôt, section « Variables d'environnement », ligne « Autres » (une mention courte). Ne pas toucher à `.env.example` ni à `compose.yml` du dépôt parent (autre niveau de priorité).

## Contraintes

Faire uniquement ce qui est demandé. Règles typographiques et de langue : docs/ORCHESTRATOR.md (commentaires en français, aucun tiret cadratin ni demi-cadratin). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas commiter : l'orchestrateur commite.

## Done when

- `npx --no-install tsc --noEmit` : 0 erreur ; `npx --no-install eslint <fichiers touchés>` : 0 erreur, procédure D07 de `docs/plans/runs/2026-10-06-p1-beta/decisions.md` ; `npm test` : vert.
- Grep : `SwaggerModule.setup` est à l'intérieur d'un `if` portant sur `NODE_ENV` et `SWAGGER_ENABLED` ; `register(` est précédé de `@Throttle(AUTH_THROTTLE)`.
- Test unitaire ajouté dans le spec existant de la validation d'env s'il existe (sinon dans un nouveau `src/config/env.validation.spec.ts`) : `SWAGGER_ENABLED=oui` rejeté, `true` accepté, absent accepté. S'appuyer sur la fonction exportée par `env.validation.ts`.

## Return

Liste des fichiers modifiés + preuves (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

2026-10-07 | orchestrateur (reprise, D08) | succès | `bootstrap()` laissé tel quel (avertissement eslint, pas une erreur) ; tiret d'un message reformaté remplacé (D10)

## Validation

tsc --noEmit ; eslint main.ts, env.validation(.spec).ts, auth.controller.ts ; npm test ; grep | 0 erreur ; 0 erreur (7 avertissements) ; 8 suites, 60 tests verts (oui rejeté, true et absent acceptés) ; SwaggerModule.setup dans `if (swaggerActif)`, `@Throttle(AUTH_THROTTLE)` juste avant `register(` | 8392d17, merge 4033dbf
