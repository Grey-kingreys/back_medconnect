# T99 - Corrections de la revue de sécurité : T03 et T04 livrés ensemble, secret de grâce effacé

Tier: spécifié (agent implementeur-specifie)
Audience: non-dev pour les messages d'erreur, dev pour le contrat JSON
Visuel: n/a
Background-safe: non, car docker compose exec sur l'arbre principal

Arbre de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/back_medconnect`, branche `orch/tb3-sessions`. Ne commite pas : l'orchestrateur commite. Commandes `docker compose` depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` ; dépôt back monté sur `/app` dans le conteneur `backend`.

Prérequis : T01 (6620169) et T02 (2f7b489) commités. Le travail de T03 est présent NON COMMITÉ dans l'arbre (parqué) : le conserver, ne rien annuler (`git checkout`, `git stash`, `git restore` interdits). Lire `docs/plans/runs/2026-10-20-tb3-sessions/decisions.md` (D05, D06, D08, D11, D12, D19, D20, D21), puis `tasks/T03-connexion-par-appareil.md` et `tasks/T04-refresh-et-deconnexion.md`.

## Pourquoi

Revue de sécurité du run (2026-10-20) :
1. Bloquant : avec le drapeau actif, T03 n'écrit plus `User.refreshToken` alors que `refreshAccessToken` lit encore cette colonne ; commité seul, T03 déconnecte tout utilisateur web au bout de 15 min. T03 et T04 doivent arriver dans le même commit (D19).
2. Bloquant : `graceSecretEnc` (refresh courant chiffré de façon réversible) n'est jamais effacé ; il reste en base pour toute session, après la grâce et après révocation. Une fuite de la base et de `ENCRYPTION_KEY` donnerait le refresh courant de chaque session. D04 (« jamais de secret en clair en base ») n'est tenu qu'à moitié (D20).
3. Mineur : `client.spec.ts`, cas « mobile sans aucun DTO », ne vérifie pas `code: 'VALIDATION'`.

## Spec

### 1. Terminer T04 sur l'arbre courant

Appliquer intégralement la section Spec de `tasks/T04-refresh-et-deconnexion.md` (DTO `jeton-renouvellement.dto.ts`, `refreshAccessToken` et `logout` dans `auth.service.ts`, routes `refresh` et `logout` dans `auth.controller.ts`, tests de `auth.service.spec.ts`, nouveau `auth.controller.spec.ts`). L'interdiction de toucher `sessions.service.ts` écrite dans T04 est levée UNIQUEMENT pour la section 3 ci-dessous.

Après T04, `generateTokens` n'a plus d'appelant : le commentaire « Inutilisée depuis TB3 » posé en T03 devient exact. Le vérifier par `grep -rn "generateTokens(\|generateToken(" src` (seules les définitions doivent apparaître). S'il reste un appelant, BLOCKED.

### 2. `src/auth/client.spec.ts`

Dans le test « mobile sans aucun DTO : 400 », vérifier en plus que `getResponse()` contient `code: 'VALIDATION'` (même forme que le `it.each` voisin). Ne rien retirer.

### 3. `src/auth/sessions.service.ts` : effacement du secret de grâce (D20)

- Toute révocation efface aussi la grâce. Ajouter `graceSecretEnc: null, graceUntil: null` au `data` des trois écritures de révocation : `ouvrir` (NOUVELLE_CONNEXION, `updateMany`), `renouveler` (REUTILISATION, `update`), `fermer` (DECONNEXION, `updateMany`).
- Nouvelle méthode publique `async purgerSecretsDeGrace(): Promise<number>` :
  `const { count } = await this.prisma.session.updateMany({ where: { graceSecretEnc: { not: null }, graceUntil: { lt: new Date() } }, data: { graceSecretEnc: null } }); return count;`
