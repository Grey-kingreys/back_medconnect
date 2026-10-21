# B10 - Permissions selon le type de structure : une pharmacie n'a aucun accès au dossier médical

Tier: spécifié (agent implementeur-specifie)
Audience: dev (API consommée par le front ; aucun nouveau texte visible : les 403 gardent le message actuel)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot5-back` (arbre principal ; ne pas créer de branche ; NE PAS COMMITER : l'orchestrateur commite après validation). Rien à modifier dans le dépôt racine, ni dans `front_medconnect` ou `mobile_medconnect`.
Décisions de référence : `docs/plans/runs/2026-10-21-lot5/decisions.md`, D80 à D89.

## Audit (état avant correction, établi par le chef d'équipe, à ne pas refaire)

Le porteur signale qu'un administrateur de pharmacie « voit la même chose » qu'un administrateur d'hôpital. Constat dans le code :

1. Un seul rôle enum `STRUCTURE_ADMIN` (`prisma/schema.prisma`, enum `Role`) pour tous les types ; le contrôle d'accès réel passe par le RBAC dynamique : `@RequirePermissions(...)` + `PermissionsGuard` (`src/common/rbac/permissions.guard.ts`) -> `PermissionsService.hasPermissions` -> `getUserPermissions` (`src/common/rbac/permissions.service.ts`), qui renvoie les permissions de `user.appRole` SANS tenir compte du type de structure.
2. Rôles par défaut (`src/common/rbac/permissions.constants.ts`, `DEFAULT_STRUCTURE_ROLES`) : l'« Administrateur de structure » d'une PHARMACIE n'a que `structure:read`, `structure:write`, `membre:read`, `membre:manage`, `role:manage` ; donc, avec le rôle par défaut intact, il reçoit déjà 403 sur `GET /carnet-sante/patient/:patientId` (`carnet:read`, contrôleur l. 70-71), `GET /users/patients/my` (`patient:read`, `src/user/user.controller.ts` l. 71-72), `GET /carnet-sante/sos/actives`, `POST /carnet-sante/sos/:id/take-charge` et `/status` (`sos:respond`), `POST /consent/redeem` et `/consent/otp/*` (`patient:read`). La création d'un médecin dans une pharmacie est refusée en 400 (`src/structure/structure.service.ts` l. 342 à 347), l'accueil aussi (l. 349 à 354).
3. FAILLE : les rôles par défaut d'une structure sont créés avec `isSystem: false` (`roles.service.ts`, `seedStructureDefaultRoles` -> `ensureRole(def, structureId, false, ...)`), donc modifiables par leur admin (`PATCH /roles/:id`, `role:manage`), et `DELEGABLE_PERMISSION_CODES` contient toutes les permissions cliniques (`carnet:read`, `consultation:write`, `ordonnance:write`, `analyse:write`, `vaccination:write`, `rendezvous:write`, `patient:read`, `sos:respond`) ; `validateAndMapPermissions` ne regarde pas le type de structure. Un admin de pharmacie peut donc s'accorder (ou accorder à un pharmacien via un rôle personnalisé et `appRoleId` à la création de membre) ces permissions, effectives immédiatement (cache invalidé). Il obtient alors : la liste des patients (`GET /users/patients/my`), le carnet de tout patient ayant autorisé la pharmacie (`checkAccess`, `carnet-sante.service.ts` l. 101 à 146, n'exige que `AutorisationStructure` ; un patient peut autoriser n'importe quelle structure), la création de consultations, ordonnances, analyses, vaccinations pour ces patients, la réception des alertes SOS avec fiche d'urgence (`createUrgence`, l. 1660 à 1690 : les 5 structures les plus proches, TOUS types, filtrées par `sos:respond`), les fichiers privés du carnet (`src/storage/file-access.service.ts` l. 88, `carnet:read`), l'échange de code de consentement.
4. `/auth/me` (`src/auth/auth.service.ts` `getMe`, l. 315 à 357) renvoie `role: 'STRUCTURE_ADMIN'`, `structure { id, nom, type }` et `permissions` brutes ; pas de `structureType` de premier niveau. Le front construit son menu sur le rôle enum, d'où le constat du porteur.
5. Hors faille, laissé tel quel : `GET /carnet-sante/consultations` traite `STRUCTURE_ADMIN` comme un médecin (`carnet-sante.service.ts` l. 356) mais ne renvoie que les consultations dont il est l'auteur (aucune pour une pharmacie) ; les routes `GET /carnet-sante/ordonnances|analyses|vaccinations` sont en libre-service (ses propres données).

## Spec

Décision (D80, D81) : les permissions effectives d'un utilisateur rattaché à une structure de type `PHARMACIE` sont restreintes à une liste blanche ; `HOPITAL`, `CLINIQUE` et utilisateur sans structure : inchangés. Le filtre s'applique dans `PermissionsService.getUserPermissions`, seule fonction de calcul, déjà utilisée par `PermissionsGuard` (via `hasPermissions`), `/auth/me`, la diffusion SOS, le chat, l'accès aux fichiers et la liste des patients.

### 1. Nouveau fichier `src/common/rbac/permissions-type-structure.ts`

Commentaire d'en-tête en français : rôle du fichier (permissions effectives selon le type de structure ; une pharmacie n'a aucun accès au dossier médical, quel que soit son rôle, y compris personnalisé ; les rôles en base ne sont pas modifiés, la permission y est seulement inopérante ; liste blanche : toute nouvelle permission du catalogue est refusée aux pharmacies tant qu'on ne l'ajoute pas ici).

Imports :

```ts
import type { StructureType } from 'generated/prisma/enums';
import { PERMISSIONS, type PermissionCode } from './permissions.constants';
```

Exporter exactement :

```ts
/** Permissions conservées par tout membre d'une pharmacie (liste blanche). */
export const PERMISSIONS_AUTORISEES_PHARMACIE: readonly PermissionCode[] = [
  PERMISSIONS.STOCK_READ,
  PERMISSIONS.STOCK_WRITE,
  PERMISSIONS.CATALOGUE_WRITE,
  PERMISSIONS.CATALOGUE_MANAGE,
  PERMISSIONS.STRUCTURE_READ,
  PERMISSIONS.STRUCTURE_WRITE,
  PERMISSIONS.MEMBRE_READ,
  PERMISSIONS.MEMBRE_MANAGE,
  PERMISSIONS.ROLE_MANAGE,
  PERMISSIONS.CHAT_STRUCTURE,
];

