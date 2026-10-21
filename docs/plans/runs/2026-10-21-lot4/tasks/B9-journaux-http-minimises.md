# B9 - Journaux HTTP minimisés (aucun en-tête, aucune IP) et niveau par statut

Tier: spécifié (agent implementeur-specifie)
Audience: dev (journaux techniques, aucun texte visible par un utilisateur)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot4-back` (arbre principal ; ne pas créer de branche ; NE PAS COMMITER : l'orchestrateur commite après validation). Rien à modifier dans le dépôt racine, ni dans `front_medconnect` ou `mobile_medconnect`.
Décisions de référence : `docs/plans/runs/2026-10-21-lot4/decisions.md`, D75 à D79.

## Spec

Contexte : `pino-http` (via `nestjs-pino`, configuré dans `src/app.module.ts`, `LoggerModule.forRoot`) journalise chaque requête avec le sérialiseur standard : tous les en-têtes de requête (user-agent, `true-client-ip`, `cf-connecting-ip`, `x-forwarded-for`, referer, `sec-ch-ua`...), `remoteAddress`, `remotePort`, `query`, `params`, et tous les en-têtes de réponse. Pour une plateforme de santé, on minimise. Versions installées : `pino-http` 11.0.0, `nestjs-pino` 4.6.1, `pino-std-serializers` 7.1.0.

Rappel du fonctionnement (vérifié dans `node_modules/pino-http/logger.js` et `node_modules/pino-std-serializers/index.js`) : `pino-http` enveloppe les sérialiseurs fournis (`wrapSerializers` vrai par défaut) ; le sérialiseur `req` personnalisé reçoit donc l'objet DÉJÀ sérialisé par le standard (`{ id, method, url, query, params, headers, remoteAddress, remotePort }`, où `url` vaut `req.originalUrl` sous Express, query comprise) ; le sérialiseur `res` reçoit `{ statusCode, headers }`. `customLogLevel(req, res, err)` reçoit les objets bruts (`IncomingMessage`, `ServerResponse`) ; pour une erreur ou un statut >= 500, `pino-http` journalise avec `err` au niveau renvoyé par `customLogLevel`.

### 1. Nouveau fichier `src/common/journalisation/journalisation-http.ts`

Commentaire d'en-tête en français (rôle : configuration des journaux HTTP, minimisation des données personnelles ; rappeler que toute nouvelle donnée de santé ou de localisation exposée dans un journal doit être ajoutée à `redact`). Imports :

```ts
import type { IncomingMessage, ServerResponse } from 'http';
import type { Options } from 'pino-http';
```

Exporter exactement ces quatre éléments :

#### 1.1 `serialiserRequeteHttp`

```ts
export function serialiserRequeteHttp(req: {
  id?: unknown;
  method?: string;
  url?: string;
}): { id: unknown; method: string | undefined; url: string | undefined }
```

Renvoie un NOUVEL objet `{ id: req.id, method: req.method, url }` où `url` est `req.url` tronquée au premier `?` (`req.url?.split('?')[0]`). Aucune autre clé (ni `headers`, ni `remoteAddress`, ni `remotePort`, ni `query`, ni `params`).

#### 1.2 `serialiserReponseHttp`

```ts
export function serialiserReponseHttp(res: { statusCode?: number }): {
  statusCode: number | undefined;
}
```

Renvoie `{ statusCode: res.statusCode }`, rien d'autre.

#### 1.3 `niveauJournalHttp`

```ts
export function niveauJournalHttp(
  req: IncomingMessage & { originalUrl?: string },
  res: ServerResponse,
  err?: Error,
): 'error' | 'warn' | 'info' | 'debug'
```

Règles, dans cet ordre :
1. `err` présent ou `res.statusCode >= 500` : `'error'` ;
2. `res.statusCode >= 400` : `'warn'` ;
3. `req.method === 'GET'` et le chemin (`(req.originalUrl ?? req.url ?? '')` tronqué au premier `?`) est exactement `/` ou `/notifications` : `'debug'` ;
4. sinon : `'info'`.

Déclarer en haut du fichier, non exportée : `const ROUTES_DE_SONDAGE = ['/', '/notifications'];` avec un commentaire (« Routes appelées en boucle (sonde de santé, rafraîchissement des notifications) : journalisées en debug quand elles réussissent. »). Seul `GET /notifications` exact est concerné (pas `/notifications/:id`, pas `PATCH`).

#### 1.4 `optionsPinoHttp`

```ts
export function optionsPinoHttp(): Options
```

Renvoie l'objet aujourd'hui écrit en ligne dans `app.module.ts` (`LoggerModule.forRoot({ pinoHttp: { ... } })`), DÉPLACÉ tel quel avec ses commentaires (`level`, `transport`, `redact` avec la MÊME liste de chemins et `censor: '[masqué]'`, `customProps` renvoyant `userId`, `autoLogging.ignore` de `/`), auquel on AJOUTE :

```ts
    serializers: {
      req: serialiserRequeteHttp,
      res: serialiserReponseHttp,
    },
    customLogLevel: niveauJournalHttp,
