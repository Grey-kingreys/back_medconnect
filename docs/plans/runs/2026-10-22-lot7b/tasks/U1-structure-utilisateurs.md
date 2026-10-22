# U1 - Structure de rattachement dans la liste et le détail des utilisateurs, script de contrôle des rattachements

Tier: spécifié (agent implementeur-specifie)
Audience: dev (réponse JSON de l'API et sortie console d'un script d'exploitation ; aucun message d'erreur, email, SMS ni notification modifié)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; aucun docker)

Dépôt : `D:\tmp\wt-back-lot7b` (worktree isolé), branche `orch/lot7b-back` déjà en place. Ne pas créer de branche. NE PAS COMMITER : l'orchestrateur commite après validation.
INTERDIT : `docker compose` (sous toute forme) et toute écriture dans l'arbre principal `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect` (un autre lot y travaille). Toutes les commandes se lancent depuis `D:\tmp\wt-back-lot7b`, en local (`node_modules` et `generated/prisma` y sont présents ; si `generated/prisma/client.ts` manque, lancer `npx --no-install prisma generate`).
Décisions de référence : `docs/plans/runs/2026-10-22-lot7b/decisions.md`, D201 à D206.

## Contexte

Page « Utilisateurs » du super administrateur (front : `src/app/dashboard/utilisateurs/page.tsx`, colonne STRUCTURE, lit `u.structure.nom`) : un administrateur d'établissement et un pharmacien rattachés à la pharmacie « Phamarcie la belle etoile » affichent le tiret de valeur absente. Le front n'est PAS modifié par cette tâche : il lira le champ `structure` une fois exposé.

## Audit (établi par le chef d'équipe, à ne pas refaire ; sert de rapport)

Façons dont un utilisateur est rattaché à une structure (`prisma/schema.prisma`) :
- `User.structureId` + relation `structure` (« StructureMembers », l. 98 à 100) : membres (médecin, pharmacien, accueil) ET administrateur.
- `Structure.adminId` (unique) + relation `admin` / `User.administeredStructure` (« StructureAdmin », l. 102 à 103 et 180 à 182) : l'administrateur de l'établissement.
- `AppRole.structureId` (rôles personnalisés) et `AutorisationStructure` (patient qui autorise un établissement) : PAS des rattachements de compte, hors sujet.

Chemins de création :
1. Super administrateur crée la structure (`src/super-admin/super-admin.service.ts`, `createStructure`, l. 33 à 136) : crée seulement la `Structure` (invitation), aucun compte.
2. Activation par le lien d'invitation (`src/structure/structure.service.ts`, `setupStructure`, l. 186 à 314) : dans une même transaction, crée l'utilisateur `STRUCTURE_ADMIN` avec `structureId: structure.id` (l. 228) ET pose `Structure.adminId` (l. 254). Correct (présent depuis le commit 149ace8).
3. Ajout d'un membre par l'administrateur (`createMembre`, l. 319 à 448) : `structureId: structureId` (l. 405). Correct.
4. Inscription publique (`src/auth/auth.service.ts`, `register`, l. 234) : patient sans structure, voulu.
5. Création directe par le super administrateur (`src/user/user.service.ts`, `createByAdmin`, POST /users) : rôles MEDECIN, PHARMACIEN, STRUCTURE_ADMIN, ADMIN, sans aucun champ d'établissement, donc compte sans structure. Pas un oubli de code (aucune structure n'est fournie) : parqué pour le porteur (D206), non modifié ici.
6. Jeu de démonstration (`src/demo/demo.seeder.ts` l. 345 et 363 à 367) et `prisma/seed_complete.ts` (l. 95) : renseignent `structureId` (et `adminId` pour la démo). Correct.

Pourquoi les deux comptes n'affichent aucune structure (D201) : `getUsers` et `getUser` sélectionnent DÉJÀ `structure: { select: { id, nom, type } }`, mais `src/user/user.controller.ts` (GET /users l. 140 à 151, GET /users/:userId l. 153 à 165, et POST /users l. 125 à 138) passe `res.data` dans `plainToInstance(UserResponseDto, ..., { excludeExtraneousValues: true })` et `UserResponseDto` (`src/user/dto/user.dto.ts` l. 113 à 168) n'a pas de propriété `structure` exposée : le champ est retiré pour TOUS les utilisateurs. Rien n'indique que ces deux comptes aient un `structureId` vide (les chemins 2 et 3 le renseignent) ; s'ils ont été créés par le chemin 5, ils n'en ont pas, et le script de la Spec 4 les listera. Second cas couvert : un administrateur rattaché seulement par `Structure.adminId` (données anciennes ou modifiées à la main) ; la résolution de la Spec 2 l'affiche quand même.

