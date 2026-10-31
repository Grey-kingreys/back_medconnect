# PB16b - Étanchéité des coûts sur toutes les routes exposées (CA22)

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: dev (tests et contrat d'API ; une seule réponse change : les paramètres de la pharmacie)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Seconde sous-fiche de PB16 (D601), après PB16a (commitée). Elle livre le test de permission transversal exigé par la demande (« un rôle vendeur n'obtient jamais de donnée de coût ou de marge par aucun endpoint », CA22, D407, D466) sous une forme qui **ne peut pas oublier une route** (D606 à D609) :

1. une découverte des routes **réellement exposées** par la métadonnée Nest (modules importés depuis `AppModule`, contrôleurs, chemins, méthodes, gardes, permissions) ;
2. un inventaire explicite des routes `/pharmacie` avec leur classe (`JSON`, `FICHIER`, `PUBLIQUE`), un test unitaire qui échoue si l'inventaire et la découverte divergent, dans un sens ou dans l'autre ;
3. un test sur base de test qui appelle **chaque** route inventoriée en HTTP, avec les vrais contrôleurs, les vrais services, le vrai `PermissionsGuard` et les vrais rôles en base, pour un vendeur qui a toutes les permissions de pharmacie sauf `marge:read`, et vérifie qu'aucune clé de coût n'apparaît ; contrôle positif : le titulaire reçoit bien des coûts sur les routes qui en portent ;
4. un balayage statique : hors de `src/pharmacie/`, aucun fichier de `src` ne lit une table ou un champ de coût ;
5. la seule fuite trouvée à la préparation : la clé `debutFiabiliteMarge` dans les paramètres de la pharmacie (`GET .../referentiels`, `GET` et `PATCH .../parametres`, routes `caisse:utiliser` donc ouvertes au vendeur) est retirée de la réponse (D610).

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`.** Ne pas toucher aux migrations, aux retours arrière, aux instantanés `test/db/instantanes/`, ni aux fichiers `test/db/*.db-spec.ts` existants, sauf la seule ligne de `test/db/points-de-vente.db-spec.ts` décrite au point 6.

Décisions applicables (`decisions.md`) : D407, D466, D483, D508, D540, D573, D575, D584, D598, et celles de cette fiche, D606 à D610.

### Contexte vérifié (ne pas re-découvrir)

- `AppModule` (`src/app.module.ts`) s'importe dans un test unitaire sans infrastructure (précédent : `src/app.module.spec.ts`, qui lit `Reflect.getMetadata('providers', AppModule)` ; `test/jest.setup-env.ts` pose l'environnement factice). Ses `imports` mêlent des classes de module et des modules dynamiques (`ConfigModule.forRoot`, `LoggerModule.forRoot`, `ThrottlerModule.forRootAsync`, objets `{ module, imports?, controllers?, providers? }`).
- Constantes Nest : `import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'` ; `RequestMethod` de `@nestjs/common` (enum numérique, `RequestMethod[n]` donne `'GET'`, `'POST'`...). Permissions : `PERMISSIONS_KEY` (`src/common/rbac/require-permissions.decorator.ts`, valeur `'required_permissions'`), posé sur la méthode.
- Seuls deux fichiers de `src` hors `src/pharmacie/` contiennent des mots de coût : `src/demo/demo.seeder.ts` (écrit des lots démo à coût 0, aucune route ne relit ses données hors pharmacie) et aucun autre (vérifié par `grep -rlnE "\b(lotStock|allocationLot|LotStock|AllocationLot)\b|cout(Unitaire|AchatBoite)|debutFiabiliteMarge" src --include=*.ts`, specs exclues).
- `PharmacieModule` (`src/pharmacie/pharmacie.module.ts`) déclare 9 contrôleurs après PB16a (`PharmacieController`, `VenteController`, `PointsDeVenteController`, `FicheProduitController`, `SessionsCaisseController`, `ReceptionsController`, `InventairesController`, `AnomaliesController`, `RapportsController`) et ses services. Dépendances externes à fournir dans un module de test : `PrismaService`, `PermissionsService` (vrai, dépend de `REDIS_CLIENT` et `PrismaService`), `NotificationsService` (seule méthode utilisée : `createManyNotifications`), `StorageService` (seule méthode utilisée : `getPublicUrl`). `PointsDeVenteService.onApplicationBootstrap` complète les points de vente (sans effet sur la base de test déjà migrée).
- Modèle de module de test HTTP (garde d'authentification remplacée par l'en-tête `x-essai-user`, `ValidationPipe` et `AllExceptionsFilter` de `main.ts`) : `src/pharmacie/receptions/receptions.http.spec.ts`. `main.ts` ajoute `ClassSerializerInterceptor` en global : l'ajouter aussi.
- Fixture `test/db/fixtures/format-actuel.ts` : pharmacie `str-pharma-1`, titulaire `usr-admin-p1` (rôle `rol-p1-admin`, qui reçoit par M1 les 7 permissions T1 dont `marge:read`), vendeur `usr-pharm-p1` (rôle `rol-p1-pharmacien`, permissions de la fixture plus `caisse:utiliser` par M1, sans `marge:read`). `User.appRoleId`, `AppRole { id, nom, structureId, isSystem, updatedAt }`, `RolePermission { appRoleId, permissionId }`, `Permission { id, code }`.
- `PERMISSIONS_AUTORISEES_PHARMACIE` (`src/common/rbac/permissions-type-structure.ts`) : liste blanche des 20 permissions effectives d'un membre de pharmacie, `marge:read` comprise.
- `cheminsCout(donnees)` et `masquerCouts` (`src/pharmacie/masquer-couts.ts`), `MOTIF_CLE_COUT = /cout|marge/i`. `MIME_XLSX` est exporté par `src/pharmacie/pharmacie.service.ts` (import permis dans un test). Construction de classeurs : `construireFichier` de `test/db/import-livraison.db-spec.ts` (`Workbook`, première feuille lue par l'import si le nom ne correspond pas) ; titres d'un inventaire : `ENTETES` de `test/db/import-inventaire.db-spec.ts` ; catalogue : colonnes `Nom`, `Nom générique`, `Catégorie`, `Description`, `Ordonnance requise`, `Formes` (`CatalogueImportService.getModeleImportCatalogue`).
- Clés de coût dans les réponses du titulaire, vérifiées à la lecture du code : `lots[].coutUnitaire` (lecture du stock, upsert, correction de quantité, liste des lots, correction de date de lot, réception), `coutAchatBoite` (réception, rapport d'import livraison), `allocations[].coutUnitaire` (création, détail et annulation de vente), `valeurCout` (alertes, PB16a), `coutAlloue` et `marge` (rapport de marge, PB16a). Aucune dans : liste des ventes, liste des réceptions, fournisseurs, postes, sessions, inventaires, anomalies, fiche produit, catalogue.

### 1. `test/etancheite-couts/decouverte-routes.ts` (nouveau)

```ts
import type { Type } from '@nestjs/common';

export interface RouteDecouverte {
  /** 'GET /pharmacie/:structureId/ventes' */
  cle: string;
  methode: string;
  chemin: string;
  controleur: Type;
  handler: string;
  /** Permissions de @RequirePermissions sur la méthode (tableau vide sinon). */
  permissions: string[];
  /** Gardes de @UseGuards, méthode puis classe. */
  gardes: unknown[];
}

