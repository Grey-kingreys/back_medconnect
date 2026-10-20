# T04 - Refresh et déconnexion, web par cookie et mobile par le corps

Tier: spécifié (agent implementeur-specifie)
Audience: non-dev pour les messages d'erreur, dev pour le contrat JSON
Visuel: n/a
Background-safe: non, car docker compose exec sur l'arbre principal

Arbre de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/back_medconnect`, branche `orch/tb3-sessions`. Ne commite pas : l'orchestrateur commite. Commandes `docker compose` depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` ; dépôt back monté sur `/app` dans le conteneur `backend`.

Prérequis : T02 et T03 faits. Lire `src/auth/sessions.service.ts`, `src/auth/sessions.constants.ts`, `src/auth/client.ts` (ne pas les modifier) et `docs/plans/runs/2026-10-20-tb3-sessions/decisions.md` (D07, D08, D11, D12).

## Spec

Contrat (section 6.2 du plan mobile) :

| Route | Web (aucun en-tête X-Client) | Mobile (`X-Client: mobile`) |
|---|---|---|
| `POST /auth/refresh` | refresh lu UNIQUEMENT dans le cookie `refresh_token` ; réponse `{ data: { access_token }, message: 'Token renouvelé', success: true }` (inchangée) et nouveau cookie | refresh lu UNIQUEMENT dans le corps `{ refreshToken }` ; réponse `{ data: { access_token, refreshToken, expiresIn, sessionId }, message: 'Token renouvelé', success: true }`, aucun cookie |
| `POST /auth/logout` | jeton d'accès et/ou cookie | jeton d'accès et/ou `{ refreshToken }` dans le corps (le refresh seul suffit) |

Le front web (`front_medconnect/src/lib/api_auth.ts`) appelle `POST /auth/refresh` et `POST /auth/logout` sans corps, avec `credentials: 'include'` et l'en-tête `Authorization` pour le logout : ce comportement DOIT continuer de fonctionner sans changement du front.

### 1. DTO : nouveau fichier `src/auth/dto/jeton-renouvellement.dto.ts`

```ts
/** Corps facultatif de POST /auth/refresh et POST /auth/logout (mobile seulement). */
export class JetonRenouvellementDto {
  @ApiPropertyOptional({ description: 'Refresh token du mobile (absent pour le web, qui utilise le cookie)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}
```

### 2. `src/auth/auth.service.ts`

- `async refreshAccessToken(refresh: string | undefined, res: Response, type: SessionClientType)` :
  - si `!refresh` : WEB, `this.sessions.effacerCookie(res)` ; puis `throw new UnauthorizedException({ message: MESSAGES_SESSION.expiree, code: 'SESSION_EXPIREE' })` ;
  - `try { jetons = await this.sessions.renouveler(refresh, type) } catch (e) { if (type === WEB) this.sessions.effacerCookie(res); throw e; }` ;
  - WEB : `this.sessions.poserCookie(res, jetons.refreshToken, jetons.dureeMs)` puis `return { data: { access_token: jetons.access_token }, message: 'Token renouvelé', success: true }` ;
  - MOBILE : `return { data: { access_token, refreshToken, expiresIn, sessionId }, message: 'Token renouvelé', success: true }` sans cookie.
  - Supprimer l'ancien corps de la méthode (lecture de `User.refreshToken`, qui vit maintenant dans le mode ancien de `SessionsService`).
- `async logout(entree: { refresh?: string; jetonAcces?: string }, res: Response, type: SessionClientType)` :
  - si `entree.jetonAcces` : `try { const p = await this.jwtService.verifyAsync<{ userId: string; sid?: string }>(entree.jetonAcces, { secret: process.env.JWT_SECRET }); userId = p.userId; sid = p.sid; } catch { /* jeton expiré ou invalide : la déconnexion continue avec le refresh */ }` ;
  - `await this.sessions.fermer({ refresh: entree.refresh, sid, userId })` ;
  - WEB : `this.sessions.effacerCookie(res)` ;
  - retourne toujours `{ data: null, message: 'Déconnexion réussie', success: true }`.
- `UserPayload` gagne `sid?: string`.

### 3. `src/auth/auth.controller.ts`

