# T03 - Connexion, inscription, démo et invitation par session d'appareil

Tier: spécifié (agent implementeur-specifie)
Audience: non-dev pour les messages d'erreur, dev pour le contrat JSON
Visuel: n/a
Background-safe: non, car docker compose exec sur l'arbre principal

Arbre de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/back_medconnect`, branche `orch/tb3-sessions`. Ne commite pas : l'orchestrateur commite. Commandes `docker compose` depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` ; dépôt back monté sur `/app` dans le conteneur `backend`.

Prérequis : T02 fait. Lire `src/auth/sessions.service.ts` et `src/auth/sessions.constants.ts` (ne pas les modifier), puis `docs/plans/runs/2026-10-20-tb3-sessions/decisions.md` (D08, D09, D12, D14, D15, D17).

## Spec

Brancher l'ouverture de session (login, inscription, connexion démo, configuration d'une structure par invitation) sur `SessionsService`, et ajouter le contrat mobile. Le refresh et le logout sont traités en T04 : ne pas toucher `refreshAccessToken`, `logout`, ni les routes `refresh` et `logout` ici.

### 1. DTO appareil : nouveau fichier `src/auth/dto/infos-appareil.dto.ts`

`export class InfosAppareilDto` avec quatre champs facultatifs, `@ApiPropertyOptional` (description en français, préciser « mobile seulement ») :
- `deviceId?: string` : `@IsOptional() @IsString() @Length(8, 128, { message: "L'identifiant de l'appareil n'est pas valide." }) @Matches(/^[A-Za-z0-9._:-]+$/, { message: "L'identifiant de l'appareil n'est pas valide." })` ;
- `plateforme?: string` : `@IsOptional() @IsIn(['android', 'ios'], { message: 'La plateforme doit être android ou ios.' })` ;
- `nomAppareil?: string` : `@IsOptional() @IsString() @MaxLength(100)` ;
- `versionApp?: string` : `@IsOptional() @IsString() @MaxLength(32)`.

Puis `LoginDto extends InfosAppareilDto` (`src/auth/dto/login.dto.ts`), `RegisterDto extends InfosAppareilDto` (`src/auth/dto/register.dto.ts`), `ConnexionDemoDto extends InfosAppareilDto` (`src/demo/dto/connexion-demo.dto.ts`). Aucun autre champ ne change.

### 2. Détection du client : nouveau fichier `src/auth/client.ts`

```ts
/** Type de client : MOBILE si l'en-tête X-Client vaut « mobile » et que les sessions par appareil sont actives, sinon WEB. */
export function typeClient(req: Request): SessionClientType
/** Infos de session à partir de la requête et du DTO ; en mobile, deviceId et plateforme sont obligatoires. */
export function lireInfosClient(req: Request, dto?: InfosAppareilDto): InfosClient
```
- `typeClient` : lit `req.headers['x-client']` (chaîne ; si tableau, premier élément), `trim().toLowerCase() === 'mobile'` ET `estSessionsMultiAppareilsActif()` : `MOBILE` ; sinon `WEB`.
- `lireInfosClient` : WEB : `{ type: WEB }` (les champs appareil du DTO sont ignorés). MOBILE : si `!dto?.deviceId || !dto?.plateforme` : `throw new BadRequestException({ message: MESSAGES_SESSION.appareilManquant, code: 'VALIDATION' })` ; sinon `{ type: MOBILE, deviceId, plateforme, nomAppareil, versionApp }`.
- `Request` vient de `express`, `InfosClient` de `./sessions.service`.

### 3. `src/auth/auth.service.ts`

- Injecter `private readonly sessions: SessionsService` en DERNIER paramètre du constructeur.
- Nouvelle méthode privée `async emettreJetons(user: UtilisateurJeton, res: Response, client: InfosClient)` :
  `const jetons = await this.sessions.ouvrir(user, client);`
  WEB : `this.sessions.poserCookie(res, jetons.refreshToken, jetons.dureeMs); return { access_token: jetons.access_token };`
  MOBILE : aucun cookie ; `return { access_token, refreshToken, expiresIn, sessionId }` (valeurs de `jetons`).
- `login(loginDto, res, ip, client: InfosClient)` : inchangé sauf l'appel final `this.ouvrirSession(user, res, client)`.
- `connexionDemo(userId, res, client: InfosClient)` : idem.
- `ouvrirSession(user, res, client)` : remplacer la génération des jetons, l'écriture `user.update` du refresh et le `res.cookie` par `const jetons = await this.emettreJetons({ id: user.id, role: user.role, structureId: user.structureId }, res, client);` puis `data: { ...jetons, user: { ...champs actuels inchangés } }`. Message et `success` inchangés. Mettre à jour le commentaire : web, refresh uniquement dans le cookie httpOnly ; mobile, refresh dans le JSON, sans cookie.
- `register(registerDto, res, client: InfosClient)` : remplacer le bloc `generateTokens` + `user.update` + `res.cookie` par `const jetons = await this.emettreJetons({ id: user.id, role: user.role, structureId: null }, res, client);` puis `data: { ...jetons, user: { ...champs actuels inchangés } }`. L'email de bienvenue reste.
- `generateTokens` et `generateToken` : NE PAS supprimer. Ajouter au-dessus de chacune le commentaire `// Inutilisée depuis TB3 (sessions par appareil, SessionsService) ; à retirer avec la colonne User.refreshToken.`
- Vérifier par grep que `ouvrirSession`, `register`, `connexionDemo` n'écrivent plus `refreshToken` dans `prisma.user`.

### 4. `src/auth/auth.controller.ts`