## Spec

### 1. `src/user/dto/user.dto.ts` (indentation existante à 4 espaces, la conserver)

- Juste AVANT `export class UserResponseDto`, ajouter :

```ts
/** Établissement de rattachement renvoyé avec un utilisateur (liste blanche, D203). */
export class UserStructureDto {
    @Expose()
    id: string;

    @Expose()
    nom: string;

    @Expose()
    type: string;
}
```

- Dans `UserResponseDto`, juste après la propriété `structureId`, ajouter :

```ts
    /** Membre (User.structureId), sinon structure administrée (Structure.adminId), sinon null (D202). */
    @Expose()
    @Type(() => UserStructureDto)
    structure?: UserStructureDto | null;
```

`Expose` et `Type` sont déjà importés de `class-transformer` dans ce fichier ; ne rien changer d'autre.

### 2. `src/user/user.service.ts`

- Au niveau du module (après les imports, avant `@Injectable()`), ajouter :

```ts
type StructureResume = { id: string; nom: string; type: string };

/**
 * Structure de rattachement affichée (D202) : celle de User.structureId, sinon celle
 * dont l'utilisateur est l'administrateur (Structure.adminId), sinon null.
 */
function avecStructureResolue<
  T extends {
    structure: StructureResume | null;
    administeredStructure: StructureResume | null;
  },
>(
  utilisateur: T,
): Omit<T, 'structure' | 'administeredStructure'> & {
  structure: StructureResume | null;
} {
  const { structure, administeredStructure, ...reste } = utilisateur;
  return { ...reste, structure: structure ?? administeredStructure ?? null };
}
```

- `getUsers` : dans le `select`, juste après `structure: { select: { id: true, nom: true, type: true } },`, ajouter `administeredStructure: { select: { id: true, nom: true, type: true } },`. Retourner `data: users.map(avecStructureResolue)` (message et `success` inchangés).
- `getUser` : même ajout dans le `select` ; garder le `NotFoundException` tel quel ; retourner `data: avecStructureResolue(user)`.
- `structureId` reste la valeur brute de la colonne (ne pas la recalculer, D202). Ne toucher à aucune autre méthode (en particulier `createByAdmin`, `update`, `getPatientsForDoctor`).

### 3. `src/user/user.controller.ts`

Aucune modification : la correction passe par le DTO. Ne pas toucher ce fichier.

### 4. Script de contrôle en lecture seule (D204)

#### 4a. `src/user/rattachements-structure.ts` (nouveau, logique pure, sans import Prisma ni pg)

```ts
/** Rôles qui doivent appartenir à un établissement. */
export const ROLES_ETABLISSEMENT = [
  'MEDECIN',
  'PHARMACIEN',
  'STRUCTURE_ADMIN',
  'ACCUEIL',
] as const;

export interface CompteRattachement {
  id: string;
  email: string;
  role: string;
  structureId: string | null;
  structureNom: string | null;
  structureAdministreeId: string | null;
  structureAdministreeNom: string | null;
}

export interface AnalyseRattachements {
  total: number;
  /** Administre une structure mais User.structureId est vide. */
  adminsSansStructure: CompteRattachement[];
  /** Administre une structure mais User.structureId pointe vers une autre. */
  adminsRattachesAilleurs: CompteRattachement[];
  /** Rôle d'établissement, sans User.structureId ni structure administrée. */
  rolesSansStructure: CompteRattachement[];
}

export function analyserRattachements(
  comptes: CompteRattachement[],
): AnalyseRattachements
```

