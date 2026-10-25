# PB01 - Harnais de base de test

Tier: dur (agent implementeur-specifie : codeur Sonnet selon l'arbitrage A2 ; fiche détaillée, aucune décision laissée ouverte)
Audience: dev
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Créer un harnais de tests sur une vraie base PostgreSQL jetable, lancé par `npm run test:db` et **hors** `npm test` (le pre-push ne change pas, D444). Il sert à toutes les tâches de migration de la tranche (PB03, PB05, PB06, PB07, PB09) et aux instantanés de PB02. Aucun changement de comportement de l'application : aucun fichier sous `src/` n'est modifié, aucune migration Prisma n'est ajoutée, `prisma/schema.prisma` n'est pas touché.

Décisions qui encadrent cette tâche (à lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D432, D444, D448 à D455.

### Contexte vérifié (ne pas re-découvrir)

- Le conteneur `backend` monte `back_medconnect/` sur `/app` ; `DATABASE_URL` y pointe le Postgres 17 du compose (rôle superutilisateur, droit `CREATEDB`), avec un paramètre `?schema=public`. `psql` n'existe pas dans le conteneur. `TEST_DATABASE_URL` n'est pas définie aujourd'hui.
- `pg` 8.20 et `@types/pg` sont présents par `@prisma/adapter-pg` ; `PrismaService` (`src/common/services/prisma.service.ts`) importe déjà `Pool` de `pg`. **N'ajouter aucune dépendance** (D452) et ne pas toucher `package-lock.json`.
- `PrismaService` lit `process.env.DATABASE_URL` **dans son constructeur** ; `onModuleDestroy()` fait `$disconnect()` puis `pool.end()`.
- `jest.config.js` (racine) a `roots: ['<rootDir>/src']` et `testRegex: '.*\\.spec\\.ts$'` : un fichier `test/db/*.db-spec.ts` n'est jamais pris par `npm test`. Ne pas modifier `jest.config.js`.
- Migrations existantes : 14 dossiers sous `prisma/migrations/` (de `20260425202451_init` à `20261022120000_ventes_pharmacie`) plus `migration_lock.toml`. Certains noms n'ont pas d'heure (`20260704_add_soft_delete_audit_trail`) : le tri `Array.prototype.sort()` par défaut donne le même ordre que Prisma. `20260426144501_init_migration` contient un `BEGIN; ... COMMIT;` explicite et deux migrations font `ALTER TYPE ... ADD VALUE` : envoyées en une seule requête simple, elles passent comme sous Prisma.
- `tsconfig.json` n'a pas de `include` : tout `.ts` du dépôt (dont `test/`) est typé par `tsc --noEmit` et vu par ESLint (`recommendedTypeChecked`, règle `require-await` active : pas de fonction `async` sans `await`). `tsconfig.build.json` exclut `test` : rien de `test/db` ne part dans `dist`.
- Le CLI Prisma 7.8 accepte `--config <chemin>`. Binaire : `node_modules/prisma/build/index.js`.

### Fichiers à créer ou modifier (liste fermée)

| Fichier | Action |
|---|---|
| `package.json` | ajouter le script `"test:db": "jest --config ./test/db/jest-db.json --runInBand"` juste après `"test:e2e"` ; rien d'autre |
| `test/db/jest-db.json` | créer |
| `test/db/harnais.ts` | créer |
| `test/db/fixtures/format-actuel.ts` | créer |
| `test/db/fixtures/fautive/prisma.config.ts` | créer |
| `test/db/fixtures/fautive/migrations/migration_lock.toml` | créer |
| `test/db/fixtures/fautive/migrations/20990101000000_harnais_fautive/migration.sql` | créer |
| `test/db/fixtures/temoin/migrations/20990101000001_harnais_temoin/migration.sql` | créer |
| `test/db/fixtures/temoin/retours-arriere/20990101000001_harnais_temoin.down.sql` | créer |
| `test/db/harnais.db-spec.ts` | créer |
| `prisma/retours-arriere/README.md` | créer (D453) |

### 1. `test/db/jest-db.json` (contenu exact)

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "../..",
  "roots": ["<rootDir>/test/db"],
  "testRegex": ".*\\.db-spec\\.ts$",
  "setupFiles": ["<rootDir>/test/jest.setup-env.ts"],
  "transform": {
    "^.+\\.(t|j)s$": ["ts-jest", { "tsconfig": "<rootDir>/tsconfig.json" }]
  },
  "moduleDirectories": ["node_modules", "<rootDir>"],
  "testEnvironment": "node",
  "testTimeout": 180000,
  "maxWorkers": 1
}
```

### 2. `test/db/harnais.ts`

En-tête de fichier : commentaire en français qui résume le rôle (base jetable, migrations appliquées comme Prisma, retour arrière, `PrismaService` sur la base, jamais d'URL affichée) et renvoie à D448 à D455.

Constantes et signatures exactes (toutes exportées) :

```ts
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PrismaService } from 'src/common/services/prisma.service';