- `register` : ajouter `@Req() req: Request` et passer `lireInfosClient(req, dto)`.
- `login` : passer `lireInfosClient(req, dto)` en quatrième argument.
- Sur `register` et `login`, ajouter `@ApiHeader({ name: 'X-Client', required: false, description: "« mobile » pour l'application mobile : refresh renvoyé dans le JSON (refreshToken, expiresIn, sessionId), sans cookie ; deviceId et plateforme obligatoires. Absent : web, refresh dans le cookie httpOnly." })` (import depuis `@nestjs/swagger`).
- Ne pas toucher `refresh` ni `logout`.

### 5. `src/demo/demo.controller.ts`

Route `connexion` : ajouter `@Req() req: Request` (type `Request` importé d'`express`), passer `lireInfosClient(req, dto)` à `connexionDemo`, et le même `@ApiHeader`. Mettre à jour `src/demo/demo.controller.spec.ts` pour la nouvelle signature (doublure de requête `{ headers: {} }`), sans retirer de test.

### 6. `src/structure/structure.service.ts` (configuration par invitation)

- Injecter `private readonly sessions: SessionsService` (import `src/auth/sessions.service` ; `SessionsService` est exporté par `AuthModule`, déjà importé par `StructureModule`).
- Dans `setupStructure`, remplacer le bloc « Générer le JWT » + « Mettre à jour le refreshToken » + `res.cookie(...)` par :
  ```ts
  const jetons = await this.sessions.ouvrir(
    { id: result.admin.id, role: result.admin.role, structureId: structure.id },
    { type: SessionClientType.WEB },
  );
  this.sessions.poserCookie(res, jetons.refreshToken, jetons.dureeMs);
  ```
  et renvoyer `access_token: jetons.access_token`. Réponse inchangée par ailleurs. Retirer l'import `crypto` s'il n'est plus utilisé.
- Lint du fichier entier (D17) : `docker compose exec -T backend npx eslint --fix src/structure/structure.service.ts`, puis, pour les erreurs de typage préexistantes restantes (`no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-enum-comparison`), ajouter en tête du fichier :
  ```ts
  // Dette de typage préexistante, backlog points 21 et 22
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-enum-comparison */
  ```
  Ne corriger aucune autre logique du fichier.
- Même traitement `eslint --fix` (formatage seulement) pour `src/auth/dto/login.dto.ts` et `src/auth/dto/register.dto.ts`, qui ont une dette prettier.

### 7. `src/auth/auth.module.ts`

`signOptions: { expiresIn: '7d' }` devient `signOptions: { expiresIn: '15m' }` avec le commentaire `// Filet de sécurité : tout jeton signé sans durée explicite expire en 15 min (TB3).`

### 8. Tests : `src/auth/auth.service.spec.ts`

- Ajouter la doublure `sessions = { ouvrir: jest.fn().mockResolvedValue({ access_token: 'jwt-de-test', refreshToken: 'sid-1.' + 'a'.repeat(64), expiresIn: 900, sessionId: 'sid-1', dureeMs: 30 * 24 * 3600 * 1000 }), poserCookie: jest.fn(), effacerCookie: jest.fn(), renouveler: jest.fn(), fermer: jest.fn() }` passée en dernier argument du constructeur.
- Adapter les tests existants de `login`, `register` et `connexionDemo` qui vérifiaient `user.update` du refresh et `res.cookie` : ils vérifient désormais `sessions.ouvrir` (utilisateur et `{ type: 'WEB' }`) et `sessions.poserCookie` ; la réponse web ne contient ni `refreshToken` ni `sessionId`. Les tests de `refreshAccessToken` et `logout` restent inchangés dans cette tâche (le code de ces méthodes n'est pas modifié).
- Ajouter : `login` mobile (client `{ type: 'MOBILE', deviceId: 'appareil-test-1', plateforme: 'android' }`) : `poserCookie` jamais appelé, `data` contient `access_token`, `refreshToken`, `expiresIn`, `sessionId` et `user` ; `register` mobile : idem ; `connexionDemo` mobile : idem.
- Nouveau fichier `src/auth/client.spec.ts` : sans en-tête : WEB ; `X-Client: Mobile ` : MOBILE ; mobile sans `deviceId` : `BadRequestException` dont `getResponse()` contient `code: 'VALIDATION'` ; drapeau `SESSIONS_MULTI_APPAREILS='false'` : WEB même avec l'en-tête ; WEB ignore les champs appareil du DTO.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash (exception : `eslint --fix` lancé dans le conteneur sur les trois fichiers nommés). Commentaires en français, aucun tiret cadratin ni demi-cadratin. Ne pas modifier `sessions.service.ts` ni `sessions.constants.ts` (si un manque y est constaté : BLOCKED). Le web ne doit jamais recevoir le refresh dans le JSON.

## Done when

Depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` :
- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `docker compose exec -T backend npx eslint src/auth/dto/infos-appareil.dto.ts src/auth/dto/login.dto.ts src/auth/dto/register.dto.ts src/demo/dto/connexion-demo.dto.ts src/auth/client.ts src/auth/client.spec.ts src/auth/auth.service.ts src/auth/auth.service.spec.ts src/auth/auth.controller.ts src/auth/auth.module.ts src/demo/demo.controller.ts src/demo/demo.controller.spec.ts src/structure/structure.service.ts` : 0 erreur (avertissements tolérés).
- `docker compose exec -T backend npx jest src/auth src/demo/demo.controller.spec.ts` : tout vert.
- `docker compose exec -T backend npx jest` : toutes les suites passent.
- `grep -n "refreshToken: hashedRefresh\|res.cookie('refresh_token'" back_medconnect/src/auth/auth.service.ts back_medconnect/src/structure/structure.service.ts` : seule la méthode `refreshAccessToken` (traitée en T04) peut encore apparaître.
- `git -C back_medconnect status --porcelain` ne liste que les fichiers de la commande eslint ci-dessus.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
