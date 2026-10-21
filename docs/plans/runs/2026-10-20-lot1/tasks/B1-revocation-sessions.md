# B1 - TB4 : révocation des sessions, compte désactivé, socket sessionRevoquee, purge

Tier: spécifié (agent implementeur-specifie)
Audience: dev (routes, Swagger) et non-dev (champ `message` des réponses, payload `sessionRevoquee`)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot1-back` (arbre principal, ne pas créer de branche, NE PAS COMMITER : l'orchestrateur commite après validation).
Décisions de référence : `docs/plans/runs/2026-10-20-lot1/decisions.md` (D01 à D12) et, pour le socle TB3, `docs/plans/archive/2026-10-20-tb3-sessions/decisions.md`.

## Spec

### Contexte (à lire avant de coder)

TB3 a livré les sessions par appareil : modèle Prisma `Session` (champs `id`, `userId`, `clientType` WEB ou MOBILE, `platform`, `deviceId`, `deviceName`, `appVersion`, `refreshHash`, `previousRefreshHash`, `graceUntil`, `graceSecretEnc`, `createdAt`, `lastUsedAt`, `expiresAt`, `revokedAt`, `revokedReason`), `SessionsService` (`src/auth/sessions.service.ts`, seul endroit qui émet, tourne ou révoque un refresh), constantes `src/auth/sessions.constants.ts` (`MESSAGES_SESSION`, `DUREE_ACCES_SECONDES`, `estSessionsMultiAppareilsActif`, type `RaisonRevocation`), catalogue `src/common/filters/codes-erreur.ts` (le filtre global recopie le champ `code` d'une exception s'il est au catalogue). Le jeton d'accès (15 min) porte `userId`, `role`, `structureId?` et `sid` (identifiant de session) quand le drapeau `SESSIONS_MULTI_APPAREILS` est actif. Aujourd'hui `AuthGuard` (`src/common/guards/auth.guard.ts`) ne vérifie que la signature : une session révoquée ou un compte désactivé garde l'accès jusqu'à 15 min. Client Redis partagé : `@Inject(REDIS_CLIENT) redis: Redis` (`src/common/redis/redis.module.ts`, module global). `PrismaService` est global (`PrismaModule`). Socket.io passe par l'adaptateur Redis (`src/common/redis-io.adapter.ts`), donc `server.to(salle).emit` et `server.in(salle).disconnectSockets(true)` atteignent toutes les instances.

Ce qu'il faut livrer, dans cette seule tâche (les morceaux ne fonctionnent qu'ensemble) :

### 1. Constantes (`src/auth/sessions.constants.ts`, modifier)

- Étendre `RaisonRevocation` : ajouter `'REVOCATION_UTILISATEUR' | 'MOT_DE_PASSE_MODIFIE' | 'MOT_DE_PASSE_REINITIALISE' | 'COMPTE_DESACTIVE'` (D09).
- Ajouter :
  - `ETAT_VALIDE_TTL_S = 30` (durée de l'état `ok` en cache) ;
  - `ETAT_REVOQUE_TTL_S = DUREE_ACCES_SECONDES + 60` (960 s) ;
  - `DELAI_REDIS_MS = 250` (au-delà, lecture PostgreSQL) ;
  - `PURGE_SESSIONS_MS = 60 * 60 * 1000` ;
  - `RETENTION_SESSIONS_MS = 30 * 24 * 60 * 60 * 1000` ;
  - `DELAI_DECONNEXION_SOCKET_MS = 1000` ;
  - dans `MESSAGES_SESSION`, ajouter `appareilIntrouvable: 'Cet appareil est introuvable ou déjà déconnecté.'`, `appareilDeconnecte: 'Appareil déconnecté.'`, `autresDeconnectes: 'Vos autres appareils ont été déconnectés.'`, `aucunAutreAppareil: "Aucun autre appareil n'était connecté."`.
  - une fonction `messagePourCode(code: 'SESSION_REVOQUEE' | 'SESSION_EXPIREE' | 'COMPTE_DESACTIVE'): string` qui renvoie respectivement `MESSAGES_SESSION.revoquee`, `.expiree`, `.compteDesactive`.
  - un type exporté `CodeRevocation = 'SESSION_REVOQUEE' | 'SESSION_EXPIREE' | 'COMPTE_DESACTIVE'` (sous-ensemble de `CodeErreur`, importer `CodeErreur` en `import type` si utile pour le contraindre).

### 2. Nouveau service `src/auth/revocation.service.ts` (D01, D04)

`@Injectable() export class RevocationService`, constructeur `(@Inject(REDIS_CLIENT) private readonly redis: Redis, private readonly prisma: PrismaService)`. Logger Nest `new Logger(RevocationService.name)`.

Types exportés :
```ts
export interface EvenementRevocation {
  userId: string;
  sessionIds: string[];
  code: CodeRevocation;
}
export type Diffuseur = (evt: EvenementRevocation) => void;
```

Clés Redis (fonctions privées) : `auth:etat:session:<sid>` et `auth:etat:compte:<userId>`. Valeurs : `'ok'` ou un `CodeRevocation`.

Méthodes publiques :

1. `async verifier(jeton: { userId: string; sid?: string }): Promise<CodeRevocation | null>`
   - clé = `sid` présent ? clé session : clé compte.
   - Lire la clé avec `this.redis.get(cle)` en course contre un délai de `DELAI_REDIS_MS` (helper privé `avecDelai<T>(p: Promise<T>): Promise<T>` à base de `Promise.race` et d'un `setTimeout` qui rejette, minuteur nettoyé par `clearTimeout` dans un `finally`).
   - Valeur `'ok'` : renvoyer `null`. Valeur égale à un `CodeRevocation` : la renvoyer.
   - Valeur absente (`null`) : `const etat = await this.lireEnBase(jeton)` ; puis écrire la clé sans faire échouer la requête si Redis échoue (erreur avalée et journalisée en `warn`, toujours sous `avecDelai`) : `etat === null` donne `this.redis.set(cle, 'ok', 'EX', ETAT_VALIDE_TTL_S, 'NX')`, sinon `this.redis.set(cle, etat, 'EX', ETAT_REVOQUE_TTL_S)`. Renvoyer `etat`.
   - Erreur Redis ou délai dépassé sur le `get` : `return this.lireEnBase(jeton)` sans écriture, et journaliser au plus un `warn` par minute (« Redis indisponible pour le contrôle des sessions, lecture en base »), via un champ privé `dernierAvertissement: number`.
   - Une erreur Prisma n'est pas avalée (elle remonte).
2. `private async lireEnBase(jeton): Promise<CodeRevocation | null>`
   - avec `sid` : `prisma.session.findUnique({ where: { id: sid }, select: { userId: true, revokedAt: true, revokedReason: true, expiresAt: true, user: { select: { isActive: true } } } })`. Absente ou `userId` différent : `'SESSION_EXPIREE'`. `!user.isActive` : `'COMPTE_DESACTIVE'`. `revokedAt` non nul : `revokedReason === 'COMPTE_DESACTIVE' ? 'COMPTE_DESACTIVE' : 'SESSION_REVOQUEE'`. `expiresAt <= maintenant` : `'SESSION_EXPIREE'`. Sinon `null`.
   - sans `sid` : `prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } })`. Absent : `'SESSION_EXPIREE'`. Inactif : `'COMPTE_DESACTIVE'`. Sinon `null`.
3. `async signaler(evt: EvenementRevocation): Promise<void>` : ne lève jamais.
   - Si `evt.sessionIds` non vide : un `this.redis.multi()` avec, pour chaque id, `set(cleSession(id), evt.code, 'EX', ETAT_REVOQUE_TTL_S)`, puis `exec()` sous `avecDelai` ; en cas d'erreur, `logger.error` « État de révocation non écrit dans Redis pour N session(s) ; effet sous 30 s au plus » (aucun identifiant de jeton, l'id utilisateur est permis).
   - Si `evt.code === 'COMPTE_DESACTIVE'` : `set(cleCompte(userId), 'COMPTE_DESACTIVE', 'EX', ETAT_REVOQUE_TTL_S)` (même tolérance aux erreurs).
   - Puis appeler chaque diffuseur enregistré avec `evt`, chacun dans un try/catch (erreur journalisée en `warn`).
4. `async effacerCompte(userId: string): Promise<void>` : `del(cleCompte(userId))`, erreur avalée et journalisée. Sert à la réactivation (D05).
5. `enregistrerDiffuseur(fn: Diffuseur): void` : ajoute à un tableau privé.

### 3. `SessionsService` (`src/auth/sessions.service.ts`, modifier) (D06, D08, D10)

- Injecter `RevocationService` (4e paramètre du constructeur : `private readonly revocation: RevocationService`).
- Nouvelle méthode privée unique de révocation, utilisée par TOUTES les révocations du service :
  ```ts
  private async revoquer(
    where: Prisma.SessionWhereInput,  // import type { Prisma } from 'generated/prisma/client'
    raison: RaisonRevocation,
    code: CodeRevocation,
    userId: string,
  ): Promise<string[]>
  ```
  1. `findMany({ where: { ...where, revokedAt: null }, select: { id: true } })` ;
  2. si aucune : renvoyer `[]` sans rien écrire (exception : voir `desactiverCompte`) ;
  3. `updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: maintenant, revokedReason: raison, graceSecretEnc: null, graceUntil: null } })` ;
  4. `await this.revocation.signaler({ userId, sessionIds: ids, code })` ;
  5. renvoyer `ids`.
- Remplacer par cet helper les trois révocations existantes, comportement inchangé par ailleurs :
  - `ouvrir` (mobile, même `deviceId`) : `revoquer({ userId: user.id, deviceId: client.deviceId }, 'NOUVELLE_CONNEXION', 'SESSION_REVOQUEE', user.id)` ;
  - `renouveler` (réutilisation) : `revoquer({ id }, 'REUTILISATION', 'SESSION_REVOQUEE', session.userId)` avant le `warn` et le `throw` existants ;
  - `fermer` : `revoquer({ id: idSession }, 'DECONNEXION', 'SESSION_REVOQUEE', <userId de la session trouvée>)` (récupérer le `userId` de la session lue dans les deux branches).
- `ouvrir` : pour une session WEB, `deviceName: client.nomAppareil ?? null` (au lieu de `null`) ; `platform`, `deviceId`, `appVersion` restent `null` en web (D07).
- Nouvelles méthodes publiques :
  1. `async lister(userId: string, sidCourant?: string)` : drapeau inactif, renvoie `[]`. Sinon `findMany({ where: { userId, revokedAt: null, expiresAt: { gt: maintenant } }, orderBy: { lastUsedAt: 'desc' } })` puis map vers :
     ```ts
     {
       id: string;
       type: 'web' | 'mobile';
       nom: string;              // deviceName, sinon repli D07
       plateforme: string;       // 'web' pour WEB, sinon platform ?? 'inconnue'
       versionApp: string | null;
       creeLe: Date;             // createdAt
       derniereActivite: Date;   // lastUsedAt
       expireLe: Date;           // expiresAt
       appareilCourant: boolean; // id === sidCourant
     }
     ```
     Repli de `nom` (D07) : WEB « Navigateur web » ; MOBILE `platform === 'ios'` « iPhone », `'android'` « Téléphone Android », sinon « Téléphone ». Tri final : l'appareil courant d'abord, puis l'ordre `lastUsedAt` décroissant.
  2. `async revoquerUne(userId: string, id: string): Promise<void>` : drapeau inactif, `NotFoundException({ message: MESSAGES_SESSION.appareilIntrouvable })`. Sinon `revoquer({ id, userId, expiresAt: { gt: maintenant } }, 'REVOCATION_UTILISATEUR', 'SESSION_REVOQUEE', userId)` ; résultat vide, même `NotFoundException` (session inconnue, d'un autre utilisateur, déjà révoquée ou expirée : réponse identique). Ne pas valider le format de `id` (colonne texte : un id quelconque donne simplement 404).
  3. `async revoquerAutres(userId: string, sidCourant: string | undefined, raison: 'REVOCATION_UTILISATEUR' | 'MOT_DE_PASSE_MODIFIE'): Promise<number>` : drapeau inactif, `0`. Sinon `revoquer(sidCourant ? { userId, id: { not: sidCourant } } : { userId }, raison, 'SESSION_REVOQUEE', userId)` et renvoyer le nombre d'ids.
  4. `async revoquerToutes(userId: string, raison: 'MOT_DE_PASSE_REINITIALISE'): Promise<number>` : drapeau inactif, `prisma.user.update({ where: { id: userId }, data: { refreshToken: null, refreshTokenExpires: null } })` et `0` (D03). Sinon `revoquer({ userId }, raison, 'SESSION_REVOQUEE', userId)`, renvoie le nombre.
  5. `async desactiverCompte(userId: string): Promise<void>` : drapeau inactif, vider `refreshToken` et `refreshTokenExpires` comme ci-dessus ; drapeau actif, `revoquer({ userId }, 'COMPTE_DESACTIVE', 'COMPTE_DESACTIVE', userId)`. Dans les deux cas, si aucune session n'a été révoquée par `revoquer` (ou en mode drapeau inactif), appeler quand même `this.revocation.signaler({ userId, sessionIds: [], code: 'COMPTE_DESACTIVE' })` pour écrire la clé de compte et prévenir la salle utilisateur (quand `revoquer` a révoqué au moins une session, il a déjà signalé avec ce code : ne pas signaler deux fois).
  6. `async reactiverCompte(userId: string): Promise<void>` : `await this.revocation.effacerCompte(userId)`.
  7. `async purgerSessionsExpirees(): Promise<number>` : `limite = maintenant - RETENTION_SESSIONS_MS` ; `deleteMany({ where: { OR: [{ expiresAt: { lt: limite } }, { revokedAt: { lt: limite } }] } })` ; si `count > 0`, `logger.log(\`Sessions purgées : ${count}\`)` ; renvoie `count`.
- `onModuleInit` : en plus du minuteur existant de purge des secrets de grâce, un second `setInterval` de `PURGE_SESSIONS_MS` qui appelle `purgerSessionsExpirees()` (erreur journalisée en `warn`, comme l'existant), `unref()`, nettoyé dans `onModuleDestroy`. Seulement drapeau actif (comme l'existant).

### 4. `AuthGuard` (`src/common/guards/auth.guard.ts`, modifier) (D11)

- Constructeur : `(private readonly jwtService: JwtService, private readonly revocation: RevocationService)`.
- Garder tel quel l'extraction, les deux messages actuels et le try/catch de `verifyAsync` (typer le résultat `verifyAsync<{ userId: string; role: string; structureId?: string; sid?: string }>`).
- APRÈS le try/catch (pour que l'exception ne soit pas remplacée par « Token invalide ou expiré. ») : `const code = await this.revocation.verifier({ userId: payload.userId, sid: payload.sid });` ; si `code`, `throw new UnauthorizedException({ message: messagePourCode(code), code })`. Sinon `request['user'] = payload` et `return true`.

### 5. Module (`src/auth/auth.module.ts`, `src/chat/chat.module.ts`, modifier) (D12)

- `AuthModule` : ajouter `RevocationService` aux `providers` et aux `exports`.
- `ChatModule` : ajouter `AuthModule` à `imports` (garder `JwtModule.register({})` et `NotificationsModule`).

### 6. Routes (`src/auth/auth.controller.ts`, modifier) (D08)

- Injecter `SessionsService` dans le constructeur (2e paramètre `private readonly sessions: SessionsService`).
- `@UseGuards(AuthGuard) @Get('sessions') @ApiBearerAuth() @ApiOperation({ summary: 'Mes appareils connectés' })` : `data = await this.sessions.lister(req.user.userId, req.user.sid)` ; renvoie `{ data, message: 'Appareils connectés récupérés', success: true }`.
- `@UseGuards(AuthGuard) @Post('sessions/revoquer-autres') @HttpCode(HttpStatus.OK) @ApiBearerAuth() @ApiOperation({ summary: 'Déconnecter mes autres appareils' })` : `nombre = await this.sessions.revoquerAutres(req.user.userId, req.user.sid, 'REVOCATION_UTILISATEUR')` ; renvoie `{ data: { nombre }, message: nombre > 0 ? MESSAGES_SESSION.autresDeconnectes : MESSAGES_SESSION.aucunAutreAppareil, success: true }`. Déclarer cette route AVANT la route `DELETE sessions/:id` dans le fichier.
- `@UseGuards(AuthGuard) @Delete('sessions/:id') @HttpCode(HttpStatus.OK) @ApiBearerAuth() @ApiOperation({ summary: 'Déconnecter cet appareil' }) @ApiResponse({ status: 404, description: 'Session inconnue, d\'un autre utilisateur, déjà révoquée ou expirée' })` avec `@Param('id') id: string`, `@Req() req`, `@Res({ passthrough: true }) res: Response` : `await this.sessions.revoquerUne(req.user.userId, id)` ; si `id === req.user.sid` et `typeClient(req) === SessionClientType.WEB`, `this.sessions.effacerCookie(res)` ; renvoie `{ data: { id }, message: MESSAGES_SESSION.appareilDeconnecte, success: true }`. Importer `Delete` depuis `@nestjs/common`.
- `changePassword` : passer `req.user.sid` en 3e argument à `authService.changePassword`.

### 7. Mot de passe (`src/auth/dto/auth.dto.ts`, `src/auth/auth.service.ts`, `src/user/user.service.ts`, modifier) (D02, D03)

- `ChangePasswordDto` : ajouter
  ```ts
  @ApiPropertyOptional({ example: true, description: 'Déconnecter mes autres appareils (true par défaut)' })
  @IsOptional()
  @IsBoolean()
  deconnecterAutresAppareils?: boolean;
  ```
  (importer `IsBoolean` et `ApiPropertyOptional` s'ils ne le sont pas).
- `AuthService.changePassword(userId: string, dto: ChangePasswordDto, sid?: string)` : après la mise à jour du mot de passe, `const appareilsDeconnectes = dto.deconnecterAutresAppareils === false ? 0 : await this.sessions.revoquerAutres(userId, sid, 'MOT_DE_PASSE_MODIFIE');` ; réponse `{ data: { appareilsDeconnectes }, message: appareilsDeconnectes > 0 ? 'Mot de passe modifié. Vos autres appareils ont été déconnectés.' : 'Mot de passe modifié avec succès', success: true }`.
- `AuthService.resetPassword` : après la mise à jour, `await this.sessions.revoquerToutes(user.id, 'MOT_DE_PASSE_REINITIALISE');` ; réponse inchangée.
- `UserService` : injecter `SessionsService` (6e paramètre `private readonly sessions: SessionsService`, import depuis `src/auth/sessions.service`) ; `changeUserPassword` appelle `await this.sessions.revoquerToutes(userId, 'MOT_DE_PASSE_REINITIALISE')` après la mise à jour ; `toggleActive` appelle, après la mise à jour, `updated.isActive ? await this.sessions.reactiverCompte(userId) : await this.sessions.desactiverCompte(userId)`. Réponses inchangées.

### 8. Désactivation par l'établissement (`src/structure/structure.service.ts`, modifier) (D05)

`toggleMembreActive` : après la mise à jour, `updated.isActive ? await this.sessions.reactiverCompte(membreId) : await this.sessions.desactiverCompte(membreId)` (`this.sessions` est déjà injecté). Réponse inchangée.

### 9. Nom des sessions web (`src/auth/client.ts`, modifier) (D07)

- Exporter `libelleNavigateur(userAgent: string | undefined): string | undefined` : `undefined` si absent ou vide. Navigateur, premier qui correspond : `/Edg\//` Edge, `/OPR\/|Opera/` Opera, `/SamsungBrowser/` Samsung Internet, `/Firefox\//` Firefox, `/Chrome\//` Chrome, `/Safari\//` Safari, sinon « Navigateur ». Système, premier qui correspond : `/Windows/` Windows, `/Android/` Android, `/iPhone|iPad|iPod/` iOS, `/Mac OS X|Macintosh/` macOS, `/Linux/` Linux, sinon aucun. Résultat `"<navigateur> sur <système>"` ou `"<navigateur>"` seul, tronqué à 100 caractères.
- `lireInfosClient`, branche WEB : `const nom = libelleNavigateur(<en-tête user-agent, premier élément s'il est en tableau>)` ; renvoyer `nom ? { type: WEB, nomAppareil: nom } : { type: WEB }` (sans clé `nomAppareil` quand l'en-tête manque, pour garder les tests existants).

### 10. Socket (`src/chat/chat.gateway.ts`, modifier) (D04)

- Injecter `RevocationService` (4e paramètre `private readonly revocation: RevocationService`). Implémenter `OnModuleInit` : `onModuleInit() { this.revocation.enregistrerDiffuseur((evt) => this.diffuserRevocation(evt)); }`.
- `handleConnection` devient `async` :
  1. extraction et `verify` inchangés, typer `verify<{ userId: string; sid?: string }>` ;
  2. `const code = await this.revocation.verifier({ userId, sid: decoded.sid })` ; si `code` : `client.emit('sessionRevoquee', { code, message: messagePourCode(code) })`, `client.disconnect(true)`, `return` (sans enregistrer `userId` dans `client.data` ni dans `userSockets`) ;
  3. sinon : `client.data.userId = userId`, `client.data.sid = decoded.sid` si présent, `void client.join(\`utilisateur:${userId}\`)`, et si `sid` `void client.join(\`session:${sid}\`)`, puis l'ajout existant à `userSockets`.
  Le `catch` existant (`client.disconnect()`) reste.
- `diffuserRevocation(evt: EvenementRevocation): void` (publique pour les tests) : `salles = evt.sessionIds.map((id) => \`session:${id}\`)` ; si `evt.code === 'COMPTE_DESACTIVE'`, ajouter `utilisateur:${evt.userId}` ; si `salles` vide, `return` ; `this.server.to(salles).emit('sessionRevoquee', { code: evt.code, message: messagePourCode(evt.code) })` ; puis `const t = setTimeout(() => this.server.in(salles).disconnectSockets(true), DELAI_DECONNEXION_SOCKET_MS); t.unref?.();`.
- Ne rien changer d'autre dans le gateway (chat, SOS, `userSockets`).

### 11. Documentation (`CLAUDE.md` du dépôt back, modifier)

Dans la puce « Sessions (TB3) » : remplacer la ligne « Hors TB3 (TB4) : ... » par une ligne « Révocation (TB4) » qui décrit en 4 à 6 lignes : routes `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/sessions/revoquer-autres` ; `deconnecterAutresAppareils` (défaut true) au changement de mot de passe, réinitialisation et désactivation qui révoquent tout ; contrôle dans `AuthGuard` par `RevocationService` (état en Redis, 30 s si valide, 16 min si révoqué, repli PostgreSQL) ; événement socket `sessionRevoquee` `{ code, message }` puis déconnexion ; purge horaire des sessions expirées ou révoquées depuis plus de 30 jours. Dans « Dette/risques », puce « Mobile » : retirer « Reste TB4 (révocation) » et « Les sessions expirées ou révoquées ne sont pas encore purgées. ».

### 12. Tests (Jest, doublures, aucune base ni Redis réels)

Créer ou compléter, en suivant le style des specs existants (`sessions.service.spec.ts`, `chat.gateway.spec.ts`) :
- `src/auth/revocation.service.spec.ts` (nouveau) : (a) `ok` en cache donne null sans lecture Prisma ; (b) code en cache renvoyé sans lecture Prisma ; (c) clé absente : lecture Prisma, `set` avec `'NX'` et TTL 30 pour un état valide, `set` sans NX et TTL 960 pour une session révoquée ; (d) session révoquée avec raison COMPTE_DESACTIVE donne COMPTE_DESACTIVE ; session d'un autre utilisateur donne SESSION_EXPIREE ; (e) jeton sans sid : contrôle par compte (inactif donne COMPTE_DESACTIVE) ; (f) `get` qui rejette : lecture Prisma, aucun `set` ; (g) `get` qui ne répond jamais : résultat obtenu par Prisma après le délai (horloge simulée `jest.useFakeTimers` et `advanceTimersByTimeAsync`, ou `jest.useRealTimers` avec un délai court) ; (h) `signaler` écrit chaque session en TTL 960, écrit la clé de compte pour COMPTE_DESACTIVE, appelle les diffuseurs, et ne lève pas si Redis rejette.
- `src/common/guards/auth.guard.spec.ts` (nouveau) : jeton valide et `verifier` null donne true et `req.user` posé ; `verifier` SESSION_REVOQUEE donne 401 avec `getResponse()` contenant `code: 'SESSION_REVOQUEE'` et le message `MESSAGES_SESSION.revoquee` ; COMPTE_DESACTIVE donne le message `compteDesactive` ; jeton invalide garde « Token invalide ou expiré. » sans appel à `verifier`.
- `src/auth/sessions.service.spec.ts` : adapter les doublures (ajouter `session.findMany`, `session.deleteMany`, une doublure `revocation` avec `signaler` et `effacerCompte`) ; tests existants verts ; nouveaux tests : `lister` (filtre, repli de nom, appareil courant en tête, drapeau false donne []) ; `revoquerUne` (révoque et signale avec SESSION_REVOQUEE ; session absente donne NotFoundException) ; `revoquerAutres` exclut le sid courant ; `revoquerToutes` drapeau false vide `User.refreshToken` ; `desactiverCompte` signale COMPTE_DESACTIVE une seule fois, y compris sans session ; `purgerSessionsExpirees` (filtre à 30 jours) ; la réutilisation et la déconnexion appellent `signaler`.
- `src/auth/auth.service.spec.ts` : `changePassword` révoque les autres par défaut (appelle `revoquerAutres(userId, sid, 'MOT_DE_PASSE_MODIFIE')`), ne révoque pas avec `deconnecterAutresAppareils: false` ; `resetPassword` appelle `revoquerToutes`. Adapter les tests existants qui attendaient `data: null` au changement de mot de passe.
- `src/auth/auth.controller.spec.ts` : adapter le constructeur ; DELETE de la session courante web efface le cookie, mobile ne l'efface pas ; revoquer-autres renvoie le bon message selon le nombre.
- `src/auth/client.spec.ts` : `libelleNavigateur` (Chrome sur Windows, Safari sur iOS, en-tête absent donne undefined) ; WEB avec user-agent renvoie `nomAppareil`.
- `src/chat/chat.gateway.spec.ts` : adapter le constructeur ; connexion avec session révoquée : `emit('sessionRevoquee', ...)` puis `disconnect(true)`, pas de `join` ; connexion valide : `join` de `utilisateur:<id>` et `session:<sid>` ; `diffuserRevocation` : `to([...salles])` puis `disconnectSockets(true)` après 1000 ms (horloge simulée), salle utilisateur ajoutée seulement pour COMPTE_DESACTIVE.
- `src/user/user.service.spec.ts` : adapter le constructeur (6e argument) ; `toggleActive` vers inactif appelle `desactiverCompte`, vers actif `reactiverCompte`.

### 13. Parcours réel (preuve du critère TB4)

L'API tourne dans Docker (port hôte 3101, `DEMO_MODE=true`). Après `docker compose restart backend` (depuis la racine du monorepo) et attente que `curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/auth/verify` renvoie 401 (réessai toutes les 3 s, 40 fois au plus), écrire avec l'outil Write le script `D:/tmp/tb4-parcours.sh` (hors dépôt, jamais par redirection shell), lancé par `bash D:/tmp/tb4-parcours.sh`, en `curl` et `node -e` pour lire le JSON (pas de `jq`). Le script affiche une ligne `OK <étape>` ou `ECHEC <étape> : <statut> <corps>` par étape et se termine par `PARCOURS OK` si tout passe :
- (A) `GET /auth/demo/comptes`, choisir le premier compte de rôle PATIENT ;
- (B) connexion mobile `POST /auth/demo/connexion` avec `X-Client: mobile` et `{ userId, deviceId: "tb4-parcours-1", plateforme: "android", nomAppareil: "Téléphone de test" }` : jeton d'accès Am, refresh Rm, sessionId Sm ;
- (C) connexion web `POST /auth/demo/connexion` sans en-tête, `User-Agent` de Chrome sur Windows : jeton Aw ;
- (D) `GET /auth/sessions` avec Aw : 200, contient Sm avec `nom` « Téléphone de test », `plateforme` android, `appareilCourant` false, et une session web `appareilCourant` true dont le `nom` est « Chrome sur Windows » ;
- (E) `GET /auth/me` avec Am : 200 ;
- (F) `DELETE /auth/sessions/<Sm>` avec Aw : 200 ; noter l'heure ;
- (G) aussitôt `GET /auth/me` avec Am : 401 et `code` SESSION_REVOQUEE (critère : moins d'une minute, ici immédiat) ;
- (H) `POST /auth/refresh` mobile avec Rm dans le corps : 401 et `code` SESSION_REVOQUEE ;
- (I) `GET /auth/me` avec Aw : toujours 200 ;
- (J) seconde connexion mobile (`deviceId` "tb4-parcours-2") : jeton Am2 ; `POST /auth/sessions/revoquer-autres` avec Aw : 200, `data.nombre` au moins 1 ; `GET /auth/me` avec Am2 : 401 SESSION_REVOQUEE ; Aw : 200 ;
- (K) `DELETE /auth/sessions/00000000-0000-0000-0000-000000000000` avec Aw : 404 et message « Cet appareil est introuvable ou déjà déconnecté. » ;
- (L) `POST /auth/logout` avec Aw (nettoyage).
Aucune valeur de jeton n'est affichée par le script (seulement statuts et codes).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Spécifiques :
- Aucune migration Prisma, aucune modification de `prisma/schema.prisma`, aucune nouvelle dépendance npm, aucune nouvelle variable d'environnement.
- Textes vus par l'utilisateur (champ `message`, payload `sessionRevoquee`) en français, sans terme interdit (section 14 de docs/ORCHESTRATOR.md : ni token, ni session, ni socket, ni serveur...) ; les messages déjà existants ne sont pas réécrits. Aucun tiret cadratin ni demi-cadratin nulle part.
- Commentaires de code en français. Identifiants existants conservés.
- Jamais de valeur de jeton, de refresh ou de secret dans un log.
- Lint des fichiers touchés (D17 du run TB3) : si un fichier touché a de la dette de formatage, `eslint --fix` sur ce fichier ; une erreur de typage préexistante qui ne se corrige pas simplement est neutralisée par un `eslint-disable` de fichier justifié « Dette de typage préexistante, backlog points 21 et 22 ». Aucune nouvelle erreur dans le code ajouté.
- Ne pas commiter. Ne pas toucher aux fichiers du dépôt racine.

## Done when

Toutes les commandes lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :
1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/auth/revocation.service.ts src/auth/revocation.service.spec.ts src/auth/sessions.constants.ts src/auth/sessions.service.ts src/auth/sessions.service.spec.ts src/auth/auth.module.ts src/auth/auth.controller.ts src/auth/auth.controller.spec.ts src/auth/auth.service.ts src/auth/auth.service.spec.ts src/auth/dto/auth.dto.ts src/auth/client.ts src/auth/client.spec.ts src/common/guards/auth.guard.ts src/common/guards/auth.guard.spec.ts src/chat/chat.gateway.ts src/chat/chat.gateway.spec.ts src/chat/chat.module.ts src/user/user.service.ts src/user/user.service.spec.ts src/structure/structure.service.ts` : aucune erreur (ajuster la liste aux seuls fichiers réellement touchés ; aucun autre fichier n'est attendu).
3. `docker compose exec -T backend npx jest` : tous les tests verts, dont les nouveaux tests listés en section 12.
4. `bash D:/tmp/tb4-parcours.sh` : dernière ligne `PARCOURS OK`, étape (G) en 401 SESSION_REVOQUEE.
5. `git -C back_medconnect diff --name-only` ne liste que des fichiers de la section 2 du Done when, plus `CLAUDE.md` ; `git -C back_medconnect status --porcelain` ne montre comme nouveaux fichiers que `src/auth/revocation.service.ts`, `src/auth/revocation.service.spec.ts`, `src/common/guards/auth.guard.spec.ts` (hors docs/plans).
6. `git -C back_medconnect diff -U0 | grep -P "^\+.*[\x{2013}\x{2014}]"` ne renvoie rien (aucun tiret interdit ajouté).

## Return

Liste des fichiers modifiés et créés, puis une ligne par commande du Done when : commande, résultat en une ligne (ex. « jest : 31 suites, 190 tests, tous verts »). Ou un bloc BLOCKED. Pas de prose. Écrire aussi ce retour dans `docs/plans/runs/2026-10-20-lot1/rapports/B1-codeur.md` (seule exception autorisée à « ne pas modifier docs/plans/ »).

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T backend npx tsc --noEmit | aucune erreur | voir rapports/B1-chef.md
docker compose exec -T backend npx eslint <21 fichiers de la tâche> | 0 erreur, 16 avertissements no-unsafe-argument | voir rapports/B1-chef.md
docker compose exec -T backend npx jest | 33 suites, 383 tests, tous verts | voir rapports/B1-chef.md
bash D:/tmp/tb4-parcours.sh | PARCOURS OK, G en 401 SESSION_REVOQUEE immédiat | voir rapports/B1-chef.md