export const RACINE_DEPOT: string;            // path.resolve(__dirname, '..', '..')
export const DOSSIER_MIGRATIONS: string;      // <racine>/prisma/migrations
export const DOSSIER_RETOURS_ARRIERE: string; // <racine>/prisma/retours-arriere
export const DERNIERE_MIGRATION_FORMAT_ACTUEL = '20261022120000_ventes_pharmacie';
export const MOTIF_NOM_BASE_DE_TEST = /^mc_test_[0-9a-f]{12}$/;

export interface BaseDeTest {
  nom: string;     // mc_test_<12 hex>
  url: string;     // jamais affichée ni journalisée
  client: Client;  // connecté à la base jetable
}

export function masquerUrls(texte: string): string;
export function urlServeurDeTest(): URL;
export function urlPourBase(nom: string): string;
export function verifierNomBaseDeTest(nom: string): void;
export async function avecConnexionMaintenance<T>(fn: (client: Client) => Promise<T>): Promise<T>;
export async function creerBaseVide(): Promise<BaseDeTest>;
export async function supprimerBaseDeTest(base: BaseDeTest): Promise<void>;
export function listerMigrations(dossier?: string): string[];
export async function appliquerSql(client: Client, sql: string): Promise<void>;
export async function appliquerMigrations(
  client: Client,
  options?: { dossier?: string; apres?: string; jusqua?: string },
): Promise<string[]>;
export async function appliquerRetourArriere(client: Client, nom: string, dossier?: string): Promise<void>;
export function creerPrismaDeTest(base: BaseDeTest): PrismaService;
export async function fermerPrismaDeTest(prisma: PrismaService): Promise<void>;
```

Comportement exact :

- `masquerUrls(texte)` : `texte.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '<url masquée>')`.
- `urlServeurDeTest()` : `const brute = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;` si vide, `throw new Error('Ni TEST_DATABASE_URL ni DATABASE_URL ne sont définies : le harnais ne sait pas où créer la base de test.')`. Retourne `new URL(brute)`. Si `new URL` lève, relancer `new Error('L\'URL du serveur de test est illisible.')` **sans** la valeur ni l'erreur d'origine (son message contient l'URL).
- `urlPourBase(nom)` : copie de `urlServeurDeTest()` dont seul `pathname` devient `'/' + nom` ; protocole, utilisateur, mot de passe, hôte, port et paramètres (`?schema=public`) inchangés. Retourne `toString()`.
- `verifierNomBaseDeTest(nom)` : si `!MOTIF_NOM_BASE_DE_TEST.test(nom)`, `throw new Error(\`Nom de base de test refusé : ${nom}. Seules les bases mc_test_<12 hexadécimaux> sont créées ou supprimées par le harnais.\`)`.
- `avecConnexionMaintenance(fn)` : `new Client({ connectionString: urlPourBase('postgres') })`, `connect`, `try { return await fn(client); } finally { await client.end(); }`.
- `creerBaseVide()` : `nom = 'mc_test_' + randomBytes(6).toString('hex')` ; `verifierNomBaseDeTest(nom)` ; `CREATE DATABASE "${nom}"` par la connexion de maintenance (le nom est validé par l'expression, c'est la seule interpolation permise) ; puis `new Client({ connectionString: urlPourBase(nom) })` connecté ; retourne `{ nom, url, client }`.
- `supprimerBaseDeTest(base)` : `verifierNomBaseDeTest(base.nom)` d'abord ; `await base.client.end()` dans un `try/catch` qui ignore l'erreur d'un client déjà fermé ; puis `DROP DATABASE IF EXISTS "${base.nom}" WITH (FORCE)` par la connexion de maintenance.
- `listerMigrations(dossier = DOSSIER_MIGRATIONS)` : entrées de `readdirSync(dossier)` qui sont des dossiers **contenant** `migration.sql`, triées par `.sort()` sans comparateur (D448). `migration_lock.toml` et tout fichier sont ignorés.
- `appliquerSql(client, sql)` : `await client.query(sql)` **sans tableau de paramètres** (protocole de requête simple : un texte à plusieurs instructions s'exécute dans une transaction implicite, comme le moteur de Prisma). Aucun découpage du texte, aucun `BEGIN` ajouté.
- `appliquerMigrations(client, { dossier = DOSSIER_MIGRATIONS, apres, jusqua } = {})` : `noms = listerMigrations(dossier)` ; si `apres` est fourni et absent de `noms`, `throw new Error(\`Migration inconnue : ${apres}\`)` ; idem pour `jusqua`. Sélection : les noms strictement après `apres` (s'il est fourni) et jusqu'à `jusqua` inclus (s'il est fourni). Pour chaque nom, dans l'ordre : `appliquerSql(client, readFileSync(<dossier>/<nom>/migration.sql, 'utf8'))` ; en cas d'erreur, `throw new Error(\`La migration ${nom} a échoué : ${masquerUrls(message d'origine)}\`, { cause: erreur })` et arrêt immédiat (les suivantes ne sont pas tentées). Retourne la liste des noms appliqués (vide si rien à appliquer). N'écrit rien dans `_prisma_migrations`.
- `appliquerRetourArriere(client, nom, dossier = DOSSIER_RETOURS_ARRIERE)` : fichier `<dossier>/<nom>.down.sql` ; s'il n'existe pas, `throw new Error(\`Retour arrière introuvable : ${nom}.down.sql\`)` ; sinon `appliquerSql` du contenu ; en cas d'erreur, `throw new Error(\`Le retour arrière ${nom} a échoué : ${masquerUrls(message)}\`, { cause })`. Le harnais ne lance pas `prisma migrate resolve` (il n'utilise pas `_prisma_migrations`).
- `creerPrismaDeTest(base)` : mémorise `process.env.DATABASE_URL`, le remplace par `base.url`, construit `new PrismaService()`, puis **dans un `finally`** remet l'ancienne valeur (ou `delete process.env.DATABASE_URL` si elle était `undefined`). Ne pas appeler `onModuleInit` (il journalise) : le client se connecte à la première requête.
- `fermerPrismaDeTest(prisma)` : `await prisma.onModuleDestroy()`.

Interdits : aucun `console.log`, aucun message d'erreur ni assertion qui contienne `base.url`, `process.env.DATABASE_URL`, `process.env.TEST_DATABASE_URL`, un hôte, un utilisateur ou un mot de passe (D454). Le nom `mc_test_...` peut apparaître.

### 3. `test/db/fixtures/format-actuel.ts` (jeu « format actuel », D449)

En-tête : commentaire qui dit que ce jeu reproduit les données **d'avant la tranche** (schéma de `20261022120000_ventes_pharmacie`), inséré en SQL brut avec colonnes explicites pour rester valable quand le client Prisma et les constantes RBAC évolueront ; **ne jamais** le réécrire avec le client Prisma ni importer `permissions.constants.ts`.

Signatures exportées :

```ts
import { Client } from 'pg';

export interface OptionsFormatActuel { aujourdhui?: Date } // minuit UTC du jour ; défaut : aujourd'hui à minuit UTC
export interface FicheFormatActuel {
  id: string; medicamentId: string; structureId: string;
  quantite: number; prixUnitaire: number | null; disponible: boolean;
  dateExpiration: Date | null; notes: string | null;
}
export interface ResumeFormatActuel {
  aujourdhui: Date;
  pharmacies: string[];          // ['str-pharma-1', 'str-pharma-2', 'str-pharma-3']
  hopital: string;               // 'str-hopital-1'
  fiches: FicheFormatActuel[];   // 40
  ventes: { validees: number; annulees: number; lignes: number }; // 4, 2, 7
}
export const QUANTITES_FORMAT_ACTUEL: readonly number[]; // [0, 1, 9, 10, 11, 240]
export const PRIX_FORMAT_ACTUEL: readonly (number | null)[]; // [1500, null, 2500, 0, 12000]
export function fichesFormatActuel(aujourdhui: Date): FicheFormatActuel[];
export async function chargerFormatActuel(client: Client, options?: OptionsFormatActuel): Promise<ResumeFormatActuel>;
```

`chargerFormatActuel` : tout dans une transaction explicite (`BEGIN` ; insertions par `client.query(texte, valeurs)` **paramétrées** ; `COMMIT` ; sur erreur `ROLLBACK` puis relance). Colonnes `createdAt` et `updatedAt` à `now()` sauf mention contraire. Ordre d'insertion : `Structure` (sans `adminId`), `Permission`, `AppRole`, `RolePermission`, `User`, mise à jour `Structure.adminId`, `Medicament`, `StockMedicament`, `Vente`, `LigneVente`, `CompteurVente`.

Horodatages : les colonnes Prisma `DateTime` sont des `timestamp(3)` sans fuseau lues comme UTC par Prisma. Toute date passée en paramètre (`dateExpiration`, `createdAt` et `annuleeLe` des ventes) est donc envoyée en texte UTC sans fuseau, `date.toISOString().slice(0, 23).replace('T', ' ')`, avec un transtypage explicite `$n::timestamp(3)` dans le SQL ; jamais un objet `Date` brut (sa conversion dépendrait du fuseau de la session).

Dates : `J = aujourdhui` (minuit UTC). `passee = J - 30 jours`, `jour = J`, `future = J + 180 jours`, `nulle = null`. `veille = J - 1 jour`.

**Structures** (`id`, `nom`, `type`, `email`, `telephone`, `adresse`, `ville`, `isActive`, `isConfigured`, `createdAt`, `updatedAt`) :

| id | nom | type | email | telephone | adresse | ville | isActive | isConfigured |
|---|---|---|---|---|---|---|---|---|
| str-pharma-1 | Pharmacie de Kaloum (harnais) | PHARMACIE | pharma1@harnais.test | +224620100001 | Kaloum | Conakry | true | true |
| str-pharma-2 | Pharmacie de Matoto (harnais) | PHARMACIE | pharma2@harnais.test | +224620100002 | Matoto | Conakry | true | true |
| str-pharma-3 | Pharmacie de Ratoma (harnais) | PHARMACIE | pharma3@harnais.test | null | Ratoma | Conakry | true | false |
| str-hopital-1 | Hôpital de Donka (harnais) | HOPITAL | hopital1@harnais.test | +224620100004 | Dixinn | Conakry | true | true |

**Permissions** (`id` = `'perm-' + code`, `code`, `libelle`, `categorie`), `INSERT ... ON CONFLICT ("code") DO NOTHING` (les trois `vente:*` existent déjà par la migration du lot 7). Liste figée (copie littérale du catalogue actuel, 24 codes) :
`carnet:read` « Consulter le carnet de santé complet d’un patient » Carnet de santé ; `consultation:write` « Ajouter / supprimer une consultation » Carnet de santé ; `ordonnance:write` « Prescrire / supprimer une ordonnance » Carnet de santé ; `analyse:write` « Enregistrer / supprimer un résultat d’analyse » Carnet de santé ; `vaccination:write` « Enregistrer / supprimer une vaccination » Carnet de santé ; `rendezvous:write` « Programmer un rendez-vous » Carnet de santé ; `patient:read` « Consulter la fiche d’orientation d’un patient (sans le dossier médical) » Carnet de santé ; `sos:respond` « Voir et traiter les alertes d’urgence (SOS) » Urgences ; `stock:read` « Consulter le stock d’une pharmacie » Pharmacie ; `stock:write` « Gérer le stock (ajouter / ajuster / retirer) » Pharmacie ; `catalogue:write` « Ajouter un médicament au catalogue » Pharmacie ; `catalogue:manage` « Modifier / supprimer un médicament du catalogue » Pharmacie ; `vente:read` « Consulter les ventes de la pharmacie » Pharmacie ; `vente:write` « Enregistrer une vente » Pharmacie ; `vente:annuler` « Annuler une vente du jour » Pharmacie ; `structure:read` « Voir les informations de sa structure » Établissement ; `structure:write` « Modifier les informations de sa structure » Établissement ; `membre:read` « Lister les membres de sa structure » Établissement ; `membre:manage` « Créer / activer / supprimer des membres » Établissement ; `role:manage` « Créer et configurer les rôles de sa structure » Établissement ; `chat:structure` « Voir et répondre aux conversations adressées à la structure » Communication ; `user:admin` « Administrer les utilisateurs (plateforme) » Plateforme ; `platform:structures` « Gérer toutes les structures et invitations » Plateforme ; `platform:admin` « Administration plateforme (super-admins, stats globales) » Plateforme.

**Rôles** (`AppRole` : `id`, `nom`, `description` null, `isSystem` false, `structureId`) et leurs permissions (`RolePermission` par `INSERT ... SELECT $1, p."id" FROM "Permission" p WHERE p."code" = ANY($2::text[]) ON CONFLICT DO NOTHING`) :

| id | structureId | nom | permissions |
|---|---|---|---|
| rol-p1-pharmacien, rol-p2-pharmacien, rol-p3-pharmacien | str-pharma-N | Pharmacien | stock:read, stock:write, catalogue:write, vente:read, vente:write, chat:structure, structure:read, membre:read |
| rol-p1-admin, rol-p2-admin, rol-p3-admin | str-pharma-N | Administrateur de structure | stock:read, stock:write, vente:read, vente:write, vente:annuler, structure:read, structure:write, membre:read, membre:manage, role:manage |
| rol-h1-medecin | str-hopital-1 | Médecin | carnet:read, consultation:write, ordonnance:write, analyse:write, vaccination:write, rendezvous:write, sos:respond, patient:read, structure:read, membre:read |
| rol-h1-admin | str-hopital-1 | Administrateur de structure | structure:read, structure:write, membre:read, membre:manage, role:manage, patient:read |

**Utilisateurs** (`id`, `email` = `<id>@harnais.test`, `password` = `'harnais-aucun-mot-de-passe'` (pas un hachage, aucune connexion possible), `nom`, `prenom`, `telephone` null, `role`, `isActive` true, `specialite`, `structureId`, `appRoleId`) :

| id | prenom nom | role | structureId | appRoleId | specialite |
|---|---|---|---|---|---|
| usr-admin-p1 | Fatoumata Camara | STRUCTURE_ADMIN | str-pharma-1 | rol-p1-admin | null |
| usr-pharm-p1 | Mamadou Diallo | PHARMACIEN | str-pharma-1 | rol-p1-pharmacien | null |
| usr-admin-p2 | Ibrahima Sow | STRUCTURE_ADMIN | str-pharma-2 | rol-p2-admin | null |
| usr-pharm-p2 | Aïssatou Barry | PHARMACIEN | str-pharma-2 | rol-p2-pharmacien | null |
| usr-admin-p3 | Kadiatou Keita | STRUCTURE_ADMIN | str-pharma-3 | rol-p3-admin | null |
| usr-admin-h1 | Oumar Touré | STRUCTURE_ADMIN | str-hopital-1 | rol-h1-admin | null |
| usr-medecin-h1 | Mariama Sylla | MEDECIN | str-hopital-1 | rol-h1-medecin | Médecine générale |

Puis `UPDATE "Structure" SET "adminId" = ...` : str-pharma-1 → usr-admin-p1, str-pharma-2 → usr-admin-p2, str-pharma-3 → usr-admin-p3, str-hopital-1 → usr-admin-h1.

**Médicaments** (`id` `med-01` à `med-20`, `nom`, `nomGenerique` null, `categorie`, `description` null, `ordonnanceRequise`, `formes` text[]) :
med-01 Paracétamol 500 mg, Antalgique, {comprimé} ; med-02 Ibuprofène 400 mg, Anti-inflammatoire, {comprimé} ; med-03 Amoxicilline 500 mg, Antibiotique, **ordonnance**, {gélule} ; med-04 Métronidazole 250 mg, Antibiotique, {comprimé} ; med-05 Artéméther Luméfantrine, Antipaludéen, {comprimé} ; med-06 Oméprazole 20 mg, Antiulcéreux, {gélule} ; med-07 Sel de réhydratation orale, Réhydratation, {sachet} ; med-08 Cotrimoxazole 480 mg, Antibiotique, **ordonnance**, {comprimé} ; med-09 Vitamine C 500 mg, Vitamine, {comprimé} ; med-10 Fer acide folique, Supplément, {comprimé} ; med-11 Albendazole 400 mg, Antiparasitaire, {comprimé} ; med-12 Quinine 300 mg, Antipaludéen, {comprimé} ; med-13 Diclofénac 50 mg, Anti-inflammatoire, {comprimé} ; med-14 Amlodipine 5 mg, Antihypertenseur, **ordonnance**, {comprimé} ; med-15 Metformine 500 mg, Antidiabétique, {comprimé} ; med-16 Salbutamol sirop, Bronchodilatateur, {sirop} ; med-17 Chlorphénamine 4 mg, Antihistaminique, {comprimé} ; med-18 Loratadine 10 mg, Antihistaminique, {comprimé} ; med-19 Paracétamol sirop 120 mg/5 ml, Antalgique, {sirop} ; med-20 Zinc 20 mg, Supplément, {comprimé}. Les autres : `ordonnanceRequise` false.

**Fiches de stock** (`fichesFormatActuel(J)`, 40 fiches, index `i` de 0 à 39, `id` = `'stk-' + String(i + 1).padStart(2, '0')`) :
- structure et médicament : `i` de 0 à 19 → `str-pharma-1`, `med-(i+1)` ; `i` de 20 à 34 → `str-pharma-2`, `med-(i-19)` ; `i` de 35 à 39 → `str-pharma-3`, `med-(i-34)` (numéros sur deux chiffres) ;
- `quantite = QUANTITES_FORMAT_ACTUEL[i % 6]` ;
- `dateExpiration = [passee, jour, future, nulle][i % 4]` ;
- `prixUnitaire = PRIX_FORMAT_ACTUEL[i % 5]` ;
- `disponible = quantite > 0` ;
- `notes = i % 7 === 0 ? 'Note du harnais' : null` ;
- colonnes insérées : `id`, `medicamentId`, `structureId`, `quantite`, `prixUnitaire`, `disponible`, `dateExpiration`, `notes`, `updatedAt` (`now()`).

Comptes qui en découlent (assertions des tests) : 20, 15 et 5 fiches par pharmacie, aucune pour l'hôpital ; quantités 0, 1, 9 et 10 : 7 fiches chacune, 11 et 240 : 6 chacune ; 33 fiches à quantité positive ; chaque catégorie de date (passée, du jour, future, nulle) : 10 fiches ; prix null : 8, prix 0 : 8.

**Ventes** (`id`, `structureId`, `numero`, `vendeurId`, `vendeurNom`, `clientNom`, `clientTelephone`, `ordonnanceVerifiee`, `total`, `statut`, `annuleeLe`, `annuleeParId`, `motifAnnulation`, `cleIdempotence`, `createdAt`). `numero` = `'V-' + année UTC de createdAt + '-' + n sur 6 chiffres`. `vendeurNom` = « Prénom Nom » du vendeur. Valeurs absentes = null.

| id | structure | n | vendeur | createdAt | statut | lignes (fiche x quantité, prix copié) | total | autres champs |
|---|---|---|---|---|---|---|---|---|
| vte-p1-1 | str-pharma-1 | 1 | usr-pharm-p1 | J + 8 h | VALIDEE | stk-11 x 2 à 1500 ; stk-15 x 1 à 12000 | 15000 | ordonnanceVerifiee false |
| vte-p1-2 | str-pharma-1 | 2 | usr-admin-p1 | J + 9 h | VALIDEE | stk-03 x 3 à 2500 | 7500 | ordonnanceVerifiee true, clientNom « Mariama Bah », clientTelephone « +224620000001 » |
| vte-p1-3 | str-pharma-1 | 3 | usr-pharm-p1 | J + 10 h | ANNULEE | stk-16 x 1 à 1500 | 1500 | annuleeLe J + 10 h 15, annuleeParId usr-admin-p1, motifAnnulation « Erreur de saisie » |
| vte-p1-4 | str-pharma-1 | 4 | usr-pharm-p1 | J + 11 h | VALIDEE | stk-11 x 1 à 1500 | 1500 | cleIdempotence « harnais-cle-0001 » |
| vte-p2-1 | str-pharma-2 | 1 | usr-pharm-p2 | veille + 15 h | VALIDEE | stk-26 x 4 à 1500 | 6000 | |
| vte-p2-2 | str-pharma-2 | 2 | usr-pharm-p2 | veille + 16 h | ANNULEE | stk-35 x 2 à 12000 | 24000 | annuleeLe veille + 16 h 05, annuleeParId usr-admin-p2, motifAnnulation « Client parti sans payer » |

**Lignes de vente** (`id` `lv-01` à `lv-07` dans l'ordre du tableau, `venteId`, `medicamentId` et `nomMedicament` de la fiche, `stockMedicamentId`, `prixUnitaire`, `quantite`, `sousTotal = prixUnitaire x quantite`). Les prix copiés sont ceux des fiches (stk-03 2500, stk-11 1500, stk-15 12000, stk-16 1500, stk-26 1500, stk-35 12000) : ne pas les recalculer autrement.

**Compteurs** (`CompteurVente`) : (`str-pharma-1`, année UTC de J, 4) ; (`str-pharma-2`, année UTC de la veille, 2).

`chargerFormatActuel` retourne le `ResumeFormatActuel` (fiches = `fichesFormatActuel(J)`).

### 4. Migrations témoins

`test/db/fixtures/fautive/migrations/migration_lock.toml` :
```toml
# Migrations volontairement fautives du harnais (PB01), jamais appliquées hors base de test.
provider = "postgresql"
```

`test/db/fixtures/fautive/migrations/20990101000000_harnais_fautive/migration.sql` :
```sql
-- Migration volontairement fautive (harnais PB01) : la seconde insertion viole la clé primaire.
-- Appliquée en une seule requête, elle ne doit rien laisser (D432, D448).
CREATE TABLE "HarnaisTemoinFautif" ("id" INTEGER PRIMARY KEY);
INSERT INTO "HarnaisTemoinFautif" ("id") VALUES (1);
INSERT INTO "HarnaisTemoinFautif" ("id") VALUES (1);
```

`test/db/fixtures/temoin/migrations/20990101000001_harnais_temoin/migration.sql` :
```sql
-- Migration témoin du harnais (PB01) : table liée aux fiches de stock, remplie depuis la base chargée.
CREATE TABLE "HarnaisTemoin" (
  "stockMedicamentId" TEXT PRIMARY KEY REFERENCES "StockMedicament"("id")
);
INSERT INTO "HarnaisTemoin" ("stockMedicamentId")
SELECT "id" FROM "StockMedicament" WHERE "quantite" > 0;
```

`test/db/fixtures/temoin/retours-arriere/20990101000001_harnais_temoin.down.sql` :
```sql
-- Retour arrière de la migration témoin du harnais (PB01).
DROP TABLE "HarnaisTemoin";
```

### 5. `test/db/fixtures/fautive/prisma.config.ts` (D451)

```ts
// Configuration Prisma réservée au harnais (PB01) : applique la migration fautive
// sur une base jetable pour vérifier que Prisma exécute un fichier dans une transaction.
// Ne lit que HARNAIS_DATABASE_URL et refuse toute base hors mc_test_.
import path from 'node:path';
import { defineConfig } from 'prisma/config';

const url = process.env['HARNAIS_DATABASE_URL'] ?? '';
if (!/\/mc_test_[0-9a-f]{12}(\?|$)/.test(url)) {
  throw new Error('Configuration réservée au harnais de test : base mc_test_ attendue.');
}

const racine = process.cwd();

export default defineConfig({
  schema: path.join(racine, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(racine, 'test', 'db', 'fixtures', 'fautive', 'migrations'),
  },
  datasource: { url },
});
```

### 6. `prisma/retours-arriere/README.md` (D453)

Court texte en français, sans tiret cadratin ni demi-cadratin : un fichier `<nom de la migration>.down.sql` par migration de la tranche pharmacie ; procédure : appliquer le fichier (`npx prisma db execute --file prisma/retours-arriere/<nom>.down.sql`), puis `npx prisma migrate resolve --rolled-back <nom>`, puis redéployer la version de code précédente ; chaque fichier est testé par le harnais (`npm run test:db`) en haut, bas, haut sur une base chargée ; renvoi à `docs/plans/runs/2026-10-25-pharmacie-t1/PLAN.md` section 2. Ne pas écrire `--url` ni aucune URL dans ce fichier.

### 7. Tests : `test/db/harnais.db-spec.ts`

Organisation : un `describe('Harnais de base de test (PB01)')`. Une base principale `base` créée dans `beforeAll` : `creerBaseVide()`, `appliquerMigrations(base.client, { jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL })` (résultat gardé dans `appliqueesAvant`), `chargerFormatActuel(base.client)` (résultat `resume`), `appliquerMigrations(base.client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL })` (résultat `appliqueesApres`), `prisma = creerPrismaDeTest(base)`. `afterAll` : `fermerPrismaDeTest(prisma)` puis `supprimerBaseDeTest(base)`, chacun protégé (si `prisma` ou `base` est indéfini parce que `beforeAll` a échoué, ne rien faire) ; la suppression a lieu même si la fermeture de Prisma échoue (`try/finally`). Les tests s'exécutent dans l'ordre écrit ci-dessous. Fonction utilitaire locale `tableExiste(client, nom)` : `SELECT to_regclass($1) IS NOT NULL AS existe` avec `'public."' + nom + '"'`.

Règle d'assertion (D454) : ne jamais faire `expect(<partie d'URL>).toBe(...)` ; comparer en booléen (`expect(a === b).toBe(true)`).

Tests (noms exacts et assertions) :

1. `dérive l'URL de la base de test en ne changeant que son nom` : `source = urlServeurDeTest()`, `derivee = new URL(urlPourBase('mc_test_0123456789ab'))` ; `expect(derivee.pathname).toBe('/mc_test_0123456789ab')` ; `expect(derivee.protocol === source.protocol && derivee.username === source.username && derivee.password === source.password && derivee.host === source.host && derivee.search === source.search).toBe(true)`.
2. `refuse un nom de base hors du préfixe mc_test_` : `expect(() => verifierNomBaseDeTest('medconnecte')).toThrow('Nom de base de test refusé')` ; idem pour `'mc_test_XYZ'` et `'mc_test_0123456789ab; DROP'` ; `expect(() => verifierNomBaseDeTest('mc_test_0123456789ab')).not.toThrow()` ; `expect(MOTIF_NOM_BASE_DE_TEST.test(base.nom)).toBe(true)`.
3. `masque toute URL dans un texte` : `masquerUrls('échec sur postgresql://u:p@h:5432/b?schema=public fin')` vaut `'échec sur <url masquée> fin'`.
4. `applique toutes les migrations existantes dans l'ordre de Prisma` : `expect([...appliqueesAvant, ...appliqueesApres]).toEqual(listerMigrations())` ; `expect(listerMigrations()[0]).toBe('20260425202451_init')` ; `expect(listerMigrations()).toContain(DERNIERE_MIGRATION_FORMAT_ACTUEL)` ; `expect(listerMigrations().length).toBeGreaterThanOrEqual(14)` ; `expect(listerMigrations()).toEqual([...listerMigrations()].sort())` ; tables `Vente`, `LigneVente`, `CompteurVente`, `StockMedicament` existent (`tableExiste`).
5. `charge le jeu au format actuel et le relit par PrismaService` (lecture **uniquement** par `prisma`) :
   - `prisma.structure.count({ where: { type: 'PHARMACIE' } })` = 3 ; `{ type: 'HOPITAL' }` = 1 ;
   - `prisma.stockMedicament.count()` = 40 ; par structure (`where: { structureId }`) : 20, 15, 5, 0 pour `str-pharma-1`, `str-pharma-2`, `str-pharma-3`, `str-hopital-1` ;
   - quantités distinctes (`findMany({ select: { quantite: true }, distinct: ['quantite'] })`) triées = `[0, 1, 9, 10, 11, 240]` ; `count({ where: { quantite: { gt: 0 } } })` = 33 ;
   - `count({ where: { dateExpiration: null } })` = 10 ; `{ dateExpiration: { lt: resume.aujourdhui } }` = 10 ; `{ dateExpiration: resume.aujourdhui }` = 10 ; `{ dateExpiration: { gt: resume.aujourdhui } }` = 10 ;
   - `count({ where: { prixUnitaire: null } })` = 8 ; `{ prixUnitaire: 0 }` = 8 ;
   - chaque fiche lue (`findMany` trié par `id`) égale `resume.fiches` sur `id`, `structureId`, `medicamentId`, `quantite`, `prixUnitaire`, `disponible`, `notes` et `dateExpiration?.getTime()` ;
   - `prisma.vente.count({ where: { statut: 'VALIDEE' } })` = 4 ; `{ statut: 'ANNULEE' }` = 2 ; `prisma.ligneVente.count()` = 7 ;
   - pour chaque vente (`findMany({ include: { lignes: true } })`) : somme des `sousTotal` = `total`, et chaque ligne a `sousTotal === prixUnitaire * quantite` ;
   - `vte-p1-3` : `annuleeParId` = `usr-admin-p1`, `motifAnnulation` = `Erreur de saisie`, `annuleeLe` non nul ; `vte-p1-1` : `annuleeLe` null ;
   - `prisma.compteurVente.findUnique({ where: { structureId_annee: { structureId: 'str-pharma-1', annee: resume.aujourdhui.getUTCFullYear() } } })` a `dernierNumero` = 4 ;
   - rôle `Administrateur de structure` de `str-pharma-1` porte `vente:annuler` ; rôle `Pharmacien` de `str-pharma-1` ne la porte pas (lecture `prisma.appRole.findFirst({ where: { structureId, nom }, include: { permissions: { include: { permission: true } } } })`) ;
   - `prisma.structure.findUnique({ where: { id: 'str-pharma-1' } })` a `adminId` = `usr-admin-p1`.
6. `une migration fautive appliquée par le harnais ne laisse rien` : `await expect(appliquerMigrations(base.client, { dossier: <racine>/test/db/fixtures/fautive/migrations })).rejects.toThrow('La migration 20990101000000_harnais_fautive a échoué')` ; `tableExiste(base.client, 'HarnaisTemoinFautif')` faux ; `SELECT count(*)::int AS n FROM "StockMedicament"` = 40 (la base chargée est intacte et la connexion reste utilisable).
7. `prisma migrate deploy applique un fichier de migration dans une transaction (D432)` : base dédiée `vide = await creerBaseVide()`, dans un `try/finally` qui appelle `supprimerBaseDeTest(vide)`. Lancer :
   ```ts
   const resultat = spawnSync(
     process.execPath,
     [path.join(RACINE_DEPOT, 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate', 'deploy', '--config', 'test/db/fixtures/fautive/prisma.config.ts'],
     { cwd: RACINE_DEPOT, env: { ...process.env, HARNAIS_DATABASE_URL: vide.url }, encoding: 'utf8', timeout: 150000 },
   );
   ```
   Assertions : `expect(resultat.status).not.toBe(0)` (message d'échec : `masquerUrls(resultat.stdout + resultat.stderr)` tronqué à 2 000 caractères, jamais la sortie brute) ; `tableExiste(vide.client, '_prisma_migrations')` vrai (Prisma a bien atteint cette base) ; `tableExiste(vide.client, 'HarnaisTemoinFautif')` **faux**. Si ce dernier point échoue (table restante), **ne pas modifier l'assertion ni la migration fautive** : rendre un bloc BLOCKED qui le dit (D451, les migrations de la tranche porteraient alors `BEGIN`/`COMMIT`).
8. `retour arrière : haut, bas, haut sur la base chargée` : `dossierTemoin = <racine>/test/db/fixtures/temoin` ; `appliquerMigrations(base.client, { dossier: dossierTemoin + '/migrations' })` renvoie `['20990101000001_harnais_temoin']` ; `HarnaisTemoin` existe et compte 33 lignes ; `appliquerRetourArriere(base.client, '20990101000001_harnais_temoin', dossierTemoin + '/retours-arriere')` ; `HarnaisTemoin` n'existe plus ; nouvelle application : existe et compte 33 lignes ; enfin retour arrière à nouveau (laisser la base propre).
9. `refuse un retour arrière introuvable` : `await expect(appliquerRetourArriere(base.client, '20990101000099_inexistante')).rejects.toThrow('Retour arrière introuvable : 20990101000099_inexistante.down.sql')`.
10. `refuse une migration inconnue en borne` : `await expect(appliquerMigrations(base.client, { jusqua: 'inexistante' })).rejects.toThrow('Migration inconnue : inexistante')` ; `appliquerMigrations(base.client, { apres: listerMigrations().at(-1) })` résout `[]`.
11. `supprime la base jetable et n'en laisse aucune trace` : `jetable = await creerBaseVide()` ; `nom = jetable.nom` ; `supprimerBaseDeTest(jetable)` ; `avecConnexionMaintenance(c => c.query('SELECT 1 FROM pg_database WHERE datname = $1', [nom]))` a `rowCount` 0.

Cas limites couverts par le code (pas de test supplémentaire exigé) : `TEST_DATABASE_URL` définie prime sur `DATABASE_URL` ; client déjà fermé à la suppression ; `beforeAll` en échec qui ne doit pas empêcher `afterAll` de supprimer une base déjà créée (affecter `base` dès le retour de `creerBaseVide()`, avant les migrations).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Propres à la tâche :
- Aucun fichier sous `src/`, `prisma/schema.prisma`, `prisma/migrations/`, `jest.config.js`, `.githooks/`, `compose*.yml`, `.env*` ne change. Pas de nouvelle dépendance ni de modification de `package-lock.json`.
- Jamais afficher, journaliser ni écrire une URL de base, un mot de passe ou une valeur de `.env` (y compris dans le rapport de retour et dans les messages d'erreur) ; ne pas lancer `env`, `printenv` ni `echo $DATABASE_URL`.
- Français partout (commentaires, messages d'erreur, noms de tests) ; aucun tiret cadratin ni demi-cadratin ; identifiants de code nouveaux en français comme ci-dessus.
- ESLint propre sur chaque fichier `.ts` touché (sans `eslint-disable`) ; `prettier` du projet respecté.

## Done when

Toutes les commandes sont lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte`, conteneur `backend` démarré :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint test/db/harnais.ts test/db/harnais.db-spec.ts test/db/fixtures/format-actuel.ts test/db/fixtures/fautive/prisma.config.ts` : aucune erreur ni avertissement.
3. `docker compose exec -T backend npm test` : vert, même nombre de suites et de tests qu'avant la tâche (aucun fichier de `test/db` exécuté).
4. `docker compose exec -T backend npm run test:db` : 1 suite, 11 tests, tous verts.
5. Aucune base jetable restante après le point 4 : `docker compose exec -T backend node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query(\"SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'mc_test_%'\")).then(r=>{console.log(r.rows[0].n);return c.end();})"` affiche `0`.
6. `git -C back_medconnect status --short` ne montre que les 11 fichiers de la liste fermée (plus `docs/plans/` déjà modifié par l'orchestrateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
