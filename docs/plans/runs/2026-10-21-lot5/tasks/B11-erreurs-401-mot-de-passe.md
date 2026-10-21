# B11 - Changement de mot de passe : plus de 401 pour une erreur de saisie, codes machine sur les 401 de session

Tier: spécifié (agent implementeur-specifie)
Audience: mixte (API dev ; deux textes visibles par l'utilisateur final, non-dev, fournis mot pour mot ci-dessous)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot5-back` (arbre principal ; ne pas créer de branche ; NE PAS COMMITER : l'orchestrateur commite après validation). Rien à modifier dans le dépôt racine, ni dans `front_medconnect` ou `mobile_medconnect`.
Décisions de référence : `docs/plans/runs/2026-10-21-lot5/decisions.md`, D90 à D96.

## Audit (état avant correction, établi par le chef d'équipe, à ne pas refaire)

1. `src/auth/auth.service.ts`, `changePassword` (vers la l. 469 à 472) : un mot de passe actuel faux lève `UnauthorizedException('Le mot de passe actuel est incorrect')` (401). Le front prend tout 401 pour une session expirée : il rafraîchit, réessaie (nouveau 401) et peut déconnecter l'utilisateur.
2. `src/common/guards/auth.guard.ts` : les 401 « jeton manquant » (l. 31 à 33) et « jeton invalide ou expiré » (l. 42) n'ont pas de code machine ; seuls les 401 de révocation en portent un (`SESSION_REVOQUEE`, `SESSION_EXPIREE`, `COMPTE_DESACTIVE`). Le front ne peut donc pas distinguer « jeton d'accès à renouveler » d'une autre 401.
3. Autres `UnauthorizedException` (relevé complet par grep) :
   - `auth.service.ts` l. 372 (`editProfile`) et l. 459 (`changePassword`) : « Utilisateur non trouvé ou inactif », sans code, sur des routes authentifiées. À traiter (D92).
   - `structure.service.ts` l. 172 (`getPublicStructureDetails`, route publique `GET /structures/:id` consultée par des patients connectés) : « Structure introuvable ou inactive » en 401. À traiter (D93).
   - NE PAS TOUCHER (D94) : `auth.service.ts` l. 140, 144, 160 (`login`), l. 565 (`resetPassword`), l. 604 (`verifyResetToken`), l. 653 (refresh, déjà codé `SESSION_EXPIREE`) ; `structure.service.ts` l. 80 et 205 (lien d'invitation) ; `sessions.service.ts` (déjà codé) ; `src/auth/jwt.strategy.ts` (code mort).
4. Validation : `src/common/filters/erreur-validation.ts` (`champsFautifs`, `fabriquerErreurValidation`) et `src/common/filters/all-exceptions.filter.ts` gardent déjà `champs` (nom et contraintes) en production, mais le message de la 400 est le message générique `MESSAGES.validation` et rien ne dit la règle du nouveau mot de passe (les messages du DTO ne partent qu'en `details`, hors production).
5. Le filtre global n'attribue un code par défaut qu'aux 403 (`PERMISSION_REFUSEE`). Ne PAS en ajouter pour les 401.

## Spec

### 1. `src/common/filters/codes-erreur.ts`

Ajouter au tableau `CODES_ERREUR`, à la fin, dans cet ordre, chacun précédé de son commentaire d'une ligne :

```ts
  // Jeton d'accès absent (401) : le client peut tenter un rafraîchissement.
  'JETON_ABSENT',
  // Jeton d'accès expiré (401) : le client rafraîchit puis rejoue la requête.
  'JETON_EXPIRE',
  // Jeton d'accès illisible ou mal signé (401) : le client peut tenter un rafraîchissement.
  'JETON_INVALIDE',
  // Mot de passe actuel incorrect lors d'un changement de mot de passe (400), la session reste valide.
  'MOT_DE_PASSE_ACTUEL_INCORRECT',
```

Ne rien changer d'autre dans ce fichier.

### 2. `src/common/guards/auth.guard.ts`

- Import : `import { JwtService, TokenExpiredError } from '@nestjs/jwt';` (`TokenExpiredError` est réexporté par `@nestjs/jwt`).
- Jeton absent : `throw new UnauthorizedException({ message: 'Token manquant. Veuillez vous connecter.', code: 'JETON_ABSENT' });`
- Bloc `catch` de `verifyAsync` : capturer l'erreur (`catch (e) {`) et lever `new UnauthorizedException({ message: 'Token invalide ou expiré.', code: e instanceof TokenExpiredError ? 'JETON_EXPIRE' : 'JETON_INVALIDE' })`.
- Messages inchangés (D91). Bloc de révocation inchangé. Pas d'autre modification.

### 3. `src/auth/auth.service.ts`

- Ajouter `BadRequestException` à l'import de `@nestjs/common`.
- `changePassword`, mot de passe actuel faux : remplacer le `throw` par

```ts
      throw new BadRequestException({
        message: 'Le mot de passe actuel est incorrect.',
        code: 'MOT_DE_PASSE_ACTUEL_INCORRECT',
      });
```

  Ajouter juste au-dessus un commentaire d'une ligne : « 400 et non 401 : la session est valide, seul le champ saisi est faux (le front rafraîchit sur 401). »
- `editProfile` (l. 372) et `changePassword` (l. 459), utilisateur introuvable ou inactif : remplacer chacun des deux `throw` par

```ts
      throw new UnauthorizedException({
        message: MESSAGES_SESSION.compteDesactive,
        code: 'COMPTE_DESACTIVE',
      });
```

  (`MESSAGES_SESSION` est déjà importé.)
- Ne toucher à aucune autre `UnauthorizedException` de ce fichier (login, reset, verifyResetToken, refresh).

### 4. `src/structure/structure.service.ts`

`getPublicStructureDetails` (l. 172) : `throw new NotFoundException('Structure introuvable ou inactive');` à la place de l'`UnauthorizedException` (message identique ; `NotFoundException` déjà importé). Laisser l'import `UnauthorizedException` (encore utilisé l. 80 et 205). Rien d'autre dans ce fichier.

### 5. `src/common/filters/erreur-validation.ts`

- `ChampFautif` gagne un champ facultatif, avec commentaire :

```ts
export interface ChampFautif {
  champ: string;
  contraintes: string[];
  /** Règle lisible, texte constant du code (jamais la saisie), seulement pour les champs de MESSAGES_REGLES. */
  message?: string;
}
```

- Ajouter, exporté :

```ts
/** Message lisible de la règle d'un champ, choisi par le nom du champ (texte constant). */
export const MESSAGES_REGLES: ReadonlyMap<string, string> = new Map([
  [
    'newPassword',
    'Le nouveau mot de passe doit contenir de 8 à 50 caractères, dont au moins une majuscule, une minuscule et un chiffre.',
  ],
]);
```

- Dans `champsFautifs`, à l'endroit où l'entrée est poussée : clé de recherche = `erreur.property` (le nom du champ lui-même, pas le chemin) ; si `MESSAGES_REGLES.get(erreur.property)` renvoie une chaîne, pousser `{ champ: chemin, contraintes: [...], message }`, sinon pousser l'objet actuel SANS clé `message` (les tests existants comparent avec `toEqual`).
- `fabriquerErreurValidation` inchangée.

### 6. `src/common/filters/all-exceptions.filter.ts`

- `assainirChamps` : en plus de `champ` et `contraintes`, recopier `message` seulement si `typeof message === 'string'` ; sinon ne pas créer la clé. Aucune autre clé.
- Dans `construireCorps`, juste après `resultat.champs = assainirChamps(brut.champs);` (même bloc `if`) :

```ts
          // Un seul champ fautif portant sa règle lisible : elle remplace le message générique.
          const [seul] = resultat.champs;
          if (resultat.champs.length === 1 && seul.message) {
            resultat.message = seul.message;
          }
```

- Ne PAS ajouter de code par défaut aux 401 (D91). Rien d'autre à changer (le 400 `MOT_DE_PASSE_ACTUEL_INCORRECT` passe déjà : message de projet conservé, code du catalogue recopié).

### 7. Tests Jest (compléter les fichiers existants, sauf le dernier)

a. `src/common/guards/auth.guard.spec.ts`
   - « jeton absent » : vérifier aussi `e.getResponse()` `toMatchObject({ code: 'JETON_ABSENT' })` (message inchangé déjà testé).
   - « jeton invalide » (rejet `new Error('signature')`) : ajouter `code: 'JETON_INVALIDE'`.
   - Nouveau : `verifyAsync` rejette `new TokenExpiredError('jwt expired', new Date())` (import depuis `@nestjs/jwt`) : 401, `code: 'JETON_EXPIRE'`, message `'Token invalide ou expiré.'`, `revocation.verifier` non appelé.

b. `src/auth/auth.service.spec.ts`, dans `describe('changePassword : révocation des autres appareils')` ou un nouveau `describe('changePassword : erreurs')` :
   - mot de passe actuel faux (`currentPassword: 'Mauvais-mdp-1'`, utilisateur `utilisateur()`) : rejet `BadRequestException`, `getResponse()` `toMatchObject({ code: 'MOT_DE_PASSE_ACTUEL_INCORRECT', message: 'Le mot de passe actuel est incorrect.' })`, `prisma.user.update` et `sessions.revoquerAutres` non appelés.
   - utilisateur inactif (`utilisateur({ isActive: false })`) : rejet `UnauthorizedException` avec `code: 'COMPTE_DESACTIVE'` et `message: MESSAGES_SESSION.compteDesactive`.
   - `editProfile` avec `findUnique` résolu à `null` : même 401 `COMPTE_DESACTIVE`.

c. `src/common/filters/erreur-validation.spec.ts` : nouveau test. Erreur `{ property: 'newPassword', value: 'SECRET-mdp', constraints: { isLength: 'a', matches: 'b' }, children: [] }` : `champsFautifs` renvoie `[{ champ: 'newPassword', contraintes: ['isLength', 'matches'], message: MESSAGES_REGLES.get('newPassword') }]` ; `JSON.stringify` de `fabriquerErreurValidation([...]).getResponse()` ne contient pas `SECRET-mdp`. Les tests existants restent verts sans modification.

d. `src/common/filters/all-exceptions.filter.spec.ts` :
   - Dans `describe('avec le vrai ValidationPipe')` (ou un `describe` voisin construit pareil), avec `ChangePasswordDto` (import `src/auth/dto/auth.dto`) et le corps `{ currentPassword: 'Ancien-mdp-1', newPassword: 'court' }`, `NODE_ENV` forcé à `production` puis restauré dans `finally` (comme le test existant) : statut 400, `code: 'VALIDATION'`, `champs` égal à `[{ champ: 'newPassword', contraintes: expect.arrayContaining(['isLength', 'matches']), message: MESSAGES_REGLES.get('newPassword') }]`, `message` du corps égal à `MESSAGES_REGLES.get('newPassword')`, pas de `details`, et ni `court` ni `Ancien-mdp-1` dans `JSON.stringify` du corps.
   - Deux champs fautifs dont `newPassword` (`{ currentPassword: '', newPassword: 'court' }`) : `message` reste `MESSAGES.validation`, l'entrée `newPassword` garde son `message`.
   - `assainirChamps` : `champs: [{ champ: 'a', contraintes: ['b'], message: 'Règle' }, { champ: 'c', contraintes: [], message: 3 }]` avec `code: 'VALIDATION'` et `message: ['x']` : `champs` vaut `[{ champ: 'a', contraintes: ['b'], message: 'Règle' }, { champ: 'c', contraintes: [] }]` et le `message` du corps reste `MESSAGES.validation` (deux entrées).
   - `new BadRequestException({ message: 'Le mot de passe actuel est incorrect.', code: 'MOT_DE_PASSE_ACTUEL_INCORRECT' })` : corps `{ statusCode: 400, message: 'Le mot de passe actuel est incorrect.', error: 'Saisie invalide', code: 'MOT_DE_PASSE_ACTUEL_INCORRECT' }` (`toEqual`).
   - `new UnauthorizedException('Lien expiré')` : le corps n'a pas de propriété `code` (aucun code par défaut sur 401).

e. Nouveau fichier `src/structure/structure.details-publics.spec.ts` : construire `StructureService` comme dans `structure.membre-email.spec.ts` (six dépendances simulées, `prisma.structure.findUnique` résolu à `null`) ; `getPublicStructureDetails('inconnue')` rejette une `NotFoundException` de message `'Structure introuvable ou inactive'`.

Textes visibles : exactement ceux donnés ci-dessus ; aucun tiret cadratin ni demi-cadratin dans le code, les commentaires et les tests.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Fichiers autorisés (et seulement eux) : `src/common/filters/codes-erreur.ts`, `src/common/guards/auth.guard.ts`, `src/auth/auth.service.ts`, `src/structure/structure.service.ts`, `src/common/filters/erreur-validation.ts`, `src/common/filters/all-exceptions.filter.ts`, `src/common/guards/auth.guard.spec.ts`, `src/auth/auth.service.spec.ts`, `src/common/filters/erreur-validation.spec.ts`, `src/common/filters/all-exceptions.filter.spec.ts`, `src/structure/structure.details-publics.spec.ts` (nouveau). Ne pas toucher aux DTO, au contrôleur, à Swagger, à `jwt.strategy.ts`, à `sessions.service.ts`, ni au front. Ces changements ne fonctionnent qu'ensemble : tout est dans cette tâche.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/common/filters/codes-erreur.ts src/common/guards/auth.guard.ts src/auth/auth.service.ts src/structure/structure.service.ts src/common/filters/erreur-validation.ts src/common/filters/all-exceptions.filter.ts src/common/guards/auth.guard.spec.ts src/auth/auth.service.spec.ts src/common/filters/erreur-validation.spec.ts src/common/filters/all-exceptions.filter.spec.ts src/structure/structure.details-publics.spec.ts` : aucune erreur ni avertissement (ces fichiers sont propres avant la tâche).
3. `docker compose exec -T backend npx jest` : toutes les suites vertes, dont les nouveaux tests de la section 7.
4. `git -C back_medconnect grep -n "Le mot de passe actuel est incorrect'" -- src/auth/auth.service.ts` : aucun résultat (plus de 401) ; `git -C back_medconnect grep -n "MOT_DE_PASSE_ACTUEL_INCORRECT" -- src/auth/auth.service.ts src/common/filters/codes-erreur.ts` : une ligne dans chaque fichier.
5. `git -C back_medconnect diff --name-only` et `git -C back_medconnect status --short` : uniquement des fichiers de la liste autorisée.
6. Dans Git Bash : `git -C back_medconnect diff | LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]"` puis `LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]" back_medconnect/src/structure/structure.details-publics.spec.ts` : aucun résultat.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
