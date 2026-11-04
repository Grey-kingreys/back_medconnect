# PB02 - Non-régression des alertes et des lectures, instantanés avant recâblage

Tier: spécifié (agent implementeur-specifie : codeur Sonnet selon l'arbitrage A2 ; fiche détaillée, aucune décision laissée ouverte)
Audience: dev
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Figer en instantanés JSON, sur la base de test chargée au format actuel (harnais de PB01), les sorties de cinq lectures du module pharmacie : `PharmacieService.getStockPharmacie` (objet `alertes` et champs de `stocks`), `PharmacieService.rechercherDisponibilite`, `PharmacieService.getMedicament`, `VenteService.listerVentes` et `VenteService.detailVente`. Le même test sera rejoué tel quel par toutes les tâches suivantes (il fait partie de `npm run test:db`), en particulier après les migrations et recâblages de PB07, PB08, PB09, PB11 et PB12 : les instantanés devront rester identiques sur les clés qu'ils contiennent. C'est aussi le « test de non-régression sur les alertes de stock existantes » exigé par la demande.

Aucun changement de comportement : aucun fichier sous `src/`, `prisma/` ni `test/db/harnais.ts`, `test/db/fixtures/` ne change. Aucune migration.

Décisions qui encadrent cette tâche (à lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D444, D449, D454, D455, D458 à D463.

### Contexte vérifié (ne pas re-découvrir)

- Harnais de PB01 (commit `250443b`) : `test/db/harnais.ts` exporte `creerBaseVide`, `appliquerMigrations`, `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `creerPrismaDeTest`, `fermerPrismaDeTest`, `supprimerBaseDeTest`, `RACINE_DEPOT`, `BaseDeTest`. `test/db/fixtures/format-actuel.ts` exporte `chargerFormatActuel(client, options?)` qui retourne `ResumeFormatActuel` (`aujourdhui` = minuit UTC du jour réel par défaut, `fiches` = les 40 fiches avec `id`, `medicamentId`, `structureId`, `quantite`, `prixUnitaire`, `disponible`, `dateExpiration`, `notes`). Copier le `beforeAll`/`afterAll` de `test/db/harnais.db-spec.ts` (création, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, chargement, migrations restantes, Prisma ; fermeture protégée puis suppression en `try/finally`).
- `test/db/jest-db.json` prend tout `test/db/**/*.db-spec.ts` (`roots` = `test/db`), un seul processus, 180 s par test. Rien à changer dans cette configuration ni dans `package.json`.
- Jeu au format actuel, ce qui en découle pour les assertions : pharmacies `str-pharma-1` (20 fiches, `stk-01` à `stk-20`, médicaments `med-01` à `med-20`), `str-pharma-2` (15 fiches, `stk-21` à `stk-35`, `med-01` à `med-15`), `str-pharma-3` (5 fiches, `stk-36` à `stk-40`, `med-01` à `med-05`, `isConfigured` faux), hôpital `str-hopital-1` (aucune fiche). Quantités `[0, 1, 9, 10, 11, 240][i % 6]` ; 33 fiches à quantité positive (16 pour `str-pharma-1`, 13 pour `str-pharma-2`, 4 pour `str-pharma-3`) ; quantités 1 et 9 : 7 fiches chacune (donc 14 en stock bas sur les trois pharmacies), quantité 0 : 7 fiches (rupture). Utilisateurs : `usr-admin-p1`, `usr-pharm-p1` (str-pharma-1), `usr-admin-p2`, `usr-pharm-p2` (str-pharma-2), `usr-admin-p3` (str-pharma-3). Ventes : `vte-p1-1` à `vte-p1-4` le jour J (8 h, 9 h, 10 h, 11 h ; `vte-p1-3` annulée ; total validé 24 000), `vte-p2-1` et `vte-p2-2` la veille (15 h, 16 h ; `vte-p2-2` annulée ; total validé 6 000). Aucune structure n'a de coordonnées ni de logo.
- `PharmacieService` : constructeur `(prisma: PrismaService, notificationsService: NotificationsService)`. `getStockPharmacie(structureId, userId)` (accès par `checkPharmacieAccess` : rôle d'enum `STRUCTURE_ADMIN` ou `PHARMACIEN` et `user.structureId === structureId`) ; trie par `medicament.nom` ; `alertes.stockBas` = `0 < quantite < 10`, `alertes.rupture` = `quantite === 0`. `rechercherDisponibilite(search?, ville?, lat?, lng?, pharmacieId?)` : fiches `disponible` et `quantite > 0` des pharmacies actives et configurées, tri par `structure.nom` seulement (l'ordre à l'intérieur d'une pharmacie n'est pas garanti), puis par distance si `lat` et `lng`. `getMedicament(medicamentId)` : médicament et ses fiches `disponible` à `quantite > 0`, sans tri ; `NotFoundException('Médicament non trouvé')` sinon.
- `VenteService` : constructeur `(prisma: PrismaService, notificationsService: NotificationsService, storage: StorageService)`. `StorageService` lit des variables R2 dans son constructeur : ne pas l'instancier, passer un objet factice (voir plus bas), utilisé seulement si la structure a un logo (jamais dans ce jeu). `listerVentes(structureId, userId, { date?, page? })` filtre sur `createdAt` dans le jour UTC donné, 50 par page, tri `createdAt` décroissant, `BadRequestException` code `VALIDATION` si la date est invalide. `detailVente(structureId, venteId, userId)` : `NotFoundException('Cette vente est introuvable.')` si la vente n'est pas de cette structure.
- `NotificationsService` : constructeur `(prisma)`, aucun effet à la construction ; les lectures ne l'appellent pas.
- `tsconfig.json` n'a pas de `include` : les nouveaux `.ts` de `test/db/` sont typés par `tsc --noEmit` et vus par ESLint (`recommendedTypeChecked`, `require-await`, règles `no-unsafe-*`). Les retours de `rechercherDisponibilite` sont faiblement typés (`any` en interne) : typer par des interfaces locales et `as unknown as`, jamais d'`eslint-disable`.

### Fichiers à créer (liste fermée)

| Fichier | Action |
|---|---|
| `test/db/outils-instantanes.ts` | créer |
| `test/db/non-regression-lectures.db-spec.ts` | créer |
| `test/db/instantanes/get-stock-pharmacie.json` | généré par le test (voir « Génération ») |
| `test/db/instantanes/rechercher-disponibilite.json` | généré par le test |
| `test/db/instantanes/get-medicament.json` | généré par le test |
| `test/db/instantanes/lister-ventes.json` | généré par le test |
| `test/db/instantanes/detail-vente.json` | généré par le test |

Les cinq fichiers JSON sont la seule exception à la règle « écrire avec Write et Edit » : ils sont écrits par le test lui-même dans le conteneur (mode `MAJ_INSTANTANES=1`), jamais à la main, jamais retouchés, jamais reformatés (ni prettier ni éditeur).

### 1. `test/db/outils-instantanes.ts`

En-tête : commentaire en français : outils des instantanés de non-régression (PB02) ; normalisation des champs volatils, comparaison par projection sur les clés de l'instantané, écriture seulement avec `MAJ_INSTANTANES=1` ; renvoi à D458 à D461.

Signatures exactes (toutes exportées) :

```ts
import { HttpException } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RACINE_DEPOT } from './harnais';

export const DOSSIER_INSTANTANES: string; // path.join(RACINE_DEPOT, 'test', 'db', 'instantanes')
export const VOLATIL = '<volatil>';

export interface OptionsNormalisation {
  aujourdhui: Date;                    // J du jeu (resume.aujourdhui)
  clesVolatiles: readonly string[];    // clés remplacées par VOLATIL où qu'elles soient
}

export function libelleRelatif(date: Date, aujourdhui: Date): string;
export function jourRelatif(jour: string, aujourdhui: Date): string;
export function normaliser(valeur: unknown, options: OptionsNormalisation): unknown;
export function ecartsInstantane(attendu: unknown, recu: unknown, chemin?: string): string[];
export function verifierInstantane(nom: string, valeurNormalisee: unknown): void;
export function trierDansGroupes<T extends { id: string }>(liste: readonly T[], cleGroupe: (element: T) => string): T[];
export async function capturerErreur(promesse: Promise<unknown>): Promise<{ statut: number; reponse: unknown }>;
```

Comportement exact :

- `libelleRelatif(date, aujourdhui)` : `delta = date.getTime() - aujourdhui.getTime()` ; `jours = Math.floor(delta / 86_400_000)` ; `reste = delta - jours * 86_400_000` ; `heure = new Date(reste).toISOString().slice(11, 23)` ; retourne `` `J${jours >= 0 ? '+' : ''}${jours}j ${heure}` ``. Exemples : J + 8 h donne `J+0j 08:00:00.000` ; J - 30 jours donne `J-30j 00:00:00.000` ; veille + 16 h donne `J-1j 16:00:00.000`.
- `jourRelatif(jour, aujourdhui)` (`jour` au format `AAAA-MM-JJ`) : `jours = Math.round((Date.parse(jour + 'T00:00:00.000Z') - aujourdhui.getTime()) / 86_400_000)` ; retourne `` `J${jours >= 0 ? '+' : ''}${jours}` `` (`J+0`, `J-1`).
- `normaliser(valeur, options)`, récursif, dans cet ordre :
  1. `valeur instanceof Date` : `libelleRelatif(valeur, options.aujourdhui)`.
  2. chaîne qui correspond à `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/` : `libelleRelatif(new Date(valeur), options.aujourdhui)`.
  3. autre chaîne : `valeur.replace(/V-\d{4}-/g, 'V-AAAA-')` puis `.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (j) => jourRelatif(j, options.aujourdhui))`.
  4. nombre non entier (`typeof valeur === 'number' && !Number.isInteger(valeur)`) : `Math.round(valeur * 1e6) / 1e6`.
  5. tableau : `valeur.map((e) => normaliser(e, options))` (ordre conservé).
  6. objet non nul : nouvel objet dont les clés sont **triées** par `Object.keys(valeur).sort()` ; une clé de valeur `undefined` est omise ; une clé présente dans `options.clesVolatiles` reçoit `VOLATIL` (quelle que soit sa valeur, `null` compris) ; sinon la valeur normalisée.
  7. tout le reste (entier, booléen, `null`) inchangé.
- `ecartsInstantane(attendu, recu, chemin = '$')` (projection, D458) :
  - `attendu` tableau : si `recu` n'est pas un tableau, `[\`${chemin} : tableau attendu, reçu ${typeDe(recu)}\`]` ; si les longueurs diffèrent, `[\`${chemin} : ${attendu.length} éléments attendus, ${recu.length} reçus\`]` (sans descendre) ; sinon concaténation des écarts de chaque indice avec le chemin `${chemin}[${i}]`.
  - `attendu` objet non nul : si `recu` n'est pas un objet non nul hors tableau, `[\`${chemin} : objet attendu, reçu ${typeDe(recu)}\`]` ; sinon, pour chaque clé de `attendu` dans l'ordre de `Object.keys` : clé absente de `recu` (`!Object.prototype.hasOwnProperty.call(recu, cle)`) donne `\`${chemin}.${cle} : clé absente\`` ; sinon récursion avec `${chemin}.${cle}`. **Les clés de `recu` absentes de `attendu` sont ignorées** (champs ajoutés par les tâches suivantes).
  - sinon : si `!Object.is(attendu, recu)`, `[\`${chemin} : attendu ${JSON.stringify(attendu)}, reçu ${JSON.stringify(recu)}\`]`, sinon `[]`.
  - `typeDe` (fonction locale non exportée) : `'null'` pour `null`, `'tableau'` pour un tableau, sinon `typeof`.
- `verifierInstantane(nom, valeurNormalisee)` : `fichier = path.join(DOSSIER_INSTANTANES, nom + '.json')`.
  - si `process.env.MAJ_INSTANTANES === '1'` : `mkdirSync(DOSSIER_INSTANTANES, { recursive: true })` puis `writeFileSync(fichier, JSON.stringify(valeurNormalisee, null, 2) + '\n', 'utf8')` et retour.
  - sinon, si `!existsSync(fichier)` : `throw new Error(\`Instantané absent : test/db/instantanes/${nom}.json. Il se génère une seule fois (PB02) avec MAJ_INSTANTANES=1 ; ensuite il ne se régénère jamais sans décision du chef.\`)`.
  - sinon : `attendu = JSON.parse(readFileSync(fichier, 'utf8')) as unknown` ; `ecarts = ecartsInstantane(attendu, JSON.parse(JSON.stringify(valeurNormalisee)) as unknown)` ; si non vide, `throw new Error(\`Instantané ${nom} différent (${ecarts.length} écart(s)) :\n${ecarts.slice(0, 20).join('\n')}\`)`.
- `trierDansGroupes(liste, cleGroupe)` : parcourt `liste` dans l'ordre et forme des groupes d'éléments **consécutifs** de même `cleGroupe` ; trie chaque groupe par `id` (`a.id < b.id ? -1 : a.id > b.id ? 1 : 0`) ; concatène les groupes dans leur ordre d'apparition. Ne modifie pas `liste`. Un groupe qui réapparaît plus loin reste séparé (un changement d'ordre du service est ainsi visible dans l'instantané).
- `capturerErreur(promesse)` : `try { await promesse; } catch (erreur) { if (erreur instanceof HttpException) return { statut: erreur.getStatus(), reponse: erreur.getResponse() }; throw erreur; }` puis, après le `try`, `throw new Error('Une erreur HTTP était attendue, la lecture a réussi.')`.

Interdits : aucun `console.log` ; aucune URL, aucun mot de passe, aucune valeur de `.env` dans un message (D454).

### 2. `test/db/non-regression-lectures.db-spec.ts`

En-tête : commentaire en français : non-régression des lectures pharmacie (PB02) ; rejoué après chaque migration de la tranche ; les instantanés ne se régénèrent jamais sans décision consignée du chef (D458) ; les tâches qui changent les constructeurs des services ne modifient que le bloc « construction des services » (D462).

Imports : `NotificationsService` de `src/notifications/notifications.service`, `PharmacieService` de `src/pharmacie/pharmacie.service`, `VenteService` de `src/pharmacie/vente.service`, `import type { StorageService } from 'src/storage/storage.service'`, `PrismaService`, les fonctions du harnais, `chargerFormatActuel` et `ResumeFormatActuel`, les outils ci-dessus.

Constantes locales :

```ts
const VOLATILES_FICHES = ['createdAt', 'updatedAt'] as const; // fiches et médicaments : horodatés par now() au chargement
const VOLATILES_VENTES = ['updatedAt'] as const;              // createdAt des ventes est fixé par le jeu (J + 8 h...)
const COORDONNEES: ReadonlyArray<[string, number, number]> = [
  ['str-pharma-1', 9.5092, -13.7122],
  ['str-pharma-2', 9.5716, -13.6476],
];
const ACCES_STOCK: ReadonlyArray<[string, string]> = [
  ['str-pharma-1', 'usr-admin-p1'],
  ['str-pharma-2', 'usr-pharm-p2'],
  ['str-pharma-3', 'usr-admin-p3'],
];
```

Organisation : un `describe('Non-régression des lectures pharmacie (PB02)')`. Variables `base`, `prisma`, `resume`, `pharmacie: PharmacieService`, `ventes: VenteService`, `J: Date`, `jourJ: string` (`J.toISOString().slice(0, 10)`), `veille: string` (`new Date(J.getTime() - 86_400_000).toISOString().slice(0, 10)`).

`beforeAll` : identique à `harnais.db-spec.ts` (affecter `base` dès le retour de `creerBaseVide()`), puis :
1. coordonnées pour la branche « distance » : pour chaque entrée de `COORDONNEES`, `base.client.query('UPDATE "Structure" SET "latitude" = $2, "longitude" = $3 WHERE "id" = $1', [id, lat, lng])` (D463) ;
2. bloc commenté `// Construction des services (seul bloc modifiable par les tâches suivantes, D462)` :
   ```ts
   const notifications = new NotificationsService(prisma);
   const stockageFactice = { getPublicUrl: (cle: string) => `logo-harnais/${cle}` } as unknown as StorageService;
   pharmacie = new PharmacieService(prisma, notifications);
   ventes = new VenteService(prisma, notifications, stockageFactice);
   ```
3. `J = resume.aujourdhui`.

`afterAll` : identique à `harnais.db-spec.ts`.

Fonction locale `options(cles: readonly string[]): OptionsNormalisation` qui retourne `{ aujourdhui: J, clesVolatiles: cles }`.

Tests (noms exacts, dans cet ordre) :

1. `normalise les dates relativement au jour du jeu` (sans base) : avec `j0 = new Date(Date.UTC(2026, 0, 15))`,
   `normaliser({ a: new Date(Date.UTC(2026, 0, 15, 8)), b: '2025-12-16T00:00:00.000Z', c: 'V-2026-000001', d: '2 vente(s) le 2026-01-14.', e: 1.23456789, f: null, g: undefined, updatedAt: new Date() }, { aujourdhui: j0, clesVolatiles: ['updatedAt'] })`
   `toEqual({ a: 'J+0j 08:00:00.000', b: 'J-30j 00:00:00.000', c: 'V-AAAA-000001', d: '2 vente(s) le J-1.', e: 1.234568, f: null, updatedAt: VOLATIL })` ; ses clés valent `['a', 'b', 'c', 'd', 'e', 'f', 'updatedAt']` dans cet ordre ; `libelleRelatif(new Date(Date.UTC(2026, 0, 14, 16)), j0)` vaut `'J-1j 16:00:00.000'` ; `jourRelatif('2026-01-15', j0)` vaut `'J+0'`.
2. `compare un instantané par projection sur ses clés` (sans base) :
   - `ecartsInstantane({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2], x: true }, d: 5 })` vaut `[]` ;
   - `ecartsInstantane({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } })` vaut `['$.b.c[1] : attendu 2, reçu 3']` ;
   - `ecartsInstantane({ a: 1 }, {})` vaut `['$.a : clé absente']` ;
   - `ecartsInstantane({ l: [1, 2] }, { l: [1] })` vaut `['$.l : 2 éléments attendus, 1 reçus']` ;
   - `ecartsInstantane({ o: {} }, { o: null })` vaut `['$.o : objet attendu, reçu null']` ;
   - `ecartsInstantane({ n: null }, { n: 0 })` vaut `['$.n : attendu null, reçu 0']`.
3. `trie seulement à l'intérieur des groupes consécutifs` (sans base) : `trierDansGroupes([{ id: 'b', g: '1' }, { id: 'a', g: '1' }, { id: 'd', g: '2' }, { id: 'c', g: '2' }, { id: 'e', g: '1' }], (e) => e.g).map((e) => e.id)` vaut `['a', 'b', 'c', 'd', 'e']`.
4. `alertes de stock : stock bas et rupture par pharmacie (exigence de la demande)` : pour chaque `[structureId, userId]` de `ACCES_STOCK`, `r = await pharmacie.getStockPharmacie(structureId, userId)` ; `fiches = resume.fiches.filter((f) => f.structureId === structureId)` ;
   - `r.data.stocks.length` = `fiches.length` ;
   - ids de `r.data.alertes.stockBas` triés = ids des fiches à `0 < quantite < 10` triés ;
   - ids de `r.data.alertes.rupture` triés = ids des fiches à `quantite === 0` triés ;
   - chaque entrée de `stockBas` a `quantite` égale à celle de sa fiche dans `resume.fiches` et un `nom` non vide ;
   - aucune entrée de `stockBas` n'a `quantite` 10 ni 11 (borne du seuil).
   Après la boucle : somme des longueurs de `stockBas` sur les trois pharmacies = 14 ; somme des longueurs de `rupture` = 7.
5. `instantané de getStockPharmacie (alertes et stocks)` : objet `{ [structureId]: await pharmacie.getStockPharmacie(structureId, userId) }` pour les trois entrées de `ACCES_STOCK` (réponse complète `{ data, message, success }`, ordre du service conservé) ; `verifierInstantane('get-stock-pharmacie', normaliser(objet, options(VOLATILES_FICHES)))`.
6. `instantané de rechercherDisponibilite` : interface locale `ResultatRecherche { id: string; quantite: number; disponible: boolean; structure: { id: string } }`. Cas, dans cet ordre (clé, arguments) :
   - `'sans filtre'` : `()` ;
   - `'recherche para'` : `('para')` ;
   - `'recherche AMOX en majuscules'` : `('AMOX')` ;
   - `'recherche trop courte'` : `('p')` ;
   - `'recherche sans résultat'` : `('zzzz')` ;
   - `'ville conakry'` : `(undefined, 'conakry')` ;
   - `'ville inconnue'` : `(undefined, 'Kankan')` ;
   - `'pharmacie 2'` : `(undefined, undefined, undefined, undefined, 'str-pharma-2')` ;
   - `'pharmacie 3 non configurée'` : `(undefined, undefined, undefined, undefined, 'str-pharma-3')` ;
   - `'hôpital'` : `(undefined, undefined, undefined, undefined, 'str-hopital-1')` ;
   - `'distance depuis Kaloum'` : `(undefined, undefined, 9.5092, -13.7122)` ;
   - `'distance et recherche'` : `('para', undefined, 9.5716, -13.6476)`.
   Pour chaque cas : `r = await pharmacie.rechercherDisponibilite(...)` ; `liste = r.data as unknown as ResultatRecherche[]` ; valeur rangée = `{ ...r, data: trierDansGroupes(liste, (s) => s.structure.id) }`. Assertions explicites sur `'sans filtre'` (avant normalisation) : 29 résultats ; tous `quantite > 0` et `disponible` vrai ; `structure.id` dans `['str-pharma-1', 'str-pharma-2']` ; les ids triés = ids triés des fiches de ces deux pharmacies à quantité positive. Sur `'pharmacie 3 non configurée'` et `'hôpital'` : 0 résultat. Puis `verifierInstantane('rechercher-disponibilite', normaliser(objetDesCas, options(VOLATILES_FICHES)))`.
7. `instantané de getMedicament` : pour `n` de 1 à 20, `id = 'med-' + String(n).padStart(2, '0')`, `r = await pharmacie.getMedicament(id)` ; valeur rangée = `{ ...r, data: { ...r.data, stocks: [...r.data.stocks].sort(par id) } }`. Assertion explicite pour chaque `id` : ids des `stocks` = ids triés des fiches de `resume.fiches` de ce médicament avec `quantite > 0` et `disponible` vrai (par exemple `med-01` donne `['stk-21', 'stk-36']`). Plus la clé `'med-inexistant'` = `await capturerErreur(pharmacie.getMedicament('med-inexistant'))`, avec `statut` 404 vérifié. Puis `verifierInstantane('get-medicament', normaliser(objet, options(VOLATILES_FICHES)))`.
8. `instantané de listerVentes` : cas, dans cet ordre (clé, appel) :
   - `'str-pharma-1 J'` : `ventes.listerVentes('str-pharma-1', 'usr-pharm-p1', { date: jourJ })` ;
   - `'str-pharma-1 J page 2'` : `('str-pharma-1', 'usr-pharm-p1', { date: jourJ, page: 2 })` ;
   - `'str-pharma-1 veille'` : `('str-pharma-1', 'usr-pharm-p1', { date: veille })` ;
   - `'str-pharma-2 veille'` : `('str-pharma-2', 'usr-admin-p2', { date: veille })` ;
   - `'str-pharma-2 J'` : `('str-pharma-2', 'usr-admin-p2', { date: jourJ })` ;
   - `'date invalide'` : `await capturerErreur(ventes.listerVentes('str-pharma-1', 'usr-pharm-p1', { date: '2026-02-30' }))`, `statut` 400 vérifié.
   Assertions explicites : `'str-pharma-1 J'` a `totalJour` 24000, `nombre` 4 et des ids de ventes dans l'ordre `['vte-p1-4', 'vte-p1-3', 'vte-p1-2', 'vte-p1-1']` ; `'str-pharma-2 veille'` a `totalJour` 6000 et `nombre` 2 ; `'str-pharma-1 veille'` et `'str-pharma-2 J'` ont `nombre` 0. Puis `verifierInstantane('lister-ventes', normaliser(objet, options(VOLATILES_VENTES)))`.
9. `instantané de detailVente` : pour chaque `[venteId, structureId, userId]` de `[['vte-p1-1', 'str-pharma-1', 'usr-pharm-p1'], ['vte-p1-2', 'str-pharma-1', 'usr-pharm-p1'], ['vte-p1-3', 'str-pharma-1', 'usr-pharm-p1'], ['vte-p1-4', 'str-pharma-1', 'usr-pharm-p1'], ['vte-p2-1', 'str-pharma-2', 'usr-admin-p2'], ['vte-p2-2', 'str-pharma-2', 'usr-admin-p2']]`, clé `venteId` = `await ventes.detailVente(structureId, venteId, userId)`. Plus la clé `'vte-p2-1 depuis str-pharma-1'` = `await capturerErreur(ventes.detailVente('str-pharma-1', 'vte-p2-1', 'usr-pharm-p1'))`, `statut` 404 vérifié. Assertions explicites : `vte-p1-3` a `statut` `'ANNULEE'`, `motifAnnulation` `'Erreur de saisie'`, 1 ligne ; `vte-p1-1` a 2 lignes et `total` 15000 ; `pharmacie.logoUrl` est `null` partout. Puis `verifierInstantane('detail-vente', normaliser(objet, options(VOLATILES_VENTES)))`.

Les tests 4 à 9 lisent seulement (aucune écriture en base hors l'`UPDATE` des coordonnées du `beforeAll`). Aucun cas de refus d'accès n'est figé (D461 : PB03 change le contrôle d'accès et ses messages).

Cas limites couverts par la conception (pas de test supplémentaire) : exécution un autre jour (dates relatives à J, D459) ; exécution le 1er janvier (année des numéros masquée) ; ordre non garanti à l'intérieur d'une pharmacie dans la recherche et sans tri dans `getMedicament` (tri stable par id) ; distances flottantes arrondies à 1e-6 ; champs ajoutés par PB06 et suivantes ignorés par la projection.

### 3. Génération des instantanés (une seule fois, dans cette tâche)

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T -e MAJ_INSTANTANES=1 backend npm run test:db` : écrit les cinq fichiers ; tout vert.
2. Relire les cinq fichiers (Read) : aucun `<volatil>` sur `dateExpiration`, `quantite`, `prixUnitaire`, `disponible`, `numero`, `total` ; `createdAt` des ventes relatifs (`J+0j 08:00:00.000`...) ; aucune date absolue `AAAA-MM-JJ` restante.
3. Déterminisme : `docker compose exec -T backend sh -c "sha256sum test/db/instantanes/*.json"`, puis relancer le point 1, puis la même commande `sha256sum` : les cinq empreintes sont identiques. Si elles diffèrent, ne pas toucher aux fichiers : identifier le champ instable, le corriger par la normalisation prévue ou rendre BLOCKED avec le champ en cause.
4. `docker compose exec -T backend npm run test:db` **sans** `MAJ_INSTANTANES` : tout vert (comparaison réelle).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash (seule exception : les cinq instantanés JSON écrits par le test, section 3).

Propres à la tâche :
- Aucun fichier sous `src/`, `prisma/`, `.githooks/`, `compose*.yml`, `.env*`, ni `package.json`, `package-lock.json`, `jest.config.js`, `test/db/jest-db.json`, `test/db/harnais.ts`, `test/db/harnais.db-spec.ts`, `test/db/fixtures/` ne change. Aucune dépendance ajoutée.
- Si une lecture ne se comporte pas comme décrit dans « Contexte vérifié », ne pas modifier le service : rendre BLOCKED avec l'écart constaté.
- Jamais afficher, journaliser ni écrire une URL de base, un mot de passe ou une valeur de `.env` ; ne pas lancer `env`, `printenv` ni `echo $DATABASE_URL` (D454).
- Français partout ; aucun tiret cadratin ni demi-cadratin ; ESLint propre sans `eslint-disable` ; prettier du projet (`singleQuote`, `trailingComma: all`) sur les deux `.ts`.

## Done when

Toutes les commandes sont lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte`, conteneur `backend` démarré :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint test/db/outils-instantanes.ts test/db/non-regression-lectures.db-spec.ts` : aucune erreur ni avertissement.
3. `docker compose exec -T backend npm test` : vert, inchangé (62 suites, 715 réussis, 3 ignorés ; aucun fichier de `test/db` exécuté).
4. Section 3 menée jusqu'au bout : empreintes `sha256sum` identiques entre deux générations.
5. `docker compose exec -T backend npm run test:db` sans `MAJ_INSTANTANES` : 2 suites, 20 tests (11 du harnais, 9 de PB02), tous verts.
6. Aucune base jetable restante : `docker compose exec -T backend node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query(\"SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'mc_test_%'\")).then(r=>{console.log(r.rows[0].n);return c.end();})"` affiche `0`.
7. `docker compose exec -T backend sh -c "grep -rlE '://|password|[0-9]{4}-[0-9]{2}-[0-9]{2}' test/db/instantanes || echo propre"` affiche `propre` ; `docker compose exec -T backend sh -c "grep -rlP '[\x{2013}\x{2014}]' test/db/instantanes test/db/outils-instantanes.ts test/db/non-regression-lectures.db-spec.ts || echo propre"` affiche `propre`.
8. `git -C back_medconnect status --short` ne montre que les 2 fichiers `.ts` et le dossier `test/db/instantanes/` (5 fichiers), plus `docs/plans/` modifié par l'orchestrateur.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne) pour chaque point du Done when, dont les cinq empreintes. Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