- `SessionsService` implémente `OnModuleInit` et `OnModuleDestroy` (`@nestjs/common`) :
  - `onModuleInit` : si `estSessionsMultiAppareilsActif()`, démarrer `this.minuteurPurge = setInterval(() => { this.purgerSecretsDeGrace().catch((e: unknown) => this.logger.warn(`Purge des secrets de grâce échouée : ${e instanceof Error ? e.message : String(e)}`)); }, PURGE_GRACE_MS)` puis `this.minuteurPurge.unref()` ;
  - `onModuleDestroy` : `clearInterval` si le minuteur existe.
  - `PURGE_GRACE_MS = 60_000` dans `sessions.constants.ts`, avec le commentaire `/** Intervalle d'effacement des secrets de grâce échus (D20). */`.
  - Opération idempotente : plusieurs instances peuvent la lancer sans coordination.
- Ne rien changer d'autre dans ce fichier (rotation, grâce, réutilisation, mode ancien).

### 4. Tests : `src/auth/sessions.service.spec.ts` (ajouts seulement)

- Révocation par réutilisation, par nouvelle connexion du même appareil, et par `fermer` : le `data` écrit contient `graceSecretEnc: null` et `graceUntil: null`.
- `purgerSecretsDeGrace` : appelle `session.updateMany` avec `graceSecretEnc: { not: null }` et `graceUntil: { lt: <Date> }`, données `{ graceSecretEnc: null }`, renvoie le `count`.
- `onModuleInit` avec le drapeau à `false` : aucun minuteur ; avec le drapeau actif (`jest.useFakeTimers()`) : après 60 s, `purgerSecretsDeGrace` a été appelée une fois ; `onModuleDestroy` arrête le minuteur. Restaurer les vrais minuteurs et la variable d'environnement après le test.
- Les tests TB3 existants (« deux refresh simultanés », « réutilisation hors grâce », « web et mobile du même utilisateur se renouvellent 24 h plus tard ») restent verts et inchangés.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Commentaires en français, aucun tiret cadratin ni demi-cadratin. Aucun log ne contient une valeur de refresh, de secret ou de jeton d'accès. Le web ne reçoit jamais le refresh dans le JSON ; le mobile ne lit jamais le cookie. Aucune modification du front, du schéma Prisma ni des migrations. Jamais de `prisma migrate reset` ni de `db push`.

## Done when

Depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` :
- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `docker compose exec -T backend npx eslint src/auth src/demo/demo.controller.ts src/demo/demo.controller.spec.ts src/demo/dto/connexion-demo.dto.ts src/structure/structure.service.ts` : 0 erreur (avertissements tolérés).
- `docker compose exec -T backend npx jest src/auth src/demo` : tout vert.
- `docker compose exec -T backend npx jest` : toutes les suites passent.
- `grep -rn "refreshToken: hashed\|refresh_token requis\|res.cookie('refresh_token'" back_medconnect/src/auth back_medconnect/src/structure` : aucune occurrence.
- `grep -rn "generateTokens(\|generateToken(" back_medconnect/src` : uniquement les deux définitions dans `auth.service.ts`.
- `grep -c "graceSecretEnc: null" back_medconnect/src/auth/sessions.service.ts` : au moins 4.
- `git -C back_medconnect status --porcelain` ne liste que : les fichiers de T03 (voir sa commande eslint), `src/auth/dto/jeton-renouvellement.dto.ts`, `src/auth/auth.controller.spec.ts`, `src/auth/sessions.service.ts`, `src/auth/sessions.service.spec.ts`, `src/auth/sessions.constants.ts`, et `docs/plans/` (fichiers de l'orchestrateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Commit (orchestrateur)

Un seul commit regroupant T03, T04 et T99, par chemins explicites (jamais `git add -A`), message : `feat(auth): connexion, refresh et déconnexion par session d'appareil, secret de grâce effacé (T03, T04, T99)`. Puis marquer T03 et T04 faits avec ce hash dans ACTIVE.md, et enchaîner T05.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