/** Contrôleurs de tout le graphe d'imports d'un module, sans doublon, dans l'ordre de parcours. */
export function controleursDuModule(racine: unknown): Type[];

/** Routes HTTP de ces contrôleurs, triées par clé. */
export function routesDesControleurs(controleurs: Type[]): RouteDecouverte[];
```

Règles exactes :

1. `controleursDuModule` : parcours en profondeur avec un `Set` des modules visités. Un élément d'`imports` est : une classe (lire `Reflect.getMetadata('imports' | 'controllers', classe)`) ; un objet `{ forwardRef: () => X }` (suivre `X`) ; un module dynamique (objet avec `module`) : lire la métadonnée de `module` **et** les champs `imports` et `controllers` de l'objet ; une `Promise` ou toute autre forme : lever `Error('Import de module non reconnu : ...')` (aucune n'existe aujourd'hui ; mieux vaut échouer que d'oublier une route). Les contrôleurs sont dédoublonnés.
2. `routesDesControleurs` : pour chaque contrôleur, chemins de classe = `PATH_METADATA` de la classe (chaîne ou tableau, absent = `''`) ; pour chaque nom de `Object.getOwnPropertyNames(prototype)` sauf `constructor`, si la fonction a `PATH_METADATA` : chemins de méthode (chaîne ou tableau, `'/'` vaut `''`), méthode `RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)]`, une route par combinaison de chemins. Chemin = `'/' + [classe, methode].filter(Boolean).join('/')`, barres répétées réduites, barre finale retirée (sauf `'/'`). `permissions` = `Reflect.getMetadata(PERMISSIONS_KEY, fn) ?? []`. `gardes` = `[...(Reflect.getMetadata(GUARDS_METADATA, fn) ?? []), ...(Reflect.getMetadata(GUARDS_METADATA, controleur) ?? [])]`. Tri par `cle`.

### 2. `test/etancheite-couts/routes-pharmacie.ts` (nouveau, inventaire explicite, D607)

```ts
export type ClasseRoute = 'JSON' | 'FICHIER' | 'PUBLIQUE';

