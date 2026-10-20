# T01 - Chat : accès limité aux participants (REST, WebSocket, CORS gateway)

Tier: spécifié (agent implementeur-specifie)
Audience: non-dev pour les messages d'erreur renvoyés (affichés au patient ou au soignant) ; dev pour le reste
Visuel: n/a
Background-safe: oui

## Spec

Backlog P0 point 1. Constat vérifié : tout utilisateur connecté lit, écoute et écrit dans n'importe quelle conversation (y compris positions GPS partagées).
- `src/chat/chat.service.ts` : `getMessages(conversationId, userId)` ne filtre pas (paramètre `userId` ignoré).
- `src/chat/chat.gateway.ts` : `handleJoinConversation` rejoint la room `conv_<id>` sans contrôle ; `handleMessage` (`sendMessage`) enregistre et diffuse sans contrôle, et notifie un `receiverId` arbitraire fourni par le client ; `@WebSocketGateway({ cors: { origin: '*' } })`.

À faire :
1. Dans `ChatService`, ajouter une méthode publique `isParticipant(conversationId: string, userId: string): Promise<boolean>`. Règle (identique à celle de `getConversations` déjà en place) : la conversation existe ET (`patientId === userId` OU `medecinId === userId` OU (`structureId` non nul, égal au `structureId` de l'utilisateur, et l'utilisateur a la permission `PERMISSIONS.CHAT_STRUCTURE` via `this.permissionsService.hasPermissions`)). Réutiliser `this.prisma` et `this.permissionsService` déjà injectés.
2. Ajouter `assertParticipant(conversationId, userId)` qui lève `NotFoundException("Cette conversation est introuvable.")` si la conversation n'existe pas et `ForbiddenException("Vous n'avez pas accès à cette conversation.")` si l'utilisateur n'est pas participant. (Peut partager la requête avec `isParticipant` ; ne pas dupliquer la règle.)
3. `getMessages` : appeler `assertParticipant` avant la lecture.
4. Gateway `joinConversation` : si `client.data.userId` absent ou non participant, ne pas rejoindre la room et retourner `{ event: 'error', data: { message: "Vous n'avez pas accès à cette conversation." } }`. Sinon comportement actuel. La méthode devient `async`.
5. Gateway `sendMessage` : si non participant, ne rien enregistrer ni diffuser, retourner le même objet d'erreur. Notifications (DB et socket) au `receiverId` uniquement si ce `receiverId` est `patientId` ou `medecinId` de la conversation et différent de l'émetteur ; sinon l'ignorer silencieusement. Pour cela, exposer depuis le service ce dont la gateway a besoin (par exemple `isParticipant` qui retourne aussi la conversation, ou une méthode `getConversationParticipants`) sans dupliquer la requête Prisma dans la gateway.
6. CORS de la gateway aligné sur le CORS HTTP de `src/main.ts` : `cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }`. Ajouter un commentaire français expliquant l'alignement.
7. Tests unitaires Jest : créer `src/chat/chat.service.spec.ts` et `src/chat/chat.gateway.spec.ts` (s'inspirer du style de `src/carnet-sante/carnet-sante.service.spec.ts` : mocks Prisma et PermissionsService à la main, pas de base). Cas minimum :
   - service : `getMessages` lève Forbidden pour un non participant et ne lit pas `message.findMany` ; NotFound pour une conversation inexistante ; renvoie les messages pour patient, médecin, membre de structure avec `chat:structure` ; refus pour membre de la structure sans la permission.
   - gateway : `joinConversation` d'un non participant n'appelle pas `client.join` et retourne l'erreur ; d'un participant appelle `client.join('conv_<id>')` ; `sendMessage` d'un non participant n'appelle pas `saveMessage` ni `server.to` ; `receiverId` étranger à la conversation ne déclenche pas `createNotification`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (sections 1, 2, 4, 5 et 14 : messages d'erreur en vocabulaire utilisateur). Aucun tiret cadratin ni demi-cadratin dans les lignes ajoutées. Commentaires en français. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas committer (l'orchestrateur commite).

## Done when

- `npx --no-install tsc --noEmit` : 0 erreur.
- `npx --no-install eslint src/chat/*.ts` : 0 erreur.
- `npx --no-install jest src/chat` : tous verts, et les cas listés au point 7 existent.
- `npm test` : tout vert.
- `grep -n "origin: '\*'" src/chat/chat.gateway.ts` : aucun résultat.

## Return

Liste des fichiers modifiés ou créés + preuve (commande lancée, résultat en une ligne) pour chaque done-condition. Ou un bloc BLOCKED. Pas de prose.

## Tentative 2 : propreté eslint des fichiers touchés (décision D05)

La logique est validée et ne doit pas changer. Le pre-commit lance eslint sur chaque fichier indexé et refuse le commit à la moindre erreur ; `--no-verify` est interdit. Convention du projet : tout fichier touché doit être propre, dette préexistante comprise.

Fichiers à rendre propres : `src/chat/chat.gateway.ts` (18 erreurs : `no-unsafe-*` sur `client.handshake`, `client.data`, `decoded` du `jwtService.verify`, `require-await` x2, `no-unused-vars` x1) et `src/chat/chat.service.ts` (1 `no-unsafe-return`, `let conv` non typé dans `getOrCreateConversation`). `chat.controller.ts` n'est pas touché : ne pas le modifier.

Règles :
1. Aucun changement de comportement. Les specs `src/chat/*.spec.ts` restent vertes sans modification de leurs assertions.
2. Corriger par typage minimal et local : `jwtService.verify<{ userId: string }>(...)`, une interface locale pour `client.data` (ex. `(client.data as { userId?: string })`), lecture typée du handshake, type explicite pour `conv` (type Prisma `Conversation` importé de `generated/prisma/client` ou inférence via `Awaited<ReturnType<...>>`). Pour `require-await` : si la méthode n'attend rien, retirer `async` seulement si la signature publique et les appels restent compatibles (sinon disable ligne). Variable inutilisée : la retirer si c'est une variable locale (pas un paramètre d'API), sinon préfixer selon la config.
3. En dernier recours seulement, `// eslint-disable-next-line <règle> -- <raison en français>` sur une ligne précise. Jamais de désactivation à l'échelle du fichier.
4. Ne jamais utiliser `git stash` (pile partagée entre worktrees, décision D06). Ne jamais committer.

Done when (tentative 2) :
- `npx --no-install eslint src/chat/chat.gateway.ts src/chat/chat.service.ts src/chat/chat.gateway.spec.ts src/chat/chat.service.spec.ts` : 0 erreur.
- `npx --no-install tsc --noEmit` : 0 erreur ; `npm test` : tout vert.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-06 | spécifié | logique ok, tests ok (12 tests chat) | eslint : 19 erreurs préexistantes dans les fichiers touchés bloquent le pre-commit ; incident git stash partagé avec T04, résolu
2026-10-07 | orchestrateur (reprise, exécution directe D07) | validé | tentative 2 trouvée faite sur disque ; ajout de `void` devant `client.join` (warning no-floating-promises)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
npx --no-install eslint src/chat/chat.gateway.ts src/chat/chat.service.ts src/chat/*.spec.ts | 0 erreur, 0 warning | 3c5d164
npx --no-install tsc --noEmit | 0 erreur | 3c5d164
npm test (worktree de tâche) | 5 suites, 46 tests verts (12 chat) | 3c5d164
grep -n "origin: '\*'" src/chat/chat.gateway.ts | aucun résultat | 3c5d164
merge --no-ff dans orch/p0-securite | sans conflit | 16d2c49