- `refresh(@Req() req, @Body() dto: JetonRenouvellementDto, @Res({ passthrough: true }) res)` :
  `const type = typeClient(req);`
  `const refresh = type === SessionClientType.MOBILE ? dto.refreshToken : req.cookies?.[NOM_COOKIE_REFRESH];`
  `return this.authService.refreshAccessToken(refresh, res, type);`
  Supprimer l'ancien `BadRequestException('refresh_token requis')` et l'import `BadRequestException` s'il devient inutile. Le mobile ne lit JAMAIS le cookie, le web ne lit JAMAIS le corps.
- `logout` : retirer `@UseGuards(AuthGuard)` (route publique, D11) ; garder `@ApiBearerAuth()` ; signature `logout(@Req() req, @Body() dto: JetonRenouvellementDto, @Res({ passthrough: true }) res)` ; `type = typeClient(req)` ; `refresh` lu comme pour `refresh` ; `jetonAcces` = partie après `Bearer ` de `req.headers.authorization` si le schéma est `Bearer`, sinon `undefined` ; appeler `this.authService.logout({ refresh, jetonAcces }, res, type)`.
- Swagger : sur `refresh` et `logout`, le même `@ApiHeader` X-Client que T03 ; `@ApiResponse({ status: 401, description: 'code SESSION_EXPIREE, SESSION_REVOQUEE, REFRESH_REUTILISE ou COMPTE_DESACTIVE' })` sur `refresh` ; résumé de `logout` : « Déconnexion de cet appareil (jeton d'accès ou refresh seul) ».

### 4. Tests

`src/auth/auth.service.spec.ts` : remplacer les tests de `refreshAccessToken` et `logout` (ancien comportement à refresh unique) par :
- refresh absent : 401 `SESSION_EXPIREE`, cookie effacé en web ;
- web : `sessions.renouveler(..., 'WEB')`, `poserCookie` appelé, `data` ne contient QUE `access_token` ;
- mobile : `data` contient `access_token`, `refreshToken`, `expiresIn`, `sessionId`, `poserCookie` jamais appelé ;
- échec de `renouveler` en web (doublure qui rejette une `UnauthorizedException` code `REFRESH_REUTILISE`) : cookie effacé et erreur propagée telle quelle ;
- logout avec jeton d'accès valide (doublure `jwtService.verifyAsync` résolue `{ userId: 'u1', sid: 'sid-1' }`) : `fermer` reçoit `sid` et `userId` ;
- logout avec jeton d'accès invalide (`verifyAsync` rejette) et refresh mobile : `fermer` reçoit le refresh, réponse 200 ;
- logout web : cookie effacé ; logout mobile : `effacerCookie` jamais appelé.
Ajouter `verifyAsync: jest.fn()` à la doublure `jwtService`.

Nouveau fichier `src/auth/auth.controller.spec.ts` (contrôleur instancié directement avec une doublure d'`AuthService`) :
- refresh web : cookie `refresh_token` transmis, un `refreshToken` du corps est IGNORÉ ;
- refresh mobile (`headers: { 'x-client': 'mobile' }`) : corps transmis, un cookie présent est IGNORÉ ;
- logout : extrait le jeton après `Bearer `, fonctionne sans en-tête `Authorization` ;
- `Reflect.getMetadata('__guards__', AuthController.prototype.logout)` est indéfini (route publique).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Commentaires en français, aucun tiret cadratin ni demi-cadratin. Ne pas modifier `sessions.service.ts`, `sessions.constants.ts`, `client.ts` (manque constaté : BLOCKED). Aucune modification du front.

## Done when

Depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` :
- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `docker compose exec -T backend npx eslint src/auth/dto/jeton-renouvellement.dto.ts src/auth/auth.service.ts src/auth/auth.service.spec.ts src/auth/auth.controller.ts src/auth/auth.controller.spec.ts` : 0 erreur.
- `docker compose exec -T backend npx jest src/auth` : tout vert.
- `docker compose exec -T backend npx jest` : toutes les suites passent.
- `grep -rn "refreshToken: hashed\|refresh_token requis" back_medconnect/src/auth` : aucune occurrence hors `sessions.service.ts`.
- `git -C back_medconnect status --porcelain` ne liste que les 5 fichiers de la commande eslint.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