```

- Ne pas poser `serializers.err` (le sérialiseur d'erreur standard reste en place : journaux d'erreur inchangés).
- `redact` : garder les 8 chemins existants sans en retirer (`req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]` restent, par sécurité, même si les en-têtes ne sont plus sérialisés).
- `autoLogging: { ignore: (req: IncomingMessage) => req.url === '/' }` reste tel quel (D78).
- Le commentaire existant de `redact` (lignes 52 et 53 de `app.module.ts`, qui commencent par un emoji d'avertissement) contient un tiret cadratin : en le déplaçant, le réécrire sans emoji, sans tiret cadratin ni demi-cadratin, exactement ainsi : « Attention : `redact` masque les données sensibles. Toute nouvelle donnée de santé ou de localisation exposée dans un log doit être ajoutée à cette liste. »
- Ajouter au-dessus de `serializers` le commentaire : « Minimisation (données personnelles) : ni en-têtes ni adresse IP dans les journaux de requête ; l'URL est gardée sans sa query. »
- Si TypeScript refuse l'affectation directe d'une fonction à `serializers.req`, `serializers.res` ou `customLogLevel` à cause des génériques de `Options`, garder exactement ces signatures et poser le type de retour de `optionsPinoHttp` à `Options` ; le seul contournement autorisé est d'envelopper : `req: (req: { id?: unknown; method?: string; url?: string }) => serialiserRequeteHttp(req)` (idem pour `res`). Pas de `as any`.

### 2. `src/app.module.ts`

- Remplacer le bloc `LoggerModule.forRoot({ pinoHttp: { ... } })` par `LoggerModule.forRoot({ pinoHttp: optionsPinoHttp() })`, précédé d'un commentaire court en français : « Logs structurés (JSON en prod, lisibles en dev) ; configuration et minimisation dans src/common/journalisation/journalisation-http.ts. »
- Importer `optionsPinoHttp` depuis `'./common/journalisation/journalisation-http'`.
- Supprimer `import type { IncomingMessage } from 'http';` s'il n'est plus utilisé dans le fichier.
- Rien d'autre ne change dans `app.module.ts`.

### 3. Nouveau test `src/common/journalisation/journalisation-http.spec.ts`

`describe('serialiserRequeteHttp')` :
1. Entrée `{ id: 7, method: 'GET', url: '/structures?email=a%40b.gn&page=2', headers: { 'user-agent': 'x', 'x-forwarded-for': '41.223.1.2' }, remoteAddress: '41.223.1.2', remotePort: 5555, query: { email: 'a@b.gn' }, params: {} }` (passer l'objet via une variable typée large, pour que TypeScript accepte les clés en trop) : le résultat est `toEqual({ id: 7, method: 'GET', url: '/structures' })` et `Object.keys(resultat)` vaut `['id', 'method', 'url']`.
2. URL sans query : `/notifications` reste `/notifications`.

`describe('serialiserReponseHttp')` :
3. Entrée `{ statusCode: 201, headers: { 'set-cookie': 'refresh=abc', 'content-type': 'application/json' } }` : résultat `toEqual({ statusCode: 201 })`.

`describe('niveauJournalHttp')` (fabriquer `req` et `res` comme objets littéraux convertis en `IncomingMessage & { originalUrl?: string }` et `ServerResponse` via `as unknown as`) :
4. GET `/structures`, 500 : `'error'` ;
5. GET `/structures`, 200, avec `err = new Error('x')` : `'error'` ;
6. POST `/auth/login`, 401 : `'warn'` ;
7. GET `/notifications`, 404 : `'warn'` (un échec reste visible) ;
8. GET `/notifications`, 200 : `'debug'` ;
9. GET `/notifications?page=2` (dans `originalUrl`), 200 : `'debug'` ;
10. GET `/`, 200 : `'debug'` ;
11. GET `/notifications/abc`, 200 : `'info'` ;
12. PATCH `/notifications/read-all`, 200 : `'info'` ;
13. GET `/structures`, 200 : `'info'` ;
14. `originalUrl` absent, `url` = `/notifications` : `'debug'`.

`describe('optionsPinoHttp, de bout en bout avec pino-http')` (preuve que le câblage réel ne laisse passer ni en-tête ni IP) :
- Monter un serveur avec `supertest` sur un `http.createServer` minimal : `const lignes: string[] = []` ; un flux `new Writable({ write(chunk, _enc, cb) { lignes.push(chunk.toString()); cb(); } })` ; `const journal = pinoHttp({ ...optionsPinoHttp(), transport: undefined, level: 'trace' }, flux)` (import : `import { pinoHttp } from 'pino-http';`, `import { Writable } from 'stream';`, `import { createServer } from 'http';`, `import request from 'supertest';`) ; le gestionnaire appelle `journal(req, res)`, puis répond selon `req.url` : `/structures?email=a%40b.gn` -> 200, `/notifications` -> 200, `/erreur` -> 500, `/absent` -> 404 ; `res.setHeader('set-cookie', 'refresh=secret')` sur la réponse 200 de `/structures`.
- Lire chaque ligne avec `JSON.parse` et ne garder que celles qui ont une clé `res` (lignes de fin de requête). Avant de lire `lignes`, attendre que l'écriture soit faite (la réponse de supertest arrive après `finish` ; si une ligne manque, attendre `await new Promise((r) => setImmediate(r))`).
15. `GET /structures?email=a%40b.gn` avec les en-têtes `user-agent: test-agent`, `x-forwarded-for: 41.223.1.2`, `cf-connecting-ip: 41.223.1.3`, `referer: https://exemple.gn/page`, `authorization: Bearer jeton-secret`, `cookie: refresh=secret` : la ligne a `level` 30, `req` `toEqual({ id: expect.anything(), method: 'GET', url: '/structures' })`, `res` `toEqual({ statusCode: 200 })`, une clé `responseTime` numérique ; et la ligne BRUTE (chaîne) ne contient aucune de ces sous-chaînes : `41.223.1.2`, `41.223.1.3`, `test-agent`, `exemple.gn`, `jeton-secret`, `secret`, `a%40b.gn`, `remoteAddress`, `headers`.
16. `GET /notifications` : `level` 20 (debug).
17. `GET /absent` : `level` 40 (warn).
18. `GET /erreur` : `level` 50 (error) et la ligne garde une clé `err` (journal d'erreur inchangé).

Note : `optionsPinoHttp().level` dépend de `NODE_ENV` et `LOG_LEVEL` ; le test l'écrase par `level: 'trace'` et retire `transport` pour écrire du JSON dans le flux.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (commentaires en français, aucun tiret cadratin U+2014 ni demi-cadratin U+2013 dans les lignes ajoutées). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

- Fichiers autorisés, et eux seuls : `src/common/journalisation/journalisation-http.ts` (nouveau), `src/common/journalisation/journalisation-http.spec.ts` (nouveau), `src/app.module.ts`.
- Aucun changement des journaux applicatifs (`Logger`, `PinoLogger`, filtre d'exceptions, intercepteur d'audit) ni de `src/main.ts`.
- Pas de nouvelle dépendance npm : `pino-http` (dépendance de `nestjs-pino`, présente dans `node_modules`) et `supertest` (devDependency) sont déjà installés.
- `npx eslint --fix` dans le conteneur est autorisé sur les trois fichiers ci-dessus uniquement.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :
1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/common/journalisation/journalisation-http.ts src/common/journalisation/journalisation-http.spec.ts src/app.module.ts` : 0 erreur (avertissements tolérés).
3. `docker compose exec -T backend npx jest` : toutes les suites passent, dont `journalisation-http.spec.ts` (18 cas ci-dessus) et `app.module.spec.ts`.
4. `git -C back_medconnect status --porcelain -- . ':!docs/plans'` ne liste que les 3 fichiers autorisés.
5. `git -C back_medconnect diff -U0 | grep '^+' | LC_ALL=C.UTF-8 grep -P '[\x{2013}\x{2014}]'` : aucune sortie ; même contrôle sur les deux fichiers nouveaux (`LC_ALL=C.UTF-8 grep -P '[\x{2013}\x{2014}]' back_medconnect/src/common/journalisation/*.ts` : aucune sortie).
6. `grep -n "optionsPinoHttp()" back_medconnect/src/app.module.ts` : une occurrence ; `grep -c "serializers\|customLogLevel" back_medconnect/src/common/journalisation/journalisation-http.ts` : au moins 2.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
2026-10-21 | chef back : tsc, eslint (3 fichiers), jest | 0 erreur, 0 erreur, 52 suites / 591 tests passés (18 pour B9) | commit « feat(journalisation): ... (B9) »
