# B5 - TB17 : un numéro de téléphone par compte (normalisation E.164, index unique partiel, script de doublons, 409 TELEPHONE_DEJA_UTILISE)

Tier: spécifié (agent implementeur-specifie)
Audience: dev (contrat d'erreur 409/400, migration, script d'exploitation) ; non-dev pour les deux messages d'erreur (textes fixés ci-dessous, à recopier à l'identique)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot2-back` (arbre principal, ne pas créer de branche, NE PAS COMMITER : l'orchestrateur commite après validation). Rien à modifier dans le dépôt racine.
Décisions de référence : `docs/plans/runs/2026-10-20-lot2/decisions.md`, D40 à D51. Plan : `mobile_medconnect/docs/PLAN-APPLICATION-MOBILE.md`, paragraphe TB17 (ligne 1161) et critère ligne 1675.

## Spec

### Contexte (à lire avant de coder)

- `prisma/schema.prisma`, modèle `User` : `telephone String?` sans unicité. Les numéros existants sont saisis espacés (`+224 622 98 87 76`, jeu démo `src/demo/demo.donnees.ts`). Base de dev au 2026-10-21 : 20 comptes avec numéro, 0 doublon, 0 numéro non reconnu, 3 comptes sans numéro.
- Écritures de `User.telephone` (liste exhaustive, trouvée par grep ; `Structure.telephone` n'est PAS concerné) :
  1. `src/auth/auth.service.ts` `register` (`telephone: telephone?.trim()`) ;
  2. `src/auth/auth.service.ts` `editProfile` (`PATCH /auth/profile`, `updateData.telephone = dto.telephone.trim()`) ;
  3. `src/user/user.service.ts` `createByAdmin` ;
  4. `src/user/user.service.ts` `update` (`PATCH /users/:id`) ;
  5. `src/structure/structure.service.ts` `setupStructure` (compte STRUCTURE_ADMIN créé dans `$transaction`, `telephone: dto.telephone.trim()`, obligatoire ; NE PAS toucher `structureTelephone`) ;
  6. `src/structure/structure.service.ts` `createMembre` ;
  7. `src/super-admin/super-admin.service.ts` `createSuperAdmin` (NE PAS toucher `createStructure`, qui écrit `Structure.telephone`) ;
  8. `src/demo/demo.seeder.ts` `versUtilisateur` (`telephone: c.telephone`).
- `src/consent/consent.service.ts` : `phoneCandidates` (privée) et `requestOtp` (`telephone: { in: this.phoneCandidates(telephone) }`).
- Filtre global `src/common/filters/all-exceptions.filter.ts` : une `HttpException` < 500 garde son `message` (s'il n'est pas un libellé anglais par défaut), recopie `code` s'il est au catalogue `src/common/filters/codes-erreur.ts`, et recopie `champs` quand `code === 'VALIDATION'`. Un P2002 non traité devient un 409 générique « Cette information existe déjà. ».
- Avec l'adaptateur `@prisma/adapter-pg`, un P2002 porte le nom de la colonne dans son message (« Unique constraint failed on the fields: (`"telephoneNormalise"`) ») ; la forme de `meta` n'est pas garantie.
- Prisma 7.8 : la préversion `partialIndexes` accepte `@@unique([champ], where: raw("..."))`. Vérifié par l'orchestrateur sur une base jetable : colonne + trigger + index partiel déclaré ainsi donnent un `prisma migrate diff` vide ; une colonne `GENERATED ALWAYS` donne une dérive (ne pas l'utiliser).
- Les DTO ne changent pas (D44) : `@Length(8, 20)` admet déjà toutes les formes valides.
- `super-admin.service.ts` a une dette lint préexistante : 14 erreurs `prettier/prettier` et 1 `no-unsafe-assignment` (ligne `type: type as any,` de `createStructure`).
- Imports du projet : bare specifier `src/...` et `generated/prisma/client` dans `src/` ; imports RELATIFS dans `src/common/telephone/telephone.ts`, `doublons-telephone.ts` et dans le script (exécuté par ts-node sans `tsconfig-paths`, et compilé dans `dist/scripts/` en production).

Tout ce qui suit est livré dans cette seule tâche (la colonne, le trigger, l'index, la fonction partagée et les contrôles ne fonctionnent qu'ensemble).

### 1. Nouveau fichier `src/common/telephone/telephone.ts` (aucun import)

```ts
/**
 * Numéro de téléphone guinéen au format E.164 (TB17). Source unique de la règle,
 * reprise à l'identique par la fonction SQL "telephone_e164" de la migration
 * 20261021120000_tb17_telephone_unique : modifier les deux ensemble.
 */