export interface RouteInventoriee {
  /** JSON : réponse lue ; FICHIER : classeur binaire, sans donnée de la pharmacie ; PUBLIQUE : sans authentification. */
  classe: ClasseRoute;
  /** Le titulaire reçoit au moins une clé de coût dans le scénario (contrôle positif). */
  porteCout: boolean;
  /** La garde exige marge:read (le vendeur reçoit 403). */
  exigeMarge: boolean;
}

export const ROUTES_PHARMACIE = { ... } as const satisfies Record<string, RouteInventoriee>;
export type CleRoutePharmacie = keyof typeof ROUTES_PHARMACIE;
```

Contenu exact, dans cet ordre (50 routes ; `J` = `JSON`, `F` = `FICHIER`, `P` = `PUBLIQUE` ; `C` = `porteCout: true`, `M` = `exigeMarge: true`, sinon faux) :

| # | Clé | Classe | C | M |
|---|---|---|---|---|
| 1 | `GET /pharmacie/:structureId/referentiels` | J | | |
| 2 | `GET /pharmacie/:structureId/parametres` | J | | |
| 3 | `PATCH /pharmacie/:structureId/parametres` | J | | |
| 4 | `POST /pharmacie/:structureId/postes` | J | | |
| 5 | `GET /pharmacie/:structureId/postes` | J | | |
| 6 | `PATCH /pharmacie/:structureId/postes/:posteId` | J | | |
| 7 | `POST /pharmacie/:structureId/caisse/sessions` | J | | |
| 8 | `GET /pharmacie/:structureId/caisse/sessions/courante` | J | | |
| 9 | `GET /pharmacie/:structureId/caisse/sessions` | J | | |
| 10 | `POST /pharmacie/:structureId/caisse/sessions/:sessionId/comptages` | J | | |
| 11 | `POST /pharmacie/:structureId/caisse/sessions/:sessionId/mouvements` | J | | |
| 12 | `GET /pharmacie/:structureId/caisse/sessions/:sessionId/bilan` | J | | |
| 13 | `POST /pharmacie/:structureId/ventes` | J | C | |
| 14 | `GET /pharmacie/:structureId/ventes` | J | | |
| 15 | `GET /pharmacie/:structureId/ventes/:venteId` | J | C | |
| 16 | `POST /pharmacie/:structureId/ventes/:venteId/annuler` | J | C | |
| 17 | `POST /pharmacie/:structureId/caisse/sessions/:sessionId/fermer` | J | | |
| 18 | `GET /pharmacie/:structureId/fournisseurs` | J | | |
| 19 | `POST /pharmacie/:structureId/fournisseurs` | J | | |
| 20 | `POST /pharmacie/:structureId/receptions` | J | C | |
| 21 | `GET /pharmacie/:structureId/receptions` | J | | |
| 22 | `GET /pharmacie/:structureId/receptions/:receptionId` | J | C | |
| 23 | `GET /pharmacie/:structureId/stock/:stockId/lots` | J | C | |
| 24 | `PATCH /pharmacie/:structureId/lots/:lotId` | J | C | |
| 25 | `PATCH /pharmacie/:structureId/stock/:stockId/fiche` | J | | |
| 26 | `GET /pharmacie/stock/:structureId` | J | C | |
| 27 | `POST /pharmacie/stock/:structureId` | J | C | |
| 28 | `PATCH /pharmacie/stock/:structureId/:stockId/quantite` | J | C | |
| 29 | `DELETE /pharmacie/stock/:structureId/:stockId` | J | | |
| 30 | `POST /pharmacie/:structureId/stock/sorties` | J | | |
| 31 | `POST /pharmacie/:structureId/inventaires` | J | | |
| 32 | `GET /pharmacie/:structureId/inventaires` | J | | |
| 33 | `GET /pharmacie/:structureId/inventaires/:inventaireId` | J | | |
| 34 | `GET /pharmacie/:structureId/anomalies` | J | | |
| 35 | `PATCH /pharmacie/:structureId/anomalies/:anomalieId` | J | | |
| 36 | `GET /pharmacie/stock/:structureId/import/modele` | F | | |
| 37 | `POST /pharmacie/stock/:structureId/import/apercu` | J | C | |
| 38 | `POST /pharmacie/stock/:structureId/import` | J | C | |
| 39 | `GET /pharmacie/:structureId/stock/alertes-peremption` | J | C | |
| 40 | `GET /pharmacie/:structureId/rapports/marge` | J | C | M |
| 41 | `GET /pharmacie/rechercher` | P | | |
| 42 | `GET /pharmacie/catalogue` | P | | |
| 43 | `GET /pharmacie/catalogue/categories` | P | | |
| 44 | `GET /pharmacie/catalogue/:medicamentId` | P | | |
| 45 | `POST /pharmacie/catalogue` | J | | |
| 46 | `PATCH /pharmacie/catalogue/:medicamentId` | J | | |
| 47 | `GET /pharmacie/catalogue/import/modele` | F | | |
| 48 | `POST /pharmacie/catalogue/import/apercu` | J | | |
| 49 | `POST /pharmacie/catalogue/import` | J | | |
| 50 | `DELETE /pharmacie/catalogue/:medicamentId` | J | | |

En tête du fichier, un commentaire : « Toute route ajoutée sous /pharmacie doit figurer ici avec un appel dans test/db/etancheite-couts.db-spec.ts (le type l'impose) : sinon src/pharmacie/etancheite-couts.spec.ts échoue. Une route qui renvoie un coût doit le masquer par masquerCouts (D466). »

### 3. `src/pharmacie/etancheite-couts.spec.ts` (nouveau, test unitaire, 6 tests)

Imports : `AppModule` (`src/app.module`), `PharmacieModule`, `controleursDuModule`, `routesDesControleurs` (`test/etancheite-couts/decouverte-routes`), `ROUTES_PHARMACIE` (`test/etancheite-couts/routes-pharmacie`), `AuthGuard`, `PERMISSIONS`. `routesApp` = routes de `controleursDuModule(AppModule)` dont le chemin vaut `/pharmacie` ou commence par `/pharmacie/`.

1. « toutes les routes /pharmacie exposées sont inventoriées, et seulement elles » : `manquantes` = clés de `routesApp` absentes de l'inventaire, `enTrop` = clés de l'inventaire absentes de `routesApp` ; `expect(manquantes).toEqual([])` puis `expect(enTrop).toEqual([])` ; aucune clé en double dans `routesApp`.
2. « les routes /pharmacie viennent toutes de PharmacieModule » : clés de `routesDesControleurs(controleursDuModule(PharmacieModule))` = clés de `routesApp` (même ensemble).
3. « exigeMarge suit exactement RequirePermissions » : pour chaque route de `routesApp`, `{ cle, exigeMarge: route.permissions.includes(PERMISSIONS.MARGE_READ) }` égal à `{ cle, exigeMarge: ROUTES_PHARMACIE[cle].exigeMarge }`.
4. « PUBLIQUE exactement pour les routes sans AuthGuard » : pour chaque route, `{ cle, publique: !route.gardes.includes(AuthGuard) }` égal à `{ cle, publique: ROUTES_PHARMACIE[cle].classe === 'PUBLIQUE' }`.
5. « hors src/pharmacie, aucun fichier ne lit un coût » : parcours récursif de `src` (`fs.readdirSync` avec `withFileTypes`), fichiers `.ts` hors `*.spec.ts`, hors `src/pharmacie/` ; chemins relatifs au dépôt écrits avec `/` ; ceux dont le contenu correspond à `/\b(lotStock|allocationLot|LotStock|AllocationLot)\b|cout(Unitaire|AchatBoite)|debutFiabiliteMarge/` ; `expect(fichiers).toEqual(['src/demo/demo.seeder.ts'])` (liste blanche exacte, D609).
6. « découverte : chemins, tableaux et méthode racine » : dans le fichier de test, un contrôleur factice `@Controller('essai') class Essai { @Get() a() {} @Post(['x', 'y/:id']) b() {} @Patch('/z/') c() {} }` et un second `@Controller() class Racine { @Get('sante') d() {} }` : clés `['GET /essai', 'GET /sante', 'PATCH /essai/z', 'POST /essai/x', 'POST /essai/y/:id']` ; `controleursDuModule` sur un module factice `@Module({ imports: [{ module: ModuleDyn, controllers: [Racine] }, forwardRef(() => ModuleB)], controllers: [Essai] })` (avec `ModuleDyn` et `ModuleB` vides, `ModuleB` déclarant `Essai` une seconde fois) renvoie `Essai` et `Racine` une seule fois chacun ; un import `Promise.resolve(ModuleB)` lève une `Error`.

### 4. `test/db/etancheite-couts.db-spec.ts` (nouveau, 4 tests)

#### 4.1 Application de test

`beforeAll` : base de test comme `test/db/inventaire.db-spec.ts` (base vide, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `chargerFormatActuel`, migrations après, `prisma = creerPrismaDeTest(base)`).

```ts
const controleurs = Reflect.getMetadata('controllers', PharmacieModule) as Type[];
const fournisseurs = (Reflect.getMetadata('providers', PharmacieModule) as Provider[])
  .filter((p) => p !== PrismaService);
