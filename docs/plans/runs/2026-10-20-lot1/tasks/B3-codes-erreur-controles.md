# B3 - TB2 : codes d'erreur stables, champs fautifs, contrôles serveur SOS et annulation de rendez-vous

Tier: spécifié (agent implementeur-specifie)
Audience: dev (contrat JSON des erreurs, lu par l'application mobile) ; non-dev pour les 4 nouveaux messages d'erreur affichés tels quels par le web (textes fixés ci-dessous, à recopier à l'identique)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot1-back` (arbre principal, ne pas créer de branche, NE PAS COMMITER : l'orchestrateur commite après validation).
Décisions de référence : `docs/plans/runs/2026-10-20-lot1/decisions.md`, D20 à D27.

## Spec

### Contexte (à lire avant de coder)

- Filtre global `src/common/filters/all-exceptions.filter.ts` : renvoie `{ statusCode, message, error }` (+ `details` hors production pour les 400 du ValidationPipe, + `code` si l'exception porte un code du catalogue `src/common/filters/codes-erreur.ts`). Tout autre champ de l'exception est perdu : c'est pourquoi `peutRelancerA` du 409 SOS n'arrive pas au client aujourd'hui (B18).
- Catalogue actuel `CODES_ERREUR` : `SESSION_EXPIREE`, `SESSION_REVOQUEE`, `REFRESH_REUTILISE`, `COMPTE_DESACTIVE`, `VALIDATION`.
- `ValidationPipe` global dans `src/main.ts` (whitelist, forbidNonWhitelisted, transform), sans `exceptionFactory` : la 400 porte un tableau de messages, sans nom de champ exploitable.
- SOS : `CarnetSanteController.createUrgence` (`src/carnet-sante/carnet-sante.controller.ts`, route `@Post('sos')`, vers la ligne 347) ; le contrôleur n'a que `AuthGuard` et `PermissionsGuard`, sans permission requise sur cette route : tout rôle connecté peut lancer un SOS. `req.user.role` est une chaîne (`'PATIENT'`, `'MEDECIN'`...). Le 409 anti-relance est levé dans `CarnetSanteService.createUrgence` (`src/carnet-sante/carnet-sante.service.ts`, vers la ligne 1403) avec `{ statusCode: 409, error: 'Conflict', message, peutRelancerA }`.
- Rendez-vous : `CarnetSanteService.updateRendezVousStatus` (vers la ligne 968) lit `rv.status` mais ne le regarde pas : le patient (`actorId === rv.patientId`) peut passer à `ANNULE` un rendez-vous `TERMINE`, `REFUSE` ou déjà `ANNULE`. Statuts (`AppointmentStatus`) : `PROGRAMME`, `CONFIRME`, `ANNULE`, `TERMINE`, `EN_ATTENTE`, `REFUSE`.
- Le web (`front_medconnect`) n'affiche que `message` : il ne doit rien voir changer. Il ne lit ni `code`, ni `champs`, ni `donnees`.

Tout ce qui suit est livré dans cette seule tâche (le contrat d'erreur et ses contrôles forment un tout testé ensemble).

### 1. Catalogue `src/common/filters/codes-erreur.ts`

- Remplacer le tableau par (ordre imposé, un commentaire court en français par code, au-dessus de chaque entrée) :
  `SESSION_EXPIREE`, `SESSION_REVOQUEE`, `REFRESH_REUTILISE`, `COMPTE_DESACTIVE`, `VALIDATION`, `PERMISSION_REFUSEE`, `SOS_ROLE_INTERDIT`, `SOS_DEJA_ACTIF`, `TRANSITION_INTERDITE`.
  Commentaires à utiliser :
  - SESSION_EXPIREE : session expirée, se reconnecter.
  - SESSION_REVOQUEE : session déconnectée depuis un autre appareil ou par sécurité.
  - REFRESH_REUTILISE : refresh déjà utilisé, session révoquée par sécurité.
  - COMPTE_DESACTIVE : compte désactivé par un administrateur.
  - VALIDATION : saisie invalide, champs fautifs dans `champs` (nom et contraintes, jamais la valeur).
  - PERMISSION_REFUSEE : accès refusé (attribué par défaut à toute 403 sans code).
  - SOS_ROLE_INTERDIT : l'alerte SOS est réservée aux patients.
  - SOS_DEJA_ACTIF : une alerte est déjà en cours, `donnees.peutRelancerA` donne l'heure de relance possible.
  - TRANSITION_INTERDITE : changement de statut impossible depuis le statut actuel.
- Remplacer la phrase « TB2 complétera ce catalogue. » du commentaire d'en-tête par : « Ajout pur : le corps garde `statusCode`, `message` et `error`. »
- `CodeErreur` et `estCodeErreur` inchangés.

### 2. Nouveau fichier `src/common/filters/erreur-validation.ts`

```ts
import { BadRequestException, type ValidationError } from '@nestjs/common';
```
(`ValidationError` est réexporté par `@nestjs/common` ; si tsc le refuse, l'importer depuis `class-validator`.)

- `export interface ChampFautif { champ: string; contraintes: string[] }`
- `export function champsFautifs(erreurs: ValidationError[], parent = ''): ChampFautif[]` : parcours récursif. Pour chaque erreur : `chemin = parent ? \`${parent}.${erreur.property}\` : erreur.property` ; si `erreur.constraints` a au moins une clé, ajouter `{ champ: chemin, contraintes: Object.keys(erreur.constraints) }` ; puis descendre dans `erreur.children ?? []` avec `chemin` comme parent (un élément de tableau donne un chemin du type `medicaments.0.nom`). Ne JAMAIS lire `erreur.value` ni `erreur.target`.
- `function messagesValidation(erreurs: ValidationError[]): string[]` (non exportée) : même parcours, renvoie la liste à plat de `Object.values(erreur.constraints)` (enfants compris). Sert seulement au champ `details` hors production, comme aujourd'hui.
- `export function fabriquerErreurValidation(erreurs: ValidationError[]): BadRequestException` : renvoie
  `new BadRequestException({ message: messagesValidation(erreurs), code: 'VALIDATION', champs: champsFautifs(erreurs) })`.
  Le `message` reste un tableau : le filtre continue de le remplacer par `MESSAGES.validation` (texte inchangé) et de mettre le tableau dans `details` hors production.
- Commentaire d'en-tête en français : fabrique branchée sur le ValidationPipe global ; les noms de champs et les contraintes partent au client, jamais la valeur saisie (données de santé).

### 3. `src/main.ts`

Ajouter `exceptionFactory: fabriquerErreurValidation` aux options du `ValidationPipe` global (import depuis `./common/filters/erreur-validation`, même style d'import que `AllExceptionsFilter` dans ce fichier). Ne rien toucher d'autre (l'avertissement eslint existant ligne 87 n'est pas à corriger).

### 4. Filtre `src/common/filters/all-exceptions.filter.ts`

- Importer `type ChampFautif` depuis `./erreur-validation`.
- `CorpsErreur` : ajouter `champs?: ChampFautif[];` et `donnees?: { peutRelancerA?: string };` (après `code`).
- Ajouter en haut du fichier, près de `LIBELLES` : `const DONNEES_AUTORISEES = ['peutRelancerA'] as const;` avec le commentaire « Champs d'une exception recopiés dans `donnees` (liste blanche ; TB10b ajoutera finDelaiAt). »
- Dans `construireCorps`, branche `HttpException`, après le calcul actuel de `code` :
  1. si `estCodeErreur(code)` : `resultat.code = code` (inchangé) ; sinon, si `statut === 403` : `resultat.code = 'PERMISSION_REFUSEE'`.
  2. si `resultat.code === 'VALIDATION'` et que `reponseBrute` est un objet dont `champs` est un tableau : `resultat.champs = assainirChamps(champs)`. Présent aussi en production.
  3. si `reponseBrute` est un objet : pour chaque clé de `DONNEES_AUTORISEES` dont la valeur est une chaîne, la recopier dans `resultat.donnees` (créé seulement si au moins une clé est recopiée). Toute autre clé de l'exception reste ignorée.
- Nouvelle fonction de module `assainirChamps(brut: unknown[]): ChampFautif[]` : ne garde que les éléments qui sont des objets avec `champ` chaîne et `contraintes` tableau ; recopie `{ champ, contraintes: contraintes.filter(chaîne) }` et rien d'autre (aucune autre clé, donc jamais de valeur).
- Ne rien changer d'autre : messages, libellés, traitement Prisma, 413, 500, ordre des clés existantes.

### 5. SOS réservé aux patients : `src/carnet-sante/carnet-sante.controller.ts`

- Importer `ForbiddenException` depuis `@nestjs/common` (ajout dans l'import existant).
- Au début de `createUrgence`, avant l'appel au service :
  ```ts
  // Un soignant victime d'un malaise utilise son compte patient (plan mobile, B33).
  if (req.user.role !== 'PATIENT') {
    throw new ForbiddenException({
      message:
        "L'alerte SOS est réservée aux comptes patients. En cas d'urgence, appelez directement les secours ou connectez-vous avec votre compte patient.",
      code: 'SOS_ROLE_INTERDIT',
    });
  }
  ```
- Ajouter sur cette route, sous `@ApiOperation` : `@ApiResponse({ status: 403, description: 'Compte non patient (code SOS_ROLE_INTERDIT).' })` et `@ApiResponse({ status: 409, description: 'Alerte déjà en cours (code SOS_DEJA_ACTIF, donnees.peutRelancerA).' })`.
- Sur `@Post('rendez-vous/:id/status')`, sous `@ApiOperation` : `@ApiResponse({ status: 409, description: "Annulation impossible depuis le statut actuel (code TRANSITION_INTERDITE)." })`.
- La garde du limiteur passe avant le contrôleur : un appel refusé par la 403 compte dans les 5 SOS par heure du compte. C'est voulu, ne rien changer.

### 6. 409 SOS : `src/carnet-sante/carnet-sante.service.ts`, `createUrgence`

Dans le `throw new ConflictException({...})` anti-relance, ajouter `code: 'SOS_DEJA_ACTIF',` (garder `statusCode`, `error`, `message` et `peutRelancerA` tels quels). Le filtre renverra alors au client `code: 'SOS_DEJA_ACTIF'` et `donnees: { peutRelancerA }`.

### 7. Annulation par le patient : même fichier, `updateRendezVousStatus`

Dans la branche patient (`if (actorId === rv.patientId)`), après le contrôle existant `status !== 'ANNULE'` (inchangé, toujours 403), ajouter :

```ts
// Annulation permise seulement avant le rendez-vous et avant toute décision finale.
const messagesTransition: Partial<Record<AppointmentStatus, string>> = {
  TERMINE: 'Ce rendez-vous a déjà eu lieu, il ne peut plus être annulé.',
  REFUSE: "Ce rendez-vous a été refusé par l'établissement, il n'y a rien à annuler.",
  ANNULE: 'Ce rendez-vous est déjà annulé.',
};
const messageTransition = messagesTransition[rv.status];
if (messageTransition) {
  throw new ConflictException({
    message: messageTransition,
    code: 'TRANSITION_INTERDITE',
  });
}
```

`AppointmentStatus` est le type déjà utilisé par la signature de la méthode ; `rv.status` est de type Prisma `AppointmentStatus`. Si tsc refuse l'indexation (deux types homonymes), indexer avec `rv.status as AppointmentStatus` ou typer la table en `Partial<Record<string, string>>`, sans autre changement. Statuts permis pour l'annulation patient : `PROGRAMME`, `EN_ATTENTE`, `CONFIRME` (le web propose « Annuler » sur PROGRAMME). La branche soignant n'est pas modifiée.

### 8. Tests (jest, sans infrastructure)

a) `src/common/filters/erreur-validation.spec.ts` (nouveau) :
- `champsFautifs` sur une liste construite à la main : `[{ property: 'telephone', value: 'SECRET-123', constraints: { matches: 'x', isNotEmpty: 'y' }, children: [] }, { property: 'medicaments', value: [...], constraints: undefined, children: [{ property: '0', children: [{ property: 'nom', value: 'SECRET-456', constraints: { isString: 'z' }, children: [] }] }] }]` donne exactement `[{ champ: 'telephone', contraintes: ['matches', 'isNotEmpty'] }, { champ: 'medicaments.0.nom', contraintes: ['isString'] }]`.
- `fabriquerErreurValidation` sur la même liste : `BadRequestException`, `getResponse()` vaut `{ message: ['x', 'y', 'z'], code: 'VALIDATION', champs: [...] }` et `JSON.stringify(getResponse())` ne contient ni `SECRET-123` ni `SECRET-456`.

b) `src/common/filters/all-exceptions.filter.spec.ts` (compléter) :
- Bout en bout avec le vrai pipe : `const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: fabriquerErreurValidation })` ; `await pipe.transform({ status: 'PIRATE', intrus: 'SECRET-789' }, { type: 'body', metatype: UpdateRendezVousStatusDto })` rejeté ; l'erreur passée au filtre donne `statusCode: 400`, `message: MESSAGES.validation`, `code: 'VALIDATION'`, `champs` contenant `{ champ: 'status', contraintes: ['isEnum'] }` et `{ champ: 'intrus', contraintes: ['whitelistValidation'] }` (comparer avec `expect.arrayContaining`), et le JSON du corps ne contient ni `PIRATE` ni `SECRET-789` hors du champ `details` : vérifier sur une copie du corps sans `details`. (`UpdateRendezVousStatusDto` vient de `src/carnet-sante/dto/carnet-sante.dto`.)
- Même cas avec `NODE_ENV=production` (restauré dans un `finally`, comme le test existant) : `champs` et `code` présents, `details` absent.
- `champs` ignoré si le code n'est pas `VALIDATION` (`new BadRequestException({ message: 'Message projet', champs: [{ champ: 'a', contraintes: ['b'] }] })` : pas de `champs` dans le corps).
- `assainirChamps` par le filtre : `champs: [{ champ: 'a', contraintes: ['b', 3], valeur: 'SECRET' }, 'x']` avec `code: 'VALIDATION'` donne `champs: [{ champ: 'a', contraintes: ['b'] }]`.
- 403 sans code : `code: 'PERMISSION_REFUSEE'` (message projet et message anglais par défaut). Mettre à jour le test existant « conserve un message rédigé par le projet » (son `toEqual` attend désormais aussi `code: 'PERMISSION_REFUSEE'`).
- 403 avec `code: 'SOS_ROLE_INTERDIT'` : code conservé, non remplacé.
- 409 `{ message, code: 'SOS_DEJA_ACTIF', peutRelancerA: '2026-10-20T10:00:00.000Z', autre: 'x' }` : corps `{ statusCode: 409, message, error: 'Déjà existant', code: 'SOS_DEJA_ACTIF', donnees: { peutRelancerA: '2026-10-20T10:00:00.000Z' } }` exactement (`autre` absent).
- Pas de `donnees` quand l'exception n'a aucune clé autorisée (un test existant sans `donnees` suffit s'il utilise `toEqual` ; sinon un `not.toHaveProperty('donnees')`).

c) `src/carnet-sante/carnet-sante.controller.spec.ts` (nouveau) : `new CarnetSanteController(service as never)` avec `service = { createUrgence: jest.fn().mockResolvedValue({ success: true }) }`.
- `it.each(['MEDECIN', 'ACCUEIL', 'PHARMACIEN', 'STRUCTURE_ADMIN', 'ADMIN', 'SUPER_ADMIN'])` : `createUrgence({ user: { userId: 'u1', role } } as never, {})` lève `ForbiddenException` dont `getResponse()` a `code: 'SOS_ROLE_INTERDIT'` ; `service.createUrgence` non appelé.
- `PATIENT` : `service.createUrgence` appelé avec `('u1', dto)`.

d) `src/carnet-sante/carnet-sante.service.spec.ts`, bloc `updateRendezVousStatus` (compléter) :
- `it.each(['TERMINE', 'REFUSE', 'ANNULE'])` : `findUnique` renvoie `{ ...rv, status }` ; le patient qui demande `ANNULE` reçoit `ConflictException` avec `getResponse()` contenant `code: 'TRANSITION_INTERDITE'` et un `message` chaîne non vide ; `update` non appelé.
- `it.each(['PROGRAMME', 'EN_ATTENTE', 'CONFIRME'])` : l'annulation par le patient passe (`update` appelé avec `data: { status: 'ANNULE' }`).
- Le test existant « refuse au patient un autre statut que ANNULE » reste un 403.

e) `src/carnet-sante/carnet-sante.urgence.spec.ts` : dans les deux tests 409 existants, ajouter `expect(corps.code).toBe('SOS_DEJA_ACTIF')` (étendre le type local de `corps` avec `code: string`).

### 9. `CLAUDE.md` (racine de `back_medconnect`)

Dans « Conventions importantes », remplacer la puce interne `- Codes machine du champ \`code\` : catalogue \`src/common/filters/codes-erreur.ts\`.` par :
`- Erreurs (TB2) : le corps \`{ statusCode, message, error }\` peut porter \`code\` (catalogue \`src/common/filters/codes-erreur.ts\`, toute 403 sans code reçoit PERMISSION_REFUSEE), \`champs\` pour VALIDATION (nom et contraintes, jamais la valeur, y compris en production) et \`donnees\` (liste blanche, aujourd'hui \`peutRelancerA\` du 409 SOS_DEJA_ACTIF). Le SOS est réservé au rôle PATIENT (403 SOS_ROLE_INTERDIT) ; le patient n'annule un rendez-vous que depuis PROGRAMME, EN_ATTENTE ou CONFIRME (409 TRANSITION_INTERDITE).`

### Interdits

- Ne pas modifier les autres `ForbiddenException` du projet ni les gardes (le code PERMISSION_REFUSEE vient du filtre).
- Ne pas ajouter de code autre que les 4 nouveaux (pas d'IDENTIFIANTS_INVALIDES, VERSION_OBSOLETE, etc. : hors tâche).
- Ne pas toucher au front, ni à `src/auth/client.ts` (son 400 `VALIDATION` sans `champs` reste tel quel).
- Aucune nouvelle dépendance.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Textes visibles en français, jamais de tiret cadratin ni demi-cadratin (commentaires et tests compris). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

## Done when

Toutes les commandes lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune sortie, code 0.
2. `docker compose exec -T backend npx eslint src/common/filters/codes-erreur.ts src/common/filters/erreur-validation.ts src/common/filters/erreur-validation.spec.ts src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.spec.ts src/main.ts src/carnet-sante/carnet-sante.controller.ts src/carnet-sante/carnet-sante.controller.spec.ts src/carnet-sante/carnet-sante.service.ts src/carnet-sante/carnet-sante.service.spec.ts src/carnet-sante/carnet-sante.urgence.spec.ts` : 0 erreur (seul l'avertissement préexistant `no-floating-promises` de `src/main.ts` est toléré).
3. `docker compose exec -T backend npx jest` : toutes les suites passent ; total de tests passés strictement supérieur à 396 (référence avant tâche : 35 suites, 396 passés, 3 ignorés) ; les suites `erreur-validation.spec.ts` et `carnet-sante.controller.spec.ts` existent et passent.
4. `docker compose exec -T backend npx jest src/common/filters src/carnet-sante` : passe, et contient les cas des points 8 a) à e).
5. `git -C back_medconnect diff --name-only` et `git -C back_medconnect status --short` ne listent que les fichiers des points 1 à 9 : modifiés `src/common/filters/codes-erreur.ts`, `src/common/filters/all-exceptions.filter.ts`, `src/common/filters/all-exceptions.filter.spec.ts`, `src/main.ts`, `src/carnet-sante/carnet-sante.controller.ts`, `src/carnet-sante/carnet-sante.service.ts`, `src/carnet-sante/carnet-sante.service.spec.ts`, `src/carnet-sante/carnet-sante.urgence.spec.ts`, `CLAUDE.md` ; nouveaux `src/common/filters/erreur-validation.ts`, `src/common/filters/erreur-validation.spec.ts`, `src/carnet-sante/carnet-sante.controller.spec.ts` (les fichiers de `docs/plans/` écrits par l'orchestrateur ne comptent pas).
6. `LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]" <fichiers touchés>` (Git Bash, depuis `back_medconnect`) : aucune ligne (code retour 1).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
