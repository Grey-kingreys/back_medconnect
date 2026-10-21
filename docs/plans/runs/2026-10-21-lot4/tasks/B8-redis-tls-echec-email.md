# B8 - Redis chiffré (rediss://) pour BullMQ et échec d'email sans 500 ni état à moitié créé

Tier: spécifié (agent implementeur-specifie)
Audience: mixte (connexion Redis, journaux, Swagger : dev ; champ `message` des réponses de création et du 503 : non-dev, affiché tel quel par le front)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot4-back` (arbre principal ; ne pas créer de branche ; NE PAS COMMITER : l'orchestrateur commite après validation). Rien à modifier dans le dépôt racine, ni dans `front_medconnect` ou `mobile_medconnect`.
Décisions de référence : `docs/plans/runs/2026-10-21-lot4/decisions.md`, D66 à D74.

## Spec

Contexte (constaté sur le déploiement de dev Render) : (a) avec une `REDIS_URL` en `rediss://`, BullMQ tente une connexion en clair et échoue ; (b) avec une clé Resend invalide, `POST /super-admin/structures` crée la structure puis répond 500 (échec de l'email d'invitation), et une nouvelle tentative répond 409 (structure déjà créée).

Principe pour toute la partie email : **jamais de 500 ni d'état à moitié créé à cause d'un email**. Ce qui est créé reste créé ; la réponse dit honnêtement si l'email est parti.

### Partie 1 - Redis en rediss:// pour BullMQ

#### 1.1 Nouveau fichier `src/common/redis/options-redis.ts`

Exporter une seule fonction pure, avec un commentaire d'en-tête en français :

```ts
import type { RedisOptions } from 'ioredis';

export function optionsConnexionBullmq(url: string): RedisOptions
```

Comportement exact (parser avec `new URL(url)`) :
- `host` : `url.hostname` ;
- `port` : `Number(url.port) || 6379` ;
- `username` : `decodeURIComponent(url.username)` si non vide, sinon `undefined` ;
- `password` : `decodeURIComponent(url.password)` si non vide, sinon `undefined` ;
- `db` : si `url.pathname` vaut `/` suivi d'un entier décimal (regex `^/(\d+)$`), ce nombre ; sinon la clé est absente ;
- `tls` : `{}` si `url.protocol === 'rediss:'` ; sinon la clé est absente.

Pas d'autre option (ne pas poser `maxRetriesPerRequest` : BullMQ le règle lui-même).

#### 1.2 `src/queue/queue.module.ts`

- Supprimer la fonction locale `redisConnection()` et son commentaire.
- Importer `optionsConnexionBullmq` depuis `'../common/redis/options-redis'` et écrire `BullModule.forRoot({ connection: optionsConnexionBullmq(process.env.REDIS_URL || 'redis://localhost:6379') })`.
- Corriger aussi l'erreur prettier existante de la ligne 4 (`import { NotificationsProcessor, NOTIFICATIONS_QUEUE }` sur plusieurs lignes) : le fichier étant touché, son lint doit passer. `npx eslint --fix src/queue/queue.module.ts` dans le conteneur est autorisé pour ce seul fichier.

#### 1.3 `src/common/redis/redis.module.ts` et `src/common/redis-io.adapter.ts`

**Ne pas les modifier.** ioredis 5 reçoit l'URL brute dans son constructeur et pose `tls` lui-même pour `rediss://` ; `duplicate()` recopie les options (D67). Le test ci-dessous le prouve.

#### 1.4 Nouveau test `src/common/redis/options-redis.spec.ts`

`describe('optionsConnexionBullmq')` :
1. `redis://localhost:6379` : `{ host: 'localhost', port: 6379 }`, sans clé `tls`, `username`/`password` `undefined`, sans clé `db`.
2. `rediss://default:mot%40de%3Apasse@exemple.render.com:6380` : `tls` égal à `{}`, `host` `exemple.render.com`, `port` 6380, `username` `default`, `password` `mot@de:passe`.
3. `redis://:secret@hote:6379/2` : `db` égal à 2, `username` `undefined`, `password` `secret`.
4. `redis://hote` (sans port) : `port` 6379.