// Séparateurs tolérés à la saisie : espace, tabulation, espaces insécables, point, tiret.
const SEPARATEURS = /[ \t\u00a0\u202f.-]/g;
// Indicatif facultatif (+224, 00224 ou 224), puis exactement 9 chiffres.
const FORMAT = /^(?:\+224|00224|224)?([0-9]{9})$/;

export const INDICATIF_GUINEE = '+224';

export const MESSAGE_TELEPHONE_INVALIDE =
  "Ce numéro de téléphone n'est pas valide. Saisissez un numéro guinéen à 9 chiffres, par exemple 622 12 34 56.";

export const MESSAGE_TELEPHONE_DEJA_UTILISE =
  'Ce numéro est déjà utilisé par un autre compte.';

/** « 622 98 87 76 », « 00224-622-98-87-76 » ou « +224622988776 » donnent « +224622988776 » ; null si invalide. */
export function normaliserTelephone(
  brut: string | null | undefined,
): string | null {
  if (typeof brut !== 'string') return null;
  const correspondance = FORMAT.exec(brut.replace(SEPARATEURS, ''));
  return correspondance ? `${INDICATIF_GUINEE}${correspondance[1]}` : null;
}
```
Pas de `trim()` (les espaces en bord sont des séparateurs ; un saut de ligne rend le numéro invalide, comme en SQL).

### 2. Nouveau fichier `src/common/telephone/telephone-unicite.ts`

Imports : `BadRequestException`, `ConflictException` de `@nestjs/common` ; `Prisma` de `generated/prisma/client` ; `MESSAGE_TELEPHONE_DEJA_UTILISE`, `MESSAGE_TELEPHONE_INVALIDE`, `normaliserTelephone` de `./telephone`.

Exporter exactement :
```ts
/** Nom de la colonne dérivée portant l'index unique partiel (TB17). */
export const COLONNE_TELEPHONE_NORMALISE = 'telephoneNormalise';

/** 409 TELEPHONE_DEJA_UTILISE, message affiché tel quel. */
export function erreurTelephoneDejaUtilise(): ConflictException {
  return new ConflictException({
    message: MESSAGE_TELEPHONE_DEJA_UTILISE,
    code: 'TELEPHONE_DEJA_UTILISE',
  });
}

/** Numéro normalisé, ou 400 VALIDATION sur le champ telephone. */
export function exigerTelephone(brut: string): string {
  const e164 = normaliserTelephone(brut);
  if (!e164) {
    throw new BadRequestException({
      message: MESSAGE_TELEPHONE_INVALIDE,
      code: 'VALIDATION',
      champs: [{ champ: 'telephone', contraintes: ['formatTelephone'] }],
    });
  }
  return e164;
}

/** 409 si un autre compte porte déjà ce numéro (comparaison sur la forme normalisée). */
export async function verifierTelephoneLibre(
  client: Prisma.TransactionClient,
  telephoneE164: string,
  userIdExclu?: string,
): Promise<void> {
  const autre = await client.user.findFirst({
    where: {
      telephoneNormalise: telephoneE164,
      ...(userIdExclu ? { id: { not: userIdExclu } } : {}),
    },
    select: { id: true },
  });
  if (autre) throw erreurTelephoneDejaUtilise();
}

/** Vrai pour un P2002 levé par l'index unique du téléphone (course entre deux écritures). */
export function estConflitTelephone(erreur: unknown): boolean { ... }