const module = await Test.createTestingModule({
  controllers: controleurs,
  providers: [
    ...fournisseurs,
    PermissionsService,
    PermissionsGuard,
    { provide: PrismaService, useValue: prisma },
    { provide: REDIS_CLIENT, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) } },
    { provide: NotificationsService, useValue: { createManyNotifications: jest.fn().mockResolvedValue(undefined) } },
    { provide: StorageService, useValue: { getPublicUrl: (cle: string) => `logo/${cle}` } },
  ],
})
  .overrideGuard(AuthGuard)
  .useValue({ canActivate: (ctx) => { /* req.user = { userId: en-tête x-essai-user, role: PROFILS[userId].role, structureId: 'str-pharma-1' } ; false si l'en-tête manque */ } })
  .compile();
```

Puis `createNestApplication()`, `useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: fabriquerErreurValidation }))`, `useGlobalFilters(new AllExceptionsFilter())`, `useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)))`, `init()`. Le vrai `PermissionsService` lit les vrais rôles de la base (cache Redis simulé toujours vide).

Profils : `titulaire` = `usr-admin-p1` (rôle `STRUCTURE_ADMIN`) ; `vendeur` = `usr-pharm-p1` (rôle `PHARMACIEN`), dont le rôle est remplacé dans le test 1 par un rôle « vendeur étendu ».

Données communes (après le test 1, dans un `beforeAll` imbriqué ou en tête du test 2 ; en SQL comme `nouvelleFiche` de `test/db/inventaire.db-spec.ts`, préfixe `etan-`) :

- fiche F : médicament `Produit étanchéité`, coefficient 10, prix 8 000, `qualifie` vrai, tolérance nulle ; réception par `app.get(ReceptionsService).enregistrer('str-pharma-1', 'usr-admin-p1', { lignes: [lot `LOT-A` 5 boîtes, J+20, coût boîte 5 000 ; lot `LOT-B` 5 boîtes, J+200, coût 7 000] }, '127.0.0.1')` ; `LF1`, `LF2` = identifiants des lots par `numeroLot` ;
- par profil `p` : fiche `Fp` sans stock (fiche produit), fiche `Ap` sans stock (archivage), médicament `Mp` sans fiche (`Médicament upsert ${p}`).

`jour(n)` comme dans les autres db-specs.

#### 4.2 Appels (un par route, dans l'ordre de l'inventaire)

```ts
type Profil = 'titulaire' | 'vendeur';
interface Contexte {
  profil: Profil;
  /** Requête authentifiée du profil (en-tête x-essai-user). */
  en: (methode: 'get' | 'post' | 'patch' | 'delete', chemin: string) => request.Test;
  /** Requête sans authentification. */
  anonyme: (chemin: string) => request.Test;
  /** État propre au profil (identifiants créés par les appels précédents). */
  etat: Record<string, string>;
}
type Appel = (c: Contexte) => Promise<request.Response[]>;
const APPELS: Record<CleRoutePharmacie, Appel> = { ... };
```

Le type `Record<CleRoutePharmacie, Appel>` impose un appel pour chaque route de l'inventaire (erreur de compilation sinon). `S` = `str-pharma-1`. Un identifiant d'état absent (appel précédent refusé) vaut `'inexistant'`. Après chaque réponse 2xx, enregistrer dans `etat` l'identifiant indiqué.

| # | Appel(s) du profil `p` |
|---|---|
| 1 | `GET /pharmacie/S/referentiels` |
| 2 | `GET /pharmacie/S/parametres` |
| 3 | `PATCH /pharmacie/S/parametres` `{ seuilEcartCaisse: 6000 }` |
| 4 | `POST /pharmacie/S/postes` `{ type: 'WEB', appareilId: 'etancheite-' + p }` ; `etat.posteId = data.id` |
| 5 | `GET /pharmacie/S/postes` |
| 6 | `PATCH /pharmacie/S/postes/:posteId` `{ libelle: 'Comptoir ' + p }` |
| 7 | `POST /pharmacie/S/caisse/sessions` `{ posteId }` ; `etat.sessionId = data.id` |
| 8 | `GET /pharmacie/S/caisse/sessions/courante?posteId=` |
| 9 | `GET /pharmacie/S/caisse/sessions` |
| 10 | `POST .../caisse/sessions/:sessionId/comptages` `{ moment: 'OUVERTURE', coupures: [{ valeurFaciale: 5000, nombre: 2 }] }` |
| 11 | `POST .../caisse/sessions/:sessionId/mouvements` `{ type: 'APPORT', montant: 5000, motif: 'Fond complémentaire' }` |
| 12 | `GET .../caisse/sessions/:sessionId/bilan` |
| 13 | `POST /pharmacie/S/ventes` `{ posteId, lignes: [{ stockId: F, quantite: 1 }], ordonnanceVerifiee: true }` ; `etat.venteId = data.id` |
| 14 | `GET /pharmacie/S/ventes` |
| 15 | `GET /pharmacie/S/ventes/:venteId` |
| 16 | `POST /pharmacie/S/ventes/:venteId/annuler` `{ motif: 'Erreur de saisie', posteId }` |
| 17 | `POST .../caisse/sessions/:sessionId/fermer` `{ comptageFermeture: { coupures: [{ valeurFaciale: 5000, nombre: 3 }] }, commentaire: 'Contrôle de fin de journée' }` |
| 18 | `GET /pharmacie/S/fournisseurs` |
| 19 | `POST /pharmacie/S/fournisseurs` `{ nom: 'Fournisseur ' + p }` ; `etat.fournisseurId = data.id` |
| 20 | `POST /pharmacie/S/receptions` `{ fournisseurId, lignes: [{ stockId: F, nombreBoites: 1, dateExpiration: jour(150), coutAchatBoite: 6000 }] }` ; `etat.receptionId = data.id` |
| 21 | `GET /pharmacie/S/receptions` |
| 22 | `GET /pharmacie/S/receptions/:receptionId` |
| 23 | `GET /pharmacie/S/stock/F/lots` |
| 24 | `PATCH /pharmacie/S/lots/LF2` `{ dateExpiration: jour(p === 'titulaire' ? 201 : 202), motif: 'Date relue sur la boîte' }` |
| 25 | `PATCH /pharmacie/S/stock/Fp/fiche` `{ toleranceInventaire: 2 }` |
| 26 | `GET /pharmacie/stock/S` |
| 27 | `POST /pharmacie/stock/S` `{ medicamentId: Mp, quantite: 5, prixUnitaire: 4000, dateExpiration: jour(120) }` |
| 28 | `PATCH /pharmacie/stock/S/F/quantite` `{ variation: 1, lotId: LF2, motif: 'Boîte retrouvée' }` |
| 29 | `DELETE /pharmacie/stock/S/Ap` |
| 30 | `POST /pharmacie/S/stock/sorties` `{ stockId: F, lotId: LF2, unite: 'UNITE', quantite: 1, raison: 'CASSE' }` |
| 31 | `POST /pharmacie/S/inventaires` `{ lignes: [{ stockId: F, lotId: LF1, quantiteComptee: p === 'titulaire' ? 41 : 42 }] }` ; `etat.inventaireId = data.id`, `etat.anomalieId = data.anomalies[0].id` (écart non nul, tolérance nulle : une anomalie `ECART_INVENTAIRE`) |
| 32 | `GET /pharmacie/S/inventaires` |
| 33 | `GET /pharmacie/S/inventaires/:inventaireId` |
| 34 | `GET /pharmacie/S/anomalies` |
| 35 | `PATCH /pharmacie/S/anomalies/:anomalieId` `{ commentaire: 'Écart vérifié en rayon' }` |
| 36 | `GET /pharmacie/stock/S/import/modele?mode=livraison` |
| 37 | deux appels `POST /pharmacie/stock/S/import/apercu` : champ `mode` `livraison` et fichier de livraison ; champ `mode` `inventaire` et fichier d'inventaire |
| 38 | les deux mêmes appels sur `POST /pharmacie/stock/S/import` |
| 39 | `GET /pharmacie/S/stock/alertes-peremption` |
| 40 | `GET /pharmacie/S/rapports/marge?du=` `jour(0)` `&au=` `jour(0)` |
| 41 | `anonyme('/pharmacie/rechercher?q=' + encodeURIComponent('Produit étanchéité'))` |
| 42 | `anonyme('/pharmacie/catalogue')` |
| 43 | `anonyme('/pharmacie/catalogue/categories')` |
| 44 | `anonyme('/pharmacie/catalogue/' + médicament de F)` |
| 45 | `POST /pharmacie/catalogue` `{ nom: 'Médicament étanchéité ' + p, categorie: 'Test', ordonnanceRequise: false }` ; `etat.medicamentId = data.id` |
| 46 | `PATCH /pharmacie/catalogue/:medicamentId` `{ description: 'Relu par la pharmacie' }` |
| 47 | `GET /pharmacie/catalogue/import/modele` |
| 48 | `POST /pharmacie/catalogue/import/apercu` avec le fichier de catalogue |
| 49 | `POST /pharmacie/catalogue/import` avec le fichier de catalogue |
| 50 | `DELETE /pharmacie/catalogue/:medicamentId` |

Fichiers (construits comme `construireFichier`, `.attach('fichier', buffer, { filename: 'stock.xlsx', contentType: MIME_XLSX })`, `.field('mode', ...)` pour le stock) :

- livraison : titres `['Médicament', 'Quantité (boîtes)', 'Prix de la boîte (GNF)', "Date d'expiration (AAAA-MM-JJ)", 'Lot', "Coût d'achat de la boîte (GNF)", 'Notes']`, ligne `['Produit étanchéité', 1, 8000, jour(160), 'LIV-' + p, 6000, '']` ;
- inventaire : titres `ENTETES` de `test/db/import-inventaire.db-spec.ts`, ligne `['Produit étanchéité', 3, 0, 'LOT-B', '']` ;
- catalogue : feuille `Catalogue`, titres `['Nom', 'Nom générique', 'Catégorie', 'Description', 'Ordonnance requise', 'Formes']`, ligne `['Import étanchéité ' + p, '', 'Test', '', 'non', 'comprimé']`.

#### 4.3 Tests

1. « le Pharmacien par défaut n'a pas marge:read, le titulaire l'a » : `app.get(PermissionsService).getUserPermissions` : `usr-pharm-p1` sans `marge:read`, `usr-admin-p1` avec. Puis rôle vendeur étendu : `INSERT INTO "AppRole" ("id", "nom", "structureId", "isSystem", "updatedAt") VALUES ('rol-p1-vendeur-etendu', 'Vendeur étendu (test)', 'str-pharma-1', false, now())`, une ligne `RolePermission` par code de `PERMISSIONS_AUTORISEES_PHARMACIE` sauf `marge:read` (identifiants lus dans `"Permission"` par code ; les 19 codes doivent exister), `UPDATE "User" SET "appRoleId" = 'rol-p1-vendeur-etendu' WHERE "id" = 'usr-pharm-p1'` ; relu : `getUserPermissions('usr-pharm-p1')` contient les 19 codes et pas `marge:read`.
2. « l'inventaire est celui des routes réellement montées » : clés de `routesDesControleurs(controleurs)` = clés de `ROUTES_PHARMACIE` = clés de `APPELS` (mêmes ensembles, tableaux triés égaux).
3. « contrôle positif : le titulaire reçoit des coûts là où il y en a » : profil `titulaire`, tous les appels dans l'ordre ; pour chaque route `porteCout` : toutes ses réponses en 2xx (`{ cle, statuts }` égal à `{ cle, statuts: [...] }` de statuts 2xx, assertion qui nomme la route) et au moins une réponse dont `cheminsCout(res.body).length > 0` (assertion `{ cle, porteCout: true }`). Les autres routes ne sont pas contrôlées pour le titulaire (il n'a pas `catalogue:write`).
4. « CA22 : le vendeur ne reçoit aucune donnée de coût ni de marge, route par route » : profil `vendeur`, tous les appels dans l'ordre ; pour chaque réponse : route `exigeMarge` : statut 403 ; toute autre route : statut 2xx (le vendeur étendu a toutes les autres permissions : un refus signifierait que le scénario ne teste rien) ; classe `FICHIER` : en-tête `content-type` qui contient `spreadsheetml`, corps non lu ; autres classes : `expect({ cle, chemins: cheminsCout(res.body) }).toEqual({ cle, chemins: [] })`, corps d'erreur compris.

Si le test 4 trouve une clé de coût sur une route autre que les trois routes de paramètres corrigées au point 6 : faire passer la réponse de cette route par `masquerCouts(donnees, peutVoirMarge)` dans son service, avec le motif `peutVoirMarge` déjà présent dans ce service (`PermissionsService.getUserPermissions(...).includes(PERMISSIONS.MARGE_READ)`) ; si le service n'a pas `PermissionsService`, s'arrêter et rendre un bloc BLOCKED qui nomme la route et les chemins trouvés. Si un appel du vendeur (hors route `exigeMarge`) n'est pas en 2xx, corriger l'appel (corps, ordre, état) et non l'assertion ; s'il reste refusé par le code de l'application, BLOCKED avec la route, le statut et le corps.

### 5. `src/pharmacie/points-de-vente.service.ts` (D610, seul changement)

Retirer `debutFiabiliteMarge: Date;` de l'interface `ParametresReponse` et la ligne `debutFiabiliteMarge: p.debutFiabiliteMarge,` de `versParametresReponse`. Mettre à jour le commentaire ou la description Swagger qui annonce « 8 champs » s'il en existe un (`grep -rn "debutFiabiliteMarge\|8 champs" src/pharmacie/points-de-vente*`). Rien d'autre.

### 6. `test/db/points-de-vente.db-spec.ts` (seule ligne permise)

Retirer `'debutFiabiliteMarge',` de la liste attendue `Object.keys(data.parametres).sort()` (test « référentiels »). Aucun autre changement.

### 7. `CLAUDE.md` du dépôt back

Ajouter une puce après celle de PB16a : « **Étanchéité des coûts (tranche pharmacie 1, PB16b, CA22)** : `test/etancheite-couts/routes-pharmacie.ts` inventorie toutes les routes `/pharmacie` ; `src/pharmacie/etancheite-couts.spec.ts` échoue si une route exposée manque à l'inventaire (découverte par la métadonnée Nest depuis `AppModule`) ou si un fichier hors `src/pharmacie/` lit un coût ; `test/db/etancheite-couts.db-spec.ts` appelle chaque route avec un vendeur qui a toutes les permissions de pharmacie sauf `marge:read` et échoue sur toute clé `/cout|marge/i`. Une nouvelle route : l'ajouter à l'inventaire et à `APPELS`, et masquer ses coûts par `masquerCouts`. Les paramètres de la pharmacie ne renvoient plus `debutFiabiliteMarge` (exposé par le rapport de marge, D610). »

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script (ni `cat >`, ni `tee`, ni `sed -i`, ni `node -e`, ni `python`) : le hook de garde ne voit pas les écritures faites par Bash. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh` (fins de ligne seulement, jamais commité). Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `test/etancheite-couts/decouverte-routes.ts`, `test/etancheite-couts/routes-pharmacie.ts`, `src/pharmacie/etancheite-couts.spec.ts`, `test/db/etancheite-couts.db-spec.ts`, `src/pharmacie/points-de-vente.service.ts`, `test/db/points-de-vente.db-spec.ts` (une ligne), `CLAUDE.md`, et seulement si le test 4 l'exige selon la règle du point 4.3, le service de la route fautive (ajout de `masquerCouts` à sa réponse).

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint test/etancheite-couts/decouverte-routes.ts test/etancheite-couts/routes-pharmacie.ts src/pharmacie/etancheite-couts.spec.ts test/db/etancheite-couts.db-spec.ts src/pharmacie/points-de-vente.service.ts test/db/points-de-vente.db-spec.ts` (plus tout service corrigé) : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `etancheite-couts.spec.ts` (6).
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/etancheite-couts.db-spec.ts` (4) et `points-de-vente.db-spec.ts`.
5. Preuve que le filet attrape une fuite (à faire puis défaire, résultat noté dans le retour) : remettre temporairement `debutFiabiliteMarge` dans `versParametresReponse` : le test 4 échoue en nommant `GET /pharmacie/:structureId/referentiels` ; retirer temporairement une route de `ROUTES_PHARMACIE` : `tsc` échoue (clé d'`APPELS` en trop) et le test unitaire 1 la liste dans `manquantes`. Restaurer les deux, relancer 1 à 4.
6. `git status --porcelain` (depuis `back_medconnect`) ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git diff -- test/db/points-de-vente.db-spec.ts` = une ligne retirée ; `git diff --stat -- prisma test/db/instantanes` vide.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne), dont la preuve du point 5 et la liste des services corrigés (vide attendu). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
