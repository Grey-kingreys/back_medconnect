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

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