/** Exécute l'écriture et traduit un P2002 du téléphone en 409 TELEPHONE_DEJA_UTILISE. */
export async function avecTelephoneUnique<T>(ecriture: Promise<T>): Promise<T> {
  try {
    return await ecriture;
  } catch (erreur) {
    if (estConflitTelephone(erreur)) throw erreurTelephoneDejaUtilise();
    throw erreur;
  }
}
```
`estConflitTelephone` : `false` si `!(erreur instanceof Prisma.PrismaClientKnownRequestError) || erreur.code !== 'P2002'` ; sinon construire `let meta = ''; try { meta = JSON.stringify(erreur.meta ?? {}); } catch { meta = ''; }` et renvoyer `` `${erreur.message} ${meta}`.includes(COLONNE_TELEPHONE_NORMALISE) ``.
Commentaire de tête du fichier (français) : contrôles d'unicité du téléphone partagés par toutes les écritures de `User.telephone` (D40 à D49).
Si `tsc` refuse de passer `this.prisma` (PrismaService) là où `Prisma.TransactionClient` est attendu, typer le paramètre `client: Pick<Prisma.TransactionClient, 'user'>` ; ne rien changer d'autre.

### 3. Nouveau fichier `src/common/telephone/doublons-telephone.ts` (seul import : `./telephone`)

```ts
export interface CompteTelephone {
  id: string;
  email: string;
  role: string;
  telephone: string;
  createdAt: Date;
}
export interface GroupeDoublon {
  /** Forme normalisée commune. */
  numero: string;
  /** Du plus ancien au plus récent (createdAt, puis id). */
  comptes: CompteTelephone[];
}
export interface AnalyseDoublons {
  total: number;
  doublons: GroupeDoublon[];
  nonReconnus: CompteTelephone[];
}
/** Regroupe les comptes par numéro normalisé (lecture seule, aucune base). */
export function analyserDoublons(comptes: CompteTelephone[]): AnalyseDoublons
```
Règles : `total = comptes.length` ; regrouper par `normaliserTelephone(c.telephone)` ; un groupe d'au moins 2 comptes est un doublon ; `doublons` trié par `numero` croissant (`localeCompare`), comptes de chaque groupe triés par `createdAt` croissant puis `id` ; `nonReconnus` = comptes dont la normalisation donne `null`, triés de la même façon.

### 4. Nouveau script `scripts/telephones-doublons.ts`

En-tête (commentaire) : objet (liste les comptes qui partagent un même numéro normalisé et les numéros non reconnus, en lecture seule, à lancer AVANT la migration `20261021120000_tb17_telephone_unique`), usage dev `docker compose exec -T backend npm run telephones:doublons`, usage production `docker compose -f compose.yml -f compose.prod.yml run --rm --entrypoint "" backend node dist/scripts/telephones-doublons.js` (n'applique pas les migrations), lit `DATABASE_URL`.

Code :
- `import { Client } from 'pg';` et `import { analyserDoublons, type CompteTelephone } from '../src/common/telephone/doublons-telephone';`.
- `async function principal(): Promise<void>` : si `process.env.DATABASE_URL` est vide, `console.error("DATABASE_URL n'est pas définie.")`, `process.exitCode = 1`, retour. Sinon `new Client({ connectionString })`, `connect()`, `query('BEGIN READ ONLY')`, `query<{ id: string; email: string; role: string; telephone: string; createdAt: Date }>('SELECT id, email, role::text AS role, telephone, "createdAt" FROM "User" WHERE telephone IS NOT NULL')`, puis dans `finally` : `query('ROLLBACK')` (erreur ignorée) et `end()`.
- Sortie console, exactement ces gabarits (une ligne vide entre les blocs) :
  ```
  Numéros de téléphone en double (lecture seule, aucune donnée modifiée)
  Comptes avec un numéro : <total>

  <numero> : <n> comptes
    - <id> | <email> | <role> | créé le <createdAt ISO> | saisi « <telephone> » (plus ancien)
    - <id> | <email> | <role> | créé le <createdAt ISO> | saisi « <telephone> »

  Numéros non reconnus, ignorés par l'unicité : <n>
    - <id> | <email> | <role> | saisi « <telephone> »

  Résultat : <g> numéro(s) en double, <c> compte(s) concerné(s).
  ```
  Le bloc « Numéros non reconnus » n'affiche ses lignes `- ...` que s'il y en a (la ligne de compte est toujours affichée). `(plus ancien)` seulement sur le premier compte de chaque groupe. `<c>` = somme des tailles des groupes.
- `principal().catch((erreur: unknown) => { console.error('Échec de la recherche des doublons :', erreur instanceof Error ? erreur.message : erreur); process.exitCode = 1; });` Code de sortie 0 sinon, doublons ou non.

### 5. `package.json`

Dans `scripts`, ajouter après `"test:e2e"` : `"telephones:doublons": "ts-node --transpile-only scripts/telephones-doublons.ts"`. Rien d'autre ; `package-lock.json` inchangé.

### 6. Migration `prisma/migrations/20261021120000_tb17_telephone_unique/migration.sql`

Contenu exact (commentaires compris) :
```sql
-- TB17 : un numéro de téléphone par compte.
-- Colonne dérivée "telephoneNormalise" (E.164, +224 suivi de 9 chiffres), tenue à jour
-- par un trigger à partir de "telephone". Aucune valeur existante n'est modifiée :
-- seule la nouvelle colonne est calculée. Échoue (rien n'est appliqué) si deux comptes
-- portent déjà le même numéro : lancer d'abord npm run telephones:doublons.

-- Miroir exact de normaliserTelephone (src/common/telephone/telephone.ts).
CREATE FUNCTION "telephone_e164"(brut TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT '+224' || substring(regexp_replace(brut, '[ \t\u00a0\u202f.-]', '', 'g') from '^(?:\+224|00224|224)?([0-9]{9})$')
$$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "telephoneNormalise" TEXT;

UPDATE "User" SET "telephoneNormalise" = "telephone_e164"("telephone") WHERE "telephone" IS NOT NULL;

CREATE FUNCTION "user_telephone_normalise"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."telephoneNormalise" := "telephone_e164"(NEW."telephone");
  RETURN NEW;
END
$$;

CREATE TRIGGER "user_telephone_normalise"
BEFORE INSERT OR UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION "user_telephone_normalise"();

-- CreateIndex
CREATE UNIQUE INDEX "User_telephoneNormalise_key" ON "User"("telephoneNormalise") WHERE "telephoneNormalise" IS NOT NULL;
```
Aucune autre instruction (aucun `UPDATE` de `telephone`, aucune suppression).

### 7. `prisma/schema.prisma`

- Bloc `generator client` : ajouter la ligne `previewFeatures = ["partialIndexes"]` après `output`.
- Modèle `User`, juste après `telephone String?` :
  ```prisma
  // Forme E.164 de `telephone`, calculée par le trigger PostgreSQL
  // "user_telephone_normalise" (TB17). Ne jamais l'écrire depuis l'application.
  telephoneNormalise String?
  ```
- Dans `User`, juste avant `createdAt DateTime @default(now())`, ajouter :
  ```prisma
  // Un numéro par compte (TB17) ; les comptes sans numéro restent possibles.
  @@unique([telephoneNormalise], where: raw("\"telephoneNormalise\" IS NOT NULL"))
  ```
  (pas de `map` : le nom par défaut est `User_telephoneNormalise_key`, identique à la migration). Si Prisma refuse un `@@` avant des champs, placer ces deux lignes en fin de modèle, après `updatedAt`.

### 8. Catalogue `src/common/filters/codes-erreur.ts`

Ajouter en dernière position, après `'VERSION_OBSOLETE',` :
```ts
  // Numéro de téléphone déjà porté par un autre compte (409).
  'TELEPHONE_DEJA_UTILISE',
```

### 9. Écritures de `User.telephone` (points 1 à 7 du contexte)

Imports depuis `src/common/telephone/telephone-unicite` : seulement les fonctions utilisées dans le fichier. Règle commune : le contrôle de format et de disponibilité se fait APRÈS les contrôles existants (email, rôle, etc.), AVANT le hachage du mot de passe quand il est après ; la valeur écrite est la forme normalisée ; l'appel Prisma qui écrit est enveloppé par `avecTelephoneUnique(...)`.

- **Création** (`register`, `createByAdmin`, `createMembre`, `createSuperAdmin`) :
  ```ts
  const telephoneE164 = <source> ? exigerTelephone(<source>) : undefined;
  if (telephoneE164) await verifierTelephoneLibre(this.prisma, telephoneE164);
  ```
  avec `<source>` = `telephone` (register, createByAdmin) ou `dto.telephone` (createMembre, createSuperAdmin) ; puis `telephone: telephoneE164,` dans `data` et `const x = await avecTelephoneUnique(this.prisma.user.create({ ... }));`.
- **`setupStructure`** (téléphone obligatoire) : avant `bcrypt.hash`, `const telephoneAdmin = exigerTelephone(dto.telephone); await verifierTelephoneLibre(this.prisma, telephoneAdmin);` ; dans la transaction `const admin = await avecTelephoneUnique(tx.user.create({ ... telephone: telephoneAdmin, ... }));`.
- **Mise à jour** (`editProfile` avec `userId`, `update` avec `userId`) : remplacer les deux lignes `if (dto.telephone !== undefined) updateData.telephone = dto.telephone.trim();` par
  ```ts
  if (dto.telephone === null) {
    // null retire le numéro (D45).
    updateData.telephone = null;
  } else if (dto.telephone !== undefined) {
    const telephoneE164 = exigerTelephone(dto.telephone);
    await verifierTelephoneLibre(this.prisma, telephoneE164, userId);
    updateData.telephone = telephoneE164;
  }
  ```
  et envelopper l'appel `this.prisma.user.update(...)` par `avecTelephoneUnique(...)`. Si `tsc` refuse `dto.telephone === null` (type `string | undefined`), écrire `(dto.telephone as string | null | undefined) === null`. Ne pas toucher aux types des DTO.
- **`super-admin.service.ts`** : lancer `docker compose exec -T backend npx eslint --fix src/super-admin/super-admin.service.ts` (corrige les 14 erreurs prettier), puis ajouter au-dessus de la ligne `type: type as any,` : `// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Dette préexistante, backlog points 21 et 22`. Aucune autre modification de `createStructure`.

### 10. `src/consent/consent.service.ts`

- Importer `normaliserTelephone` depuis `'src/common/telephone/telephone'`.
- Remplacer le corps de `phoneCandidates` (garder nom, signature, visibilité ; nouveau commentaire « Formes enregistrées possibles d'un même numéro, pour les saisies antérieures à TB17. ») :
  ```ts
  const saisi = phone.trim();
  const e164 = normaliserTelephone(phone);
  if (!e164) return saisi ? [saisi] : [];
  const local9 = e164.slice(4);
  return Array.from(
    new Set([e164, local9, `224${local9}`, `00224${local9}`, saisi].filter(Boolean)),
  );
  ```
- Dans `requestOtp`, remplacer la clause `where` par :
  ```ts
  where: {
    role: 'PATIENT',
    OR: [
      ...(e164 ? [{ telephoneNormalise: e164 }] : []),
      { telephone: { in: this.phoneCandidates(telephone) } },
    ],
  },
  ```
  avec `const e164 = normaliserTelephone(telephone);` juste avant le `findFirst`. Rien d'autre.

### 11. `src/demo/demo.seeder.ts`

Importer `normaliserTelephone` depuis `'src/common/telephone/telephone'` ; dans `versUtilisateur`, `telephone: normaliserTelephone(c.telephone),`. Ne pas modifier `demo.donnees.ts` ni le téléphone des structures.

### 12. Documentation `back_medconnect/CLAUDE.md`

Section « Conventions importantes (pièges) », ajouter une puce juste après la puce « **Version et configuration publiques (TB5)** » :
```
- **Un numéro par compte (TB17)** : `normaliserTelephone` (`src/common/telephone/telephone.ts`) est la seule règle (préfixe `+224`, `00224`, `224` ou aucun, puis 9 chiffres ; espaces, points et tirets ignorés ; résultat `+224XXXXXXXXX`), reprise à l'identique par la fonction SQL `telephone_e164`. Toute écriture de `User.telephone` passe par `exigerTelephone` (400 `VALIDATION`, champ `telephone`), `verifierTelephoneLibre` et `avecTelephoneUnique` (`src/common/telephone/telephone-unicite.ts`) : 409 `TELEPHONE_DEJA_UTILISE` « Ce numéro est déjà utilisé par un autre compte. », y compris en cas de course (P2002). L'unicité repose sur la colonne dérivée `User.telephoneNormalise`, tenue par un trigger PostgreSQL (ne jamais l'écrire), et sur un index unique partiel (préversion Prisma `partialIndexes`) : un compte sans numéro reste possible, un compte désactivé garde son numéro. Les anciennes valeurs de `telephone` ne sont pas réécrites. Avant de déployer la migration `20261021120000_tb17_telephone_unique`, lister les doublons en lecture seule : `npm run telephones:doublons` (dev) ou `node dist/scripts/telephones-doublons.js` lancé par `docker compose run --rm --entrypoint ""` (production) ; s'il en reste, la migration échoue sans rien appliquer (`prisma migrate resolve --rolled-back` puis nouveau déploiement après décision du porteur).
```
Rien d'autre dans ce fichier.

### 13. Tests Jest (sous `src/`, intitulés en français)

**a. Nouveau `src/common/telephone/telephone.spec.ts`**
- Donnent `'+224622988776'` : `'+224622988776'`, `'622988776'`, `'622 98 87 76'`, `'622-98-87-76'`, `'622.98.87.76'`, `'00224 622 98 87 76'`, `'00224-622-98-87-76'`, `'224622988776'`, `'+224 622 98 87 76'`, `' +224 622 98 87 76 '`, `'+224\u00a0622\u00a098\u00a087\u00a076'`, `'+224\t622988776'`.
- Donnent `null` : `''`, `'   '`, `null`, `undefined`, `'62298877'` (8 chiffres), `'6229887761'` (10), `'+33612345678'`, `'+224 62298877'`, `'abc622988776'`, `'+224 (622) 98 87 76'`, `'622\n988776'`, `'++224622988776'`.
- `'224123456'` (9 chiffres commençant par 224) donne `'+224224123456'`.

**b. Nouveau `src/common/telephone/telephone-unicite.spec.ts`** (doublure `{ user: { findFirst: jest.fn() } }` passée `as never`)
1. `exigerTelephone('622 98 87 76')` renvoie `'+224622988776'` ; `exigerTelephone('12345')` lève une `BadRequestException` dont `getResponse()` vaut `{ message: MESSAGE_TELEPHONE_INVALIDE, code: 'VALIDATION', champs: [{ champ: 'telephone', contraintes: ['formatTelephone'] }] }` (`toEqual`).
2. `verifierTelephoneLibre` : `findFirst` résolu à `null` : résout sans erreur, appelé avec `where: { telephoneNormalise: '+224622988776' }` ; avec `userIdExclu = 'u1'` : `where: { telephoneNormalise: '+224622988776', id: { not: 'u1' } }` ; `findFirst` résolu à `{ id: 'autre' }` : rejette une `ConflictException` dont `getResponse()` vaut `{ message: 'Ce numéro est déjà utilisé par un autre compte.', code: 'TELEPHONE_DEJA_UTILISE' }`.
3. `avecTelephoneUnique` : promesse résolue : renvoie la valeur ; `new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`"telephoneNormalise"`)', { code: 'P2002', clientVersion: '7.0.0' })` : `ConflictException` code `TELEPHONE_DEJA_UTILISE` ; P2002 avec `meta: { target: ['telephoneNormalise'] }` et message neutre : même 409 ; P2002 dont message et meta citent `email` : rejette la même erreur d'origine (`toBe`) ; `new Error('panne')` : rejette la même erreur.
4. Au niveau HTTP du filtre : `new AllExceptionsFilter()` appliqué à `erreurTelephoneDejaUtilise()` (reprendre le motif d'hôte simulé de `src/common/filters/all-exceptions.filter.spec.ts`) produit `statusCode: 409`, `code: 'TELEPHONE_DEJA_UTILISE'`, `message: 'Ce numéro est déjà utilisé par un autre compte.'` ; et à l'exception de `exigerTelephone('12345')` : `statusCode: 400`, `code: 'VALIDATION'`, `champs: [{ champ: 'telephone', contraintes: ['formatTelephone'] }]`, `message: MESSAGE_TELEPHONE_INVALIDE`.

**c. Nouveau `src/common/telephone/doublons-telephone.spec.ts`**
- Quatre comptes : A `'+224 622 98 87 76'` (créé 2026-01-02), B `'622988776'` (créé 2026-01-01), C `'+224 628 40 50 61'`, D `'12345'` : `total` 4, un seul groupe `{ numero: '+224622988776', comptes: [B, A] }`, `nonReconnus` `[D]`.
- Liste vide : `{ total: 0, doublons: [], nonReconnus: [] }`.
- Deux groupes : triés par `numero` ; à `createdAt` égal, tri par `id`.

**d. `src/auth/auth.service.spec.ts`** : nouveau `describe('TB17 : un numéro par compte', ...)` (réutiliser les doublures du fichier, `prisma.user.findUnique` résolu à `null` pour l'email ; `prisma.user.create` résolu comme dans le test « crée un patient actif ») :
1. inscription avec `'622 98 87 76'`, aucun compte ne porte ce numéro : `create` reçoit `data.telephone === '+224622988776'`, `findFirst` appelé avec `where: { telephoneNormalise: '+224622988776' }`.
2. deux formats d'un même numéro : `findFirst` simule un compte existant (`mockImplementation` qui résout `{ id: 'u-existant' }` quand `where.telephoneNormalise === '+224622988776'`, sinon `null`) ; inscription avec `'00224-622-98-87-76'` puis avec `'622988776'` : chaque fois `ConflictException` de réponse `{ message: 'Ce numéro est déjà utilisé par un autre compte.', code: 'TELEPHONE_DEJA_UTILISE' }`, et `create` jamais appelé.
3. inscription sans numéro : réussit, `findFirst` jamais appelé, `create` reçoit `data.telephone === undefined`.
4. numéro invalide `'12345'` : `BadRequestException` code `VALIDATION`, `create` jamais appelé.
5. course : `findFirst` résolu à `null`, `create` rejeté par un P2002 citant `telephoneNormalise` : `ConflictException` code `TELEPHONE_DEJA_UTILISE`.
6. `editProfile` (`prisma.user.findUnique` résolu à `utilisateur()` du fichier, `update` résolu à un objet quelconque) : `{ telephone: '+224 622 98 87 76' }` : `findFirst` appelé avec `where: { telephoneNormalise: '+224622988776', id: { not: 'u1' } }`, `update` reçoit `data.telephone === '+224622988776'` ; même saisie quand `findFirst` résout `{ id: 'u2' }` : 409 `TELEPHONE_DEJA_UTILISE`, `update` jamais appelé ; `{ telephone: null }` : `update` reçoit `data.telephone === null`, `findFirst` jamais appelé.
Ne pas modifier les tests existants (ajouter `findFirst` aux `beforeEach` seulement s'il manque).

**e. `src/user/user.service.spec.ts`** : nouveau `describe('UserService : téléphone unique (TB17)', ...)` avec sa propre doublure `prisma.user` (`findUnique`, `findFirst`, `create`, `update`) et `rolesService: { resolveAssignableRoleId: jest.fn().mockResolvedValue(null) }`, construit comme le `describe` existant :
- `createByAdmin` (`role: 'MEDECIN'`, email libre) avec `'622-98-87-76'` quand `findFirst` résout `{ id: 'autre' }` : 409 `TELEPHONE_DEJA_UTILISE`, `create` jamais appelé ; avec `findFirst` à `null` : `create` reçoit `data.telephone === '+224622988776'`.
- `update('u1', { telephone: '00224622988776' })` (`findUnique` résout `{ id: 'u1', email: 'a@b.gn' }`) : `findFirst` appelé avec `id: { not: 'u1' }` et `update` reçoit `'+224622988776'`.

**f. Nouveau `src/demo/demo.telephones.spec.ts`** : pour chaque compte de `COMPTES_DEMO`, `normaliserTelephone(c.telephone)` n'est pas `null` ; l'ensemble des formes normalisées a la taille de `COMPTES_DEMO` (numéros distincts).

### 14. Ordre d'exécution sur la base de dev (après le code, avant le « Done when »)

Toutes les commandes depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (Git Bash).
1. Empreinte des données avant migration : `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT md5(string_agg(id || chr(58) || coalesce(telephone, chr(48)), chr(44) ORDER BY id)) FROM \"User\""'` ; noter la valeur.
2. `docker compose exec -T backend npm run telephones:doublons` ; noter la dernière ligne.
3. Seulement si la ligne 2 annonce au moins un numéro en double (données de test, D48), vider les plus récents puis relancer l'étape 2 (doit annoncer 0) et refaire l'étape 1 :
   ```bash
   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
   UPDATE "User" SET telephone = NULL WHERE id IN (
     SELECT id FROM (
       SELECT id, row_number() OVER (PARTITION BY e ORDER BY "createdAt", id) AS rang
       FROM (SELECT id, "createdAt", '+224' || substring(regexp_replace(telephone, '[ \t\u00a0\u202f.-]', '', 'g') from '^(?:\+224|00224|224)?([0-9]{9})$') AS e FROM "User") n
       WHERE e IS NOT NULL
     ) r WHERE rang > 1
   );
   SQL
   ```
   Recopier cette commande et son résultat (`UPDATE n`) dans le Return.
4. `docker compose exec -T backend npx prisma migrate deploy` puis `docker compose exec -T backend npx prisma generate`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Propres à B5 :
- Aucune nouvelle dépendance npm ; `package-lock.json` inchangé.
- La migration ne contient que le SQL du point 6 ; jamais de `prisma migrate dev` ni de `prisma db push` ; aucune modification des migrations existantes.
- Aucune écriture applicative de `telephoneNormalise` (seul le trigger l'écrit).
- Ne pas modifier les DTO ni `demo.donnees.ts`, ni `Structure.telephone` (création, configuration, mise à jour de structure).
- Textes visibles (deux messages d'erreur, sorties du script, commentaires) en français, recopiés à l'identique, sans tiret cadratin ni demi-cadratin.
- Ne jamais lire ni modifier un fichier `.env` réel.
- Si une commande du « Done when » échoue sur un fichier hors de la liste ci-dessous (dette existante), ne pas le corriger : le signaler dans le Return.

Fichiers touchés (liste fermée) :
- nouveaux : `src/common/telephone/telephone.ts`, `src/common/telephone/telephone.spec.ts`, `src/common/telephone/telephone-unicite.ts`, `src/common/telephone/telephone-unicite.spec.ts`, `src/common/telephone/doublons-telephone.ts`, `src/common/telephone/doublons-telephone.spec.ts`, `src/demo/demo.telephones.spec.ts`, `scripts/telephones-doublons.ts`, `prisma/migrations/20261021120000_tb17_telephone_unique/migration.sql` ;
- modifiés : `prisma/schema.prisma`, `package.json`, `src/common/filters/codes-erreur.ts`, `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`, `src/user/user.service.ts`, `src/user/user.service.spec.ts`, `src/structure/structure.service.ts`, `src/super-admin/super-admin.service.ts`, `src/consent/consent.service.ts`, `src/demo/demo.seeder.ts`, `CLAUDE.md`.

## Done when

Toutes les commandes lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (Git Bash, conteneurs `backend` et `postgres` démarrés), après le point 14 :

1. `docker compose exec -T backend npx tsc --noEmit` : sortie vide, code 0.
2. `docker compose exec -T backend npx eslint src/common/telephone/telephone.ts src/common/telephone/telephone.spec.ts src/common/telephone/telephone-unicite.ts src/common/telephone/telephone-unicite.spec.ts src/common/telephone/doublons-telephone.ts src/common/telephone/doublons-telephone.spec.ts src/demo/demo.telephones.spec.ts scripts/telephones-doublons.ts src/common/filters/codes-erreur.ts src/auth/auth.service.ts src/auth/auth.service.spec.ts src/user/user.service.ts src/user/user.service.spec.ts src/structure/structure.service.ts src/super-admin/super-admin.service.ts src/consent/consent.service.ts src/demo/demo.seeder.ts` : 0 erreur.
3. `docker compose exec -T backend npx jest` : toutes les suites vertes, dont les quatre nouvelles (`telephone`, `telephone-unicite`, `doublons-telephone`, `demo.telephones`) et les nouveaux `describe` de `auth.service.spec.ts` et `user.service.spec.ts`.
4. Script en lecture seule : `docker compose exec -T backend npm run telephones:doublons` se termine par `Résultat : 0 numéro(s) en double, 0 compte(s) concerné(s).` ; et l'empreinte du point 14.1 relancée APRÈS la migration est identique à celle d'avant (la migration n'a changé aucune valeur de `telephone`).
5. Migration et schéma alignés : `docker compose exec -T backend npx prisma migrate status` annonce le schéma à jour ; `docker compose exec -T backend npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` affiche `-- This is an empty migration.`
6. Base : `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT count(*) FROM \"User\" WHERE telephone IS NOT NULL AND \"telephoneNormalise\" IS NULL" -c "SELECT count(*) FROM \"User\" WHERE telephone IS NULL" -c "SELECT indexdef FROM pg_indexes WHERE indexname = '"'"'User_telephoneNormalise_key'"'"'"'` affiche `0`, un nombre au moins égal à 1 (comptes sans numéro conservés), puis une définition `CREATE UNIQUE INDEX ... WHERE ("telephoneNormalise" IS NOT NULL)`.
7. Unicité en base, sans rien garder : 
   ```bash
   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
   BEGIN;
   UPDATE "User" SET telephone = '622-10-20-31' WHERE id = (SELECT id FROM "User" WHERE "telephoneNormalise" IS DISTINCT FROM '+224622102031' ORDER BY "createdAt" LIMIT 1);
   ROLLBACK;
   SQL
   ```
   affiche une erreur `duplicate key value violates unique constraint "User_telephoneNormalise_key"` (si aucun compte ne porte `+224622102031` en dev, prendre un `telephoneNormalise` existant et l'écrire sous une autre forme, le noter dans le Return).
8. Fumée HTTP sur le serveur de dev (rechargé automatiquement ; rien n'est créé) : `docker compose exec -T backend node -e "const b={email:'tb17-essai@example.test',password:'MotDePasse1',nom:'Essai',prenom:'Numero'};(async()=>{for(const t of ['00224 622-10-20-31','12345']){const r=await fetch('http://localhost:3001/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...b,telephone:t})});console.log(t,r.status,await r.text())}})()"` affiche `409` avec `"code":"TELEPHONE_DEJA_UTILISE"` et le message exact, puis `400` avec `"code":"VALIDATION"` et `"champ":"telephone"` ; ensuite `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM \"User\" WHERE email = '"'"'tb17-essai@example.test'"'"'"'` affiche `0`. (Même remarque qu'au point 7 si `+224622102031` n'existe pas.)
9. Script présent dans la compilation de production : `docker compose exec -T backend npx tsc -p tsconfig.build.json --listFilesOnly | grep -c "scripts/telephones-doublons.ts"` affiche `1`.
10. Couverture des écritures : `grep -rn "telephone: .*trim()\|telephone = dto.telephone.trim()" back_medconnect/src/auth/auth.service.ts back_medconnect/src/user/user.service.ts back_medconnect/src/super-admin/super-admin.service.ts back_medconnect/src/structure/structure.service.ts` ne renvoie que les lignes de `Structure.telephone` (`createStructure` dans super-admin, `structureTelephone` et `updateStructure` dans structure), aucune ligne d'écriture de `User`.
11. (Git Bash) `git -C back_medconnect diff -U0 | grep "^+" | LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]"` et `LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]" back_medconnect/src/common/telephone/*.ts back_medconnect/scripts/telephones-doublons.ts back_medconnect/prisma/migrations/20261021120000_tb17_telephone_unique/migration.sql back_medconnect/src/demo/demo.telephones.spec.ts` : aucune ligne.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

Liste des fichiers modifiés ou créés, puis : empreinte avant et après (point 14.1), dernière ligne du script (point 14.2), commande de vidage et son résultat si elle a servi (point 14.3), puis une ligne de résultat par commande 1 à 11 du « Done when ».

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