Règles (catégories exclusives, ordre d'entrée conservé) : `structureAdministreeId` non null et `structureId` null : `adminsSansStructure` ; `structureAdministreeId` non null, `structureId` non null et différents : `adminsRattachesAilleurs` ; `structureAdministreeId` null, `structureId` null et `role` dans `ROLES_ETABLISSEMENT` : `rolesSansStructure` ; sinon rien. `total = comptes.length`.

#### 4b. `scripts/structures-rattachements.ts` (nouveau)

Calqué sur `scripts/telephones-doublons.ts` (même structure : `principal()`, client `pg`, `BEGIN READ ONLY`, `ROLLBACK` dans un `finally` avec `try/catch` silencieux commenté, `client.end()`, `.catch` final qui écrit l'erreur et met `process.exitCode = 1`). Différences :

- En-tête :

```ts
/**
 * Liste, en lecture seule, les comptes dont le rattachement à un établissement est
 * incomplet ou incohérent (User.structureId et Structure.adminId). N'écrit rien et ne
 * propose aucune requête : le rattrapage éventuel est une décision du porteur.
 *
 * Usage (dev, worktree ou arbre principal) : npm run structures:rattachements
 * Usage (production) :
 *   docker compose -f compose.yml -f compose.prod.yml run --rm --entrypoint "" backend node dist/scripts/structures-rattachements.js
 * Lit DATABASE_URL.
 */
```

- `DATABASE_URL` absente : `console.error("DATABASE_URL n'est pas définie.")`, `process.exitCode = 1`, retour (identique à l'existant).
- Requête unique (typée `client.query<CompteRattachement>`), importer `analyserRattachements` et `CompteRattachement` depuis `'../src/user/rattachements-structure'` :

```sql
SELECT u.id, u.email, u.role::text AS role, u."structureId",
       m.nom AS "structureNom",
       a.id AS "structureAdministreeId", a.nom AS "structureAdministreeNom"
FROM "User" u
LEFT JOIN "Structure" m ON m.id = u."structureId"
LEFT JOIN "Structure" a ON a."adminId" = u.id
WHERE u.role::text IN ('MEDECIN', 'PHARMACIEN', 'STRUCTURE_ADMIN', 'ACCUEIL') OR a.id IS NOT NULL
ORDER BY u."createdAt"
```

  Construire la liste `IN (...)` à partir de `ROLES_ETABLISSEMENT` avec des paramètres `$1..$n` (`client.query(sql, [...ROLES_ETABLISSEMENT])`), pas de concaténation de chaînes.
- Sortie console, exactement ces libellés (aucun tiret cadratin ni demi-cadratin) :

```
Rattachement des comptes aux établissements (lecture seule, aucune donnée modifiée)
Comptes examinés : <total>

Administrateurs sans établissement de rattachement : <n>
  - <id> | <email> | <role> | administre « <structureAdministreeNom> » (<structureAdministreeId>)

Administrateurs rattachés à un autre établissement que celui qu'ils administrent : <n>
  - <id> | <email> | <role> | rattaché à « <structureNom> » (<structureId>) | administre « <structureAdministreeNom> » (<structureAdministreeId>)

Comptes d'un rôle d'établissement sans aucun établissement : <n>
  - <id> | <email> | <role>

Résultat : <somme des trois catégories> compte(s) à vérifier.
```

  Une ligne vide (`console.log('')`) avant chaque titre de catégorie et avant « Résultat ». Message du `.catch` final : `'Échec du contrôle des rattachements :'` suivi du message d'erreur. Code de sortie 0 quand la requête aboutit, même s'il y a des comptes listés.

#### 4c. `package.json`

Dans `scripts`, ajouter après `"telephones:doublons"` : `"structures:rattachements": "ts-node --transpile-only scripts/structures-rattachements.ts"` (penser à la virgule sur la ligne précédente). Rien d'autre ; `package-lock.json` inchangé.

#### 4d. `CLAUDE.md` du dépôt (back)

Ajouter une puce juste APRÈS la puce « **Un numéro par compte (TB17)** » (l. 68) :

`- **Structure de rattachement d'un utilisateur (U1)** : un compte appartient à un établissement par \`User.structureId\` (membres et administrateur) ; l'administrateur l'est aussi par \`Structure.adminId\`. \`GET /users\` et \`GET /users/:userId\` renvoient \`structure { id, nom, type }\` résolue dans cet ordre (\`structureId\`, sinon structure administrée, sinon \`null\`) ; \`structureId\` reste la valeur brute. \`UserResponseDto\` filtre par \`excludeExtraneousValues\` : tout champ ajouté à la réponse doit y être exposé (\`@Expose\`, et \`@Type\` pour un objet). Contrôle en lecture seule des rattachements incomplets ou incohérents : \`npm run structures:rattachements\` (dev) ou \`node dist/scripts/structures-rattachements.js\` lancé par \`docker compose run --rm --entrypoint ""\` (production) ; aucun correctif automatique.`

(Les antislashs ci-dessus ne servent qu'à l'affichage de cette fiche : écrire des accents graves simples dans CLAUDE.md.)

### 5. Tests Jest

#### 5a. `src/user/user.service.spec.ts` (ajouter un `describe` à la fin, ne pas modifier les existants)

`describe('UserService : structure de rattachement (U1)', ...)`, service construit comme dans les `describe` existants (`new UserService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never)`), `prisma = { user: { findMany: jest.fn(), findUnique: jest.fn() } }`. Cas :
1. `getUsers` : trois lignes renvoyées par `findMany` : membre (`structure` = S1, `administeredStructure` null), administrateur rattaché seulement par `adminId` (`structure` null, `administeredStructure` = S2, `structureId` null), patient (les deux null). Attendus : `structure` vaut S1, S2, `null` ; aucune ligne de `data` n'a de clé `administeredStructure` (`not.toHaveProperty('administeredStructure')`) ; `structureId` du deuxième reste `null`.
2. `getUsers` : l'argument de `findMany` contient `select.administeredStructure` égal à `{ select: { id: true, nom: true, type: true } }` et `select.structure` inchangé.
3. `getUsers` : `structure` ET `administeredStructure` renseignés et différents : `structure` renvoyée = celle de `structure` (priorité au membre).
4. `getUser` : administrateur rattaché seulement par `adminId` : `data.structure` = S2, pas de clé `administeredStructure`.
5. `getUser` : `findUnique` renvoie `null` : rejette `NotFoundException`.

S1 = `{ id: 's1', nom: 'Phamarcie la belle etoile', type: 'PHARMACIE' }`, S2 = `{ id: 's2', nom: 'Clinique Donka', type: 'CLINIQUE' }`.

#### 5b. `src/user/user.controller.spec.ts` (nouveau)

Première ligne : `import 'reflect-metadata';`. Contrôleur instancié directement : `new UserController(userService as never, {} as never)` avec `userService = { getUsers: jest.fn(), getUser: jest.fn() }`. Cas :
1. `getUsers()` avec une donnée de service contenant `structure: { id: 's1', nom: 'Phamarcie la belle etoile', type: 'PHARMACIE', email: 'x@y.gn' }` et `password: 'hash'` : après `JSON.parse(JSON.stringify(res.data))`, `structure` vaut exactement `{ id: 's1', nom: 'Phamarcie la belle etoile', type: 'PHARMACIE' }` (clé `email` retirée) et `password` absent.
2. `getUsers()` avec `structure: null` : `structure` vaut `null` dans la sortie.
3. `getUser('u1')` avec `structure` renseignée : `res.data.structure.nom` vaut `'Phamarcie la belle etoile'`.

C'est le test de non-régression de la cause D201 : il doit ÉCHOUER si on retire `@Expose()` de `UserResponseDto.structure` (vérification manuelle par le codeur, ne pas laisser la modification).

#### 5c. `src/user/rattachements-structure.spec.ts` (nouveau)

Un test par règle de la Spec 4a (quatre catégories, y compris « rien » : membre correctement rattaché, administrateur cohérent `structureId === structureAdministreeId`, patient sans structure, ADMIN sans structure), plus `total` et conservation de l'ordre d'entrée.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Spécifiques à U1 :
- Fichiers autorisés, et seulement eux : `src/user/dto/user.dto.ts`, `src/user/user.service.ts`, `src/user/user.service.spec.ts`, `src/user/user.controller.spec.ts` (nouveau), `src/user/rattachements-structure.ts` (nouveau), `src/user/rattachements-structure.spec.ts` (nouveau), `scripts/structures-rattachements.ts` (nouveau), `package.json`, `CLAUDE.md`.
- Ne pas toucher : `src/pharmacie/`, `src/common/rbac/`, `src/roles/`, toute permission ou garde, `src/structure/`, `src/super-admin/`, `src/auth/`, `prisma/` (ni schéma ni migration), `package-lock.json`, le front.
- Aucune modification de données, aucune migration, aucun `docker compose`.
- Commentaires et libellés en français ; aucun tiret cadratin (U+2014) ni demi-cadratin (U+2013) dans les lignes ajoutées.

## Done when

Toutes les commandes lancées depuis `D:\tmp\wt-back-lot7b`, en local :
1. `npx --no-install tsc --noEmit` : aucune erreur.
2. `npx --no-install eslint src/user/dto/user.dto.ts src/user/user.service.ts src/user/user.service.spec.ts src/user/user.controller.spec.ts src/user/rattachements-structure.ts src/user/rattachements-structure.spec.ts scripts/structures-rattachements.ts` : sortie vide, code 0.
3. `npx --no-install jest src/user` : tous verts, dont les nouveaux `describe` des Spec 5a, 5b, 5c.
4. `npx --no-install jest` : suite complète verte.
5. `env -u DATABASE_URL npm run structures:rattachements` (Bash) : affiche `DATABASE_URL n'est pas définie.` et sort en code non nul (le script se charge et compile sous ts-node).
6. `git status --porcelain` ne liste que les fichiers autorisés (plus `docs/plans/` tenu par l'orchestrateur) ; `git diff --quiet -- package-lock.json prisma src/pharmacie src/common/rbac` renvoie 0.
7. (Bash) `git diff -U0 | LC_ALL=C.UTF-8 grep -nP '^\+.*[\x{2013}\x{2014}]'` et `LC_ALL=C.UTF-8 grep -nP '[\x{2013}\x{2014}]'` sur les fichiers nouveaux : aucune ligne (sans `LC_ALL=C.UTF-8`, grep refuse `-P` sur cette machine).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