export function typeStructureEffectif(
  user:
    | {
        structure?: { type: StructureType } | null;
        administeredStructure?: { type: StructureType } | null;
      }
    | null
    | undefined,
): StructureType | null
```
Renvoie `user?.structure?.type ?? user?.administeredStructure?.type ?? null` (D83).

```ts
export function filtrerPermissionsSelonTypeStructure(
  codes: string[],
  type: StructureType | null,
): string[]
```
Si `type === 'PHARMACIE'` : renvoie `codes.filter((c) => autorisees.has(c))` où `autorisees` est un `Set<string>` construit depuis `PERMISSIONS_AUTORISEES_PHARMACIE` (constante de module non exportée). Sinon : renvoie `codes` tel quel (même tableau). Ordre d'origine conservé.

### 2. `src/common/rbac/permissions.service.ts`

- `CACHE_PREFIX` passe de `'perms:user:'` à `'perms:v2:user:'` (D85), avec un commentaire court : « v2 : permissions filtrées selon le type de structure (B10) ; le changement de préfixe ignore les anciennes entrées au déploiement. »
- Dans `getUserPermissions`, étape « 2) Base » : le `select` gagne `structure: { select: { type: true } }` et `administeredStructure: { select: { type: true } }` (à côté de `appRole`). Puis :

```ts
const codesDuRole = user?.appRole?.permissions.map((rp) => rp.permission.code) ?? [];
const codes = filtrerPermissionsSelonTypeStructure(codesDuRole, typeStructureEffectif(user));
```
  C'est `codes` (filtré) qui est mis en cache et renvoyé. Import depuis `'./permissions-type-structure'`.
- Mettre à jour le commentaire de classe : ajouter une ligne « Les permissions du rôle sont filtrées selon le type de la structure de l'utilisateur (une pharmacie n'a aucun accès au dossier médical, cf. permissions-type-structure.ts). »
- Rien d'autre ne change (`hasPermissions`, `invalidateUser`, `invalidateRole` gardent leur logique). `npx eslint --fix` autorisé sur ce fichier (sa dette actuelle est uniquement du formatage prettier).

### 3. `src/auth/auth.service.ts`, méthode `getMe`

- Ajouter au `select` : `administeredStructure: { select: { type: true } }`.
- Remplacer la déstructuration existante par `const { avatarFile, administeredStructure, ...rest } = user;` puis `const structureType = typeStructureEffectif({ structure: rest.structure, administeredStructure });` (import de `typeStructureEffectif` depuis `'src/common/rbac/permissions-type-structure'`). Ainsi `administeredStructure` est utilisé (pas d'erreur `no-unused-vars`) et ne sort pas dans la réponse.
- Réponse : `data: { ...rest, avatarUrl, structureType, permissions }` (D86). `permissions` vient toujours de `this.permissionsService.getUserPermissions(userId)`, donc déjà filtré. Le champ `structure` existant reste inchangé.
- Ne pas toucher `auth.controller.ts` (description Swagger de `GET /auth/me` inchangée dans ce lot).

### 4. Nouveau test `src/common/rbac/permissions-type-structure.spec.ts`

Partie A, fonctions pures :
1. `filtrerPermissionsSelonTypeStructure(tousLesCodes, 'PHARMACIE')` où `tousLesCodes = ALL_PERMISSION_CODES` (importé de `./permissions.constants`) : résultat `toEqual` exactement les 10 codes de la liste blanche, dans l'ordre du catalogue ; ne contient aucun de `carnet:read`, `consultation:write`, `ordonnance:write`, `analyse:write`, `vaccination:write`, `rendezvous:write`, `patient:read`, `sos:respond`, `platform:admin`.
2. `'HOPITAL'`, `'CLINIQUE'` et `null` : résultat `toBe` le tableau d'entrée (inchangé).
3. Les permissions par défaut du « Pharmacien » (`DEFAULT_STRUCTURE_ROLES.PHARMACIE[0].permissions`) et de l'« Administrateur de structure » de pharmacie (`[1]`) passent le filtre sans perte (`toEqual` l'entrée) : les rôles par défaut ne sont pas affectés.
4. `typeStructureEffectif` : `{ structure: { type: 'PHARMACIE' } }` -> `'PHARMACIE'` ; `{ structure: null, administeredStructure: { type: 'CLINIQUE' } }` -> `'CLINIQUE'` ; `{ structure: { type: 'HOPITAL' }, administeredStructure: { type: 'PHARMACIE' } }` -> `'HOPITAL'` ; `{}`, `null`, `undefined` -> `null`.

Partie B, `PermissionsService` (instancié directement : `new PermissionsService(redis as never, prisma as never)` avec `redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn() }` et `prisma = { user: { findUnique: jest.fn(), findMany: jest.fn() } }`) :
5. Utilisateur au rôle personnalisé `['carnet:read', 'patient:read', 'sos:respond', 'stock:read', 'structure:read']`, `structure: { type: 'PHARMACIE' }` : `getUserPermissions` renvoie `['stock:read', 'structure:read']` ; `redis.set` est appelé avec la clé `'perms:v2:user:<id>'` et `JSON.stringify(['stock:read', 'structure:read'])` ; `hasPermissions(id, ['carnet:read'])` vaut `false`.
6. Même rôle, `structure: { type: 'HOPITAL' }` : les 5 codes sont renvoyés ; `hasPermissions(id, ['carnet:read'])` vaut `true`.
7. Même rôle, `structure: null`, `administeredStructure: { type: 'PHARMACIE' }` : `['stock:read', 'structure:read']`.
8. `prisma.user.findUnique` est appelé avec un `select` qui contient `structure: { select: { type: true } }` et `administeredStructure: { select: { type: true } }` (`expect.objectContaining`).

Partie C, HTTP de bout en bout sans base (prouve le 403 `PERMISSION_REFUSEE` avec les vrais contrôleurs, la vraie garde et le vrai service) :
- `Test.createTestingModule({ controllers: [CarnetSanteController, UserController], providers: [PermissionsService, PermissionsGuard, { provide: PrismaService, useValue: prisma }, { provide: REDIS_CLIENT, useValue: redis }, { provide: CarnetSanteService, useValue: { getPatientCarnetForDoctor: jest.fn().mockResolvedValue({ success: true, data: { id: 'p1' } }) } }, { provide: UserService, useValue: { getPatientsForDoctor: jest.fn().mockResolvedValue({ success: true, data: [] }) } }] })`, puis `.overrideGuard(AuthGuard).useValue({ canActivate: (ctx: ExecutionContext) => { const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>(); req.user = { userId: req.headers['x-essai-user'], role: 'STRUCTURE_ADMIN', structureId: 's1' }; return true; } })`. `app = module.createNestApplication(); app.useGlobalFilters(new AllExceptionsFilter()); await app.init();` ; `afterAll(() => app.close())`. Imports : `REDIS_CLIENT` depuis `'src/common/redis/redis.module'`, `PrismaService` depuis `'src/common/services/prisma.service'`, `AuthGuard` depuis `'src/common/guards/auth.guard'`, `AllExceptionsFilter` depuis `'src/common/filters/all-exceptions.filter'`, `request` depuis `'supertest'` (modèle : `src/configuration-publique/configuration-publique.spec.ts`). Si l'injection d'une dépendance d'un contrôleur échoue, ajouter le fournisseur simulé correspondant ; ne modifier aucun contrôleur.
- `prisma.user.findUnique` simulé selon `where.id` : `'admin-pharmacie'` -> `{ appRole: { permissions: [codes] }, structure: { type: 'PHARMACIE' }, administeredStructure: null }` ; `'admin-hopital'` -> même chose avec `type: 'HOPITAL'`, où `codes` = `carnet:read`, `patient:read`, `structure:read` sous la forme `{ permission: { code } }` (rôle personnalisé identique pour les deux : c'est le cas de la faille de l'audit, point 3).
9. `GET /carnet-sante/patient/p1` avec `x-essai-user: admin-pharmacie` : statut 403, `body.code === 'PERMISSION_REFUSEE'`, `getPatientCarnetForDoctor` non appelé.
10. `GET /users/patients/my` avec `admin-pharmacie` : 403, `PERMISSION_REFUSEE`, `getPatientsForDoctor` non appelé.
11. `GET /carnet-sante/patient/p1` avec `admin-hopital` : 200 et `getPatientCarnetForDoctor` appelé avec `('admin-hopital', 'p1', 's1')`.
12. `GET /users/patients/my` avec `admin-hopital` : 200 et `getPatientsForDoctor` appelé avec `('s1', true)`.

### 5. Nouveau test `src/auth/auth.me.spec.ts`

Instancier `AuthService` comme dans `src/auth/auth.service.spec.ts` (l. 129 à 137 : sept arguments dans cet ordre, `{} as never` pour ceux inutilisés), avec `prisma = { user: { findUnique: jest.fn() } }` et `permissionsService = { getUserPermissions: jest.fn() }` en 6e argument.
13. Utilisateur `{ id: 'u1', role: 'STRUCTURE_ADMIN', structureId: 's1', structure: { id: 's1', nom: 'Pharmacie', type: 'PHARMACIE' }, administeredStructure: { type: 'PHARMACIE' }, avatarFile: null, ... }`, `getUserPermissions` -> `['stock:read']` : `data.structureType === 'PHARMACIE'`, `data.permissions` `toEqual(['stock:read'])`, `data.structure` inchangé, `data` n'a pas de clé `administeredStructure` ni `avatarFile`, `getUserPermissions` appelé avec `'u1'`.
14. Structure `HOPITAL` : `structureType === 'HOPITAL'`.
15. `structure: null`, `administeredStructure: { type: 'CLINIQUE' }` : `'CLINIQUE'`.
16. Patient sans structure (`structure: null`, `administeredStructure: null`) : `structureType === null`.
17. `prisma.user.findUnique` reçoit un `select` qui contient `administeredStructure: { select: { type: true } }`.

### 6. `CLAUDE.md` (back)

Dans « Conventions importantes (pièges) », juste après la puce **Auth**, ajouter une puce (une seule, texte continu, sans tiret cadratin ni demi-cadratin) :

« **Permissions selon le type de structure (B10)** : `PermissionsService.getUserPermissions` (seule source des permissions effectives : `PermissionsGuard`, `/auth/me`, diffusion SOS, chat, fichiers) filtre les permissions du rôle selon le type de la structure de l'utilisateur (`structure`, à défaut `administeredStructure`), règle dans `src/common/rbac/permissions-type-structure.ts`. Une PHARMACIE ne garde qu'une liste blanche : `stock:read`, `stock:write`, `catalogue:write`, `catalogue:manage`, `structure:read`, `structure:write`, `membre:read`, `membre:manage`, `role:manage`, `chat:structure` ; aucun accès au dossier médical (carnet, consultations, ordonnances, analyses, vaccinations, rendez-vous, liste des patients, SOS), même par un rôle personnalisé (le rôle en base n'est pas modifié, la permission y est inopérante). HOPITAL, CLINIQUE et utilisateur sans structure : inchangés. Toute nouvelle permission est refusée aux pharmacies tant qu'elle n'est pas ajoutée à la liste blanche. Cache Redis `perms:v2:user:<id>` (5 min). `GET /auth/me` renvoie `data.structureType` (`HOPITAL`, `CLINIQUE`, `PHARMACIE` ou `null`) et `data.permissions` filtrées : le front construit menu et tableau de bord à partir de ces deux champs, pas du rôle enum. »

Ne rien modifier d'autre dans `CLAUDE.md`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (commentaires en français, aucun tiret cadratin U+2014 ni demi-cadratin U+2013 dans les lignes ajoutées). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

- Fichiers autorisés, et eux seuls : `src/common/rbac/permissions-type-structure.ts` (nouveau), `src/common/rbac/permissions-type-structure.spec.ts` (nouveau), `src/common/rbac/permissions.service.ts`, `src/auth/auth.service.ts`, `src/auth/auth.me.spec.ts` (nouveau), `CLAUDE.md`.
- Ne pas toucher : `permissions.constants.ts` (catalogue et rôles par défaut inchangés, D89), `roles.service.ts` et `roles.controller.ts` (D84), `permissions.guard.ts` (le message 403 reste « Vous n'avez pas la permission d'effectuer cette action. », le code vient du filtre, D88), les contrôleurs, `carnet-sante.service.ts`, `prisma/schema.prisma` (aucune migration).
- Pas de `as any`, pas de `eslint-disable`. Pas de nouvelle dépendance npm (`supertest` et `@nestjs/testing` déjà installés).
- `npx eslint --fix` dans le conteneur autorisé sur les fichiers autorisés `.ts` uniquement.
- Si un test existant casse (par exemple un test qui simule `prisma.user.findUnique` pour `PermissionsService` ou `getMe`), le signaler en BLOCKED plutôt que de modifier un fichier hors liste.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :
1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/common/rbac/permissions-type-structure.ts src/common/rbac/permissions-type-structure.spec.ts src/common/rbac/permissions.service.ts src/auth/auth.service.ts src/auth/auth.me.spec.ts` : 0 erreur (avertissements tolérés).
3. `docker compose exec -T backend npx jest` : toutes les suites passent, dont `permissions-type-structure.spec.ts` (cas 1 à 12, avec les 403 `PERMISSION_REFUSEE` des cas 9 et 10 et les 200 des cas 11 et 12) et `auth.me.spec.ts` (cas 13 à 17).
4. `git -C back_medconnect status --porcelain -- . ':!docs/plans'` ne liste que les 6 fichiers autorisés.
5. `git -C back_medconnect diff -U0 | grep '^+' | LC_ALL=C.UTF-8 grep -P '[\x{2013}\x{2014}]'` : aucune sortie ; même contrôle sur les nouveaux fichiers (`LC_ALL=C.UTF-8 grep -P '[\x{2013}\x{2014}]' back_medconnect/src/common/rbac/permissions-type-structure*.ts back_medconnect/src/auth/auth.me.spec.ts` : aucune sortie).
6. `grep -n "perms:v2:user:" back_medconnect/src/common/rbac/permissions.service.ts` : une occurrence ; `grep -n "filtrerPermissionsSelonTypeStructure" back_medconnect/src/common/rbac/permissions.service.ts` : au moins une ; `grep -n "structureType" back_medconnect/src/auth/auth.service.ts` : au moins une ; `grep -n "Permissions selon le type de structure (B10)" back_medconnect/CLAUDE.md` : une occurrence.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