`describe('ioredis et rediss:// (client partagé et adapter socket.io)')` :
5. `const client = new Redis('rediss://:secret@exemple.render.com:6380', { lazyConnect: true })` : `client.options.tls` est vrai (`toBeTruthy()`), `client.options.port` 6380 ; `const sub = client.duplicate()` : `sub.options.tls` vrai. Appeler `client.disconnect()` et `sub.disconnect()` à la fin du test (aucune connexion n'est ouverte grâce à `lazyConnect`).
6. `new Redis('redis://hote:6379', { lazyConnect: true })` : `client.options.tls` est `undefined` ; `disconnect()`.

Import : `import { Redis } from 'ioredis';` (même forme que `redis.module.ts`).

### Partie 2 - Échecs d'envoi d'email

#### 2.1 Catalogue `src/common/filters/codes-erreur.ts`

Ajouter en fin de tableau `CODES_ERREUR`, avec ce commentaire au-dessus :
```ts
  // Envoi d'email momentanément impossible (503), réessayer plus tard.
  'EMAIL_INDISPONIBLE',
```

#### 2.2 Filtre `src/common/filters/all-exceptions.filter.ts` (D70)

Aujourd'hui toute `HttpException` de statut >= 500 devient un 500 générique. Changer uniquement ceci :
- ajouter `503: 'Service indisponible',` dans `LIBELLES` ;
- dans la branche `exception instanceof HttpException`, lire le `code` de `exception.getResponse()` **avant** le test `statut >= 500` ; si `statut === 503` **et** `estCodeErreur(code)`, renvoyer le corps produit par `this.corpsHttp(exception, statut)` avec `code` posé (statut 503, message rédigé par le projet, libellé « Service indisponible »), sans passer par `erreurInterne` ; toute autre exception >= 500 (y compris une 503 sans code) garde le comportement actuel (`erreurInterne`, 500 générique journalisé).
- Ne rien changer d'autre (pas de `donnees`, pas de `champs` pour ce cas).

Tests à ajouter dans `src/common/filters/all-exceptions.filter.spec.ts`, en suivant le style des tests existants du fichier :
- `new ServiceUnavailableException({ message: 'Envoi impossible pour le moment.', code: 'EMAIL_INDISPONIBLE' })` : statut 503, corps `{ statusCode: 503, message: 'Envoi impossible pour le moment.', error: 'Service indisponible', code: 'EMAIL_INDISPONIBLE' }` ;
- `new ServiceUnavailableException()` sans code : statut 500, message `MESSAGES.indisponible` (comportement inchangé).

#### 2.3 Création de structure, `src/super-admin/super-admin.service.ts` (D68)

Dans `createStructure`, remplacer l'appel direct `await this.emailService.sendStructureInviteEmail(...)` par :
```ts
let invitationEnvoyee = true;
try {
  await this.emailService.sendStructureInviteEmail(...mêmes arguments...);
} catch {
  invitationEnvoyee = false;
  this.logger.error(`superadmin.invitation_echec structureId=${structure.id}`);
}
```
(Jamais l'adresse email dans ce journal. `EmailService` journalise déjà le détail sous `email.invitation_failed`.)

Réponse (statut 201 inchangé, géré par le contrôleur) :
- `data` : les champs actuels **plus** `invitationEnvoyee` ;
- `message` : si envoyé, le message actuel inchangé (`Structure créée. Un email d'invitation a été envoyé à ${structure.email}.`) ; sinon exactement :
  `Structure créée, mais l'email d'invitation n'a pas pu être envoyé. Utilisez « Renvoyer l'invitation ».`
- `success: true` dans les deux cas.

#### 2.4 Renvoi d'invitation, même fichier, `resendInvitation` (D69)

Garder l'ordre actuel (nouveau jeton écrit en base, puis envoi). Entourer l'envoi d'un `try/catch`. En cas d'échec :
1. remettre en base l'ancien jeton : `this.prisma.structure.update({ where: { id: structureId }, data: { inviteToken: structure.inviteToken, inviteExpires: structure.inviteExpires } })` (valeurs lues par le `findUnique` du début de la méthode) ; si cette remise lève, la capturer et journaliser `superadmin.invitation_restauration_echec structureId=${structureId}` (niveau error), sans rien lever d'autre ;
2. journaliser `superadmin.invitation_renvoi_echec structureId=${structureId}` (niveau error, sans adresse) ;
3. lever :
```ts
throw new ServiceUnavailableException({
  message:
    "L'email d'invitation n'a pas pu être envoyé. Le service d'envoi d'emails est momentanément indisponible, réessayez dans quelques instants.",
  code: 'EMAIL_INDISPONIBLE',
});
```
Succès : réponse actuelle inchangée. Ajouter `ServiceUnavailableException` à l'import `@nestjs/common` existant.

**Ne pas modifier `super-admin.controller.ts`** (dette ESLint non corrigeable, D74).

#### 2.5 Création de membre (D71)

`src/common/services/email.service.ts`, méthode `sendMemberWelcomeEmail` : type de retour `Promise<boolean>` ; `return true;` après `await this.deliver(...)` (une adresse de démonstration ignorée par `deliver` compte donc comme envoyée) ; dans le `catch`, garder le journal `email.member_failed` tel quel puis `return false;`. Rien d'autre dans ce fichier.

`src/structure/structure.service.ts`, méthode `createMembre` : remplacer l'envoi sans attente par :
```ts
let invitationEnvoyee: boolean;
try {
  invitationEnvoyee = await this.emailService.sendMemberWelcomeEmail(...mêmes arguments...);
} catch {
  invitationEnvoyee = false;
}
if (!invitationEnvoyee) {
  this.logger.error(`structure.membre_email_echec membreId=${membre.id}`);
}
```
Réponse :
- `data` : `{ ...membre, invitationEnvoyee }` ;
- `message` : si envoyé, le message actuel inchangé ; sinon exactement :
  `Membre créé, mais l'email contenant ses identifiants n'a pas pu être envoyé. Il pourra choisir son mot de passe avec « Mot de passe oublié » sur la page de connexion.`
- `success: true`.

#### 2.6 Mot de passe oublié, `src/auth/auth.service.ts`, `forgotPassword` (D72)

Entourer `await this.emailService.sendPasswordResetEmail(...)` d'un `try/catch` ; en cas d'échec, `this.logger.error(\`auth.reset_email_echec userId=${user.id}\`)` (sans adresse) et continuer : la méthode renvoie `genericResponse` dans tous les cas. Ne rien changer d'autre (le jeton reste enregistré, il expire en 1 h).

#### 2.7 Envois laissés tels quels (D73)

Ne pas toucher : `sendWelcomeEmail` (inscription dans `auth.service.ts`, création par un admin dans `user.service.ts`), `sendSuspiciousLoginEmail`, les emails SOS (file BullMQ), `sendStructureInviteEmail` (garde son `throw`, géré par les appelants ci-dessus).

#### 2.8 Tests Jest à créer ou compléter

Espionner les journaux par `jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)` (import `Logger` de `@nestjs/common`), restauré en `afterEach` (`jest.restoreAllMocks()`).

a) Nouveau `src/super-admin/super-admin.service.spec.ts`. Instancier `new SuperAdminService(prisma as never, emailService as never, rolesService as never)` avec des doublures :
- `prisma.structure.findUnique` (null pour la création), `prisma.user.findUnique` (null), `prisma.structure.create` (renvoie `{ id: 's1', nom: 'Clinique Test', type: 'CLINIQUE', email: 'clinique@exemple.gn', isConfigured: false, createdAt: new Date() }`), `prisma.structure.update` (résolu) ;
- `rolesService.seedStructureDefaultRoles` (résolu) ;
- `emailService.sendStructureInviteEmail`.
DTO minimal : `{ nom: 'Clinique Test', type: 'CLINIQUE', email: 'clinique@exemple.gn' } as never`.

Cas :
1. création, email envoyé : `data.invitationEnvoyee === true`, message actuel, `success` vrai ;
2. création, email rejeté (`mockRejectedValue(new Error('x'))`) : la promesse se résout (pas de rejet), `data.invitationEnvoyee === false`, `data.id === 's1'`, message exact de 2.3 ; aucun appel du journal ne contient `clinique@exemple.gn` (vérifier sur tous les arguments de tous les appels de l'espion) ;
3. renvoi, email rejeté : `prisma.structure.findUnique` renvoie `{ id: 's1', nom: 'Clinique Test', type: 'CLINIQUE', email: 'clinique@exemple.gn', isConfigured: false, inviteToken: 'ancien-hash', inviteExpires: <date fixe> }` ; la promesse est rejetée par une `ServiceUnavailableException` dont `getStatus()` vaut 503 et dont `getResponse()` contient `code: 'EMAIL_INDISPONIBLE'` et le message exact de 2.4 ; `prisma.structure.update` appelé 2 fois, le second avec `data: { inviteToken: 'ancien-hash', inviteExpires: <la même date> }` ;
4. renvoi, email rejeté et remise du jeton rejetée (second `update` rejeté) : toujours la `ServiceUnavailableException` 503 `EMAIL_INDISPONIBLE` ;
5. renvoi, email envoyé : réponse actuelle (`message` `Invitation renvoyée à clinique@exemple.gn`), `update` appelé une seule fois.

b) Nouveau `src/structure/structure.membre-email.spec.ts`. Instancier `new StructureService(prisma as never, emailService as never, {} as never, rolesService as never, {} as never, {} as never)` :
- `prisma.user.findUnique` : 1er appel `{ id: 'a1', structureId: 'st1' }` (l'admin), 2e appel `null` (email libre) ;
- `prisma.structure.findUnique` : `{ id: 'st1', nom: 'Clinique Test', type: 'CLINIQUE', isActive: true }` ;
- `rolesService.resolveAssignableRoleId` : résolu `'r1'` ;
- `prisma.user.create` : renvoie `{ id: 'm1', nom: 'Bah', prenom: 'Awa', email: 'awa@exemple.gn', telephone: null, role: 'MEDECIN', specialite: null, isActive: true, createdAt: new Date() }` ;
- DTO sans téléphone : `{ nom: 'Bah', prenom: 'Awa', email: 'awa@exemple.gn', role: 'MEDECIN' } as never`.
Cas : `sendMemberWelcomeEmail` résolu `true` (message actuel, `data.invitationEnvoyee` vrai, `data.id` `m1`) ; résolu `false` (message exact de 2.5, `invitationEnvoyee` faux, la promesse se résout) ; rejeté (même résultat que `false`).

c) Nouveau `src/common/services/email.service.membre.spec.ts`, sur le modèle de `email.service.demo.spec.ts` (doublure `resendInstance`) : `sendMemberWelcomeEmail` renvoie `true` si `send` résout `{ data: { id: 'x' }, error: null }` ; `false` si `send` résout `{ data: null, error: { name: 'validation_error', message: 'clé invalide' } }` ; `false` si `send` rejette ; `true` pour une adresse `@demo.medconnecte.gn` (et `send` non appelé).

d) `src/auth/auth.service.spec.ts`, bloc `describe('forgotPassword')` existant : ajouter un cas où `emailService.sendPasswordResetEmail.mockRejectedValueOnce(new Error('x'))` pour un compte existant et actif : la réponse est égale (`toEqual`) à celle d'un email inconnu, sans rejet.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Précisions :
- Fichiers autorisés (et seuls fichiers modifiés ou créés) : `src/common/redis/options-redis.ts`, `src/common/redis/options-redis.spec.ts`, `src/queue/queue.module.ts`, `src/common/filters/codes-erreur.ts`, `src/common/filters/all-exceptions.filter.ts`, `src/common/filters/all-exceptions.filter.spec.ts`, `src/super-admin/super-admin.service.ts`, `src/super-admin/super-admin.service.spec.ts`, `src/common/services/email.service.ts`, `src/common/services/email.service.membre.spec.ts`, `src/structure/structure.service.ts`, `src/structure/structure.membre-email.spec.ts`, `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`.
- Textes en français, jamais de tiret cadratin ni demi-cadratin dans les lignes ajoutées. Messages visibles recopiés exactement depuis cette fiche (guillemets « » suivis et précédés d'une espace simple).
- Aucune adresse email dans les nouveaux journaux. Aucun `eslint-disable` ajouté, sauf la forme déjà utilisée en tête de `user.service.spec.ts` (`no-unsafe-member-access` pour les doublures `jest.Mock`) si elle est nécessaire dans un nouveau fichier de test.
- Toutes les commandes se lancent depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (conteneur `backend` démarré).

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :
1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/common/redis/options-redis.ts src/common/redis/options-redis.spec.ts src/queue/queue.module.ts src/common/filters/codes-erreur.ts src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.spec.ts src/super-admin/super-admin.service.ts src/super-admin/super-admin.service.spec.ts src/common/services/email.service.ts src/common/services/email.service.membre.spec.ts src/structure/structure.service.ts src/structure/structure.membre-email.spec.ts src/auth/auth.service.ts src/auth/auth.service.spec.ts` : 0 erreur (avertissements tolérés).
3. `docker compose exec -T backend npx jest` : toutes les suites passent, dont `options-redis.spec.ts`, `super-admin.service.spec.ts`, `structure.membre-email.spec.ts`, `email.service.membre.spec.ts`, et les nouveaux cas de `all-exceptions.filter.spec.ts` et `auth.service.spec.ts`.
4. `git -C back_medconnect status --porcelain -- . ':!docs/plans'` ne liste que les 14 fichiers autorisés (les fichiers de `docs/plans/` sont ceux du chef, non commités, et ne doivent pas avoir été modifiés par le codeur).
5. `git -C back_medconnect diff -U0 | grep '^+' | LC_ALL=C.UTF-8 grep -P '[\x{2013}\x{2014}]'` : aucune sortie (même contrôle sur les fichiers nouveaux, non suivis).
6. `grep -n "redisConnection" back_medconnect/src/queue/queue.module.ts` : aucune sortie ; `grep -n "EMAIL_INDISPONIBLE" back_medconnect/src/common/filters/codes-erreur.ts back_medconnect/src/super-admin/super-admin.service.ts` : une occurrence dans chacun.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
