# B4 - TB5 : version minimale (426 VERSION_OBSOLETE), GET /app/version, GET /app/config, numéro d'urgence centralisé

Tier: spécifié (agent implementeur-specifie)
Audience: dev (contrat JSON de `/app/*` et des en-têtes, lu par l'application mobile) ; non-dev pour le message du 426 et les libellés des numéros d'urgence (textes fixés ci-dessous, à recopier à l'identique)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot2-back` (arbre principal, ne pas créer de branche, NE PAS COMMITER : l'orchestrateur commite après validation). Deux fichiers sont dans le dépôt RACINE `D:\souleymane\perso-archive-20260923\perso\medconnecte` (`.env.example`, `compose.yml`) : les modifier aussi, sans commit.
Décisions de référence : `docs/plans/runs/2026-10-20-lot2/decisions.md`, D28 à D39. Plan : `mobile_medconnect/docs/PLAN-APPLICATION-MOBILE.md`, paragraphe TB5 (ligne 1023) et critère ligne 1661.

## Spec

### Contexte (à lire avant de coder)

- Aucun préfixe global de routes (`src/main.ts`) : les routes sont `/app/version`, `/auth/login`, etc. Pas de garde d'auth globale : une route sans `@UseGuards(AuthGuard)` est publique.
- Gardes globales déclarées dans `src/app.module.ts` (`providers`, jeton `APP_GUARD`) : aujourd'hui seulement `UserThrottlerGuard`. `src/app.module.spec.ts` vérifie ces déclarations par métadonnées.
- `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` : `ConfigService` est injectable partout. `validateEnv` (`src/config/env.validation.ts`) écrit les valeurs par défaut dans `process.env` quand la variable est absente ou vide.
- Filtre global `src/common/filters/all-exceptions.filter.ts` : pour une `HttpException` de statut < 500, garde le `message` rédigé par le projet, recopie `code` s'il est dans le catalogue `src/common/filters/codes-erreur.ts`. `LIBELLES` n'a pas d'entrée 426 (le libellé tomberait sur « Demande refusée »).
- `src/common/services/ai.service.ts`, méthode `getEmergencyFirstAid`, bloc `catch` : la réponse de repli contient « 15 » en dur. `AiService` reçoit déjà `ConfigService` (`this.configService`). Son spec (`ai.service.spec.ts`) construit le service avec un `ConfigService` simulé (`get: (cle) => variables[cle]`), qui renvoie `undefined` pour toute variable non fournie.
- `@SkipThrottle()` de `@nestjs/throttler` pose la métadonnée `THROTTLER:SKIPdefault` (valeur `true`) sur la classe ; `UserThrottlerGuard` (qui étend `ThrottlerGuard`) la respecte.
- `supertest` est installé (devDependencies) ; import `import request from 'supertest';` (voir `test/app.e2e-spec.ts`).
- `back_medconnect/.env.example` n'existe pas (D36) : le créer. Ne JAMAIS lire ni modifier `back_medconnect/.env`, `.env.production` ni le `.env` racine.

Tout ce qui suit est livré dans cette seule tâche (la garde, les routes, la configuration et les variables ne fonctionnent qu'ensemble).

### 1. Catalogue `src/common/filters/codes-erreur.ts`

Ajouter en dernière position du tableau, après `'TRANSITION_INTERDITE',` :
```ts
  // Version de l'application mobile sous la minimale de sa plateforme (426), mise à jour requise.
  'VERSION_OBSOLETE',
```
Rien d'autre.

### 2. Filtre `src/common/filters/all-exceptions.filter.ts`

Dans `LIBELLES`, ajouter `426: 'Mise à jour requise',` entre la ligne `413` et la ligne `429`. Rien d'autre.

### 3. Nouveau fichier `src/config/numeros-urgence.ts`

Source unique du numéro d'urgence (D29) :
```ts
import type { ConfigService } from '@nestjs/config';

/** Numéro d'urgence médicale servi tant que NUMERO_URGENCE_MEDICALE n'est pas réglée (Q04 ouverte). */
export const NUMERO_URGENCE_MEDICALE_PAR_DEFAUT = '15';

export interface NumeroUrgence {
  code: 'URGENCE_MEDICALE';
  libelle: string;
  numero: string;
}

/** Numéro d'urgence médicale configuré (variable NUMERO_URGENCE_MEDICALE), « 15 » par défaut. */
export function numeroUrgenceMedicale(config: ConfigService): string {
  const valeur = config.get<string>('NUMERO_URGENCE_MEDICALE')?.trim();
  return valeur ? valeur : NUMERO_URGENCE_MEDICALE_PAR_DEFAUT;
}

/** Numéros d'urgence publiés dans GET /app/config. Liste extensible (pompiers, police après Q04). */
export function numerosUrgence(config: ConfigService): NumeroUrgence[] {
  return [
    {
      code: 'URGENCE_MEDICALE',
      libelle: 'Urgences médicales',
      numero: numeroUrgenceMedicale(config),
    },
  ];
}
```

### 4. `src/common/services/ai.service.ts`

- Importer `numeroUrgenceMedicale` depuis `'../../config/numeros-urgence'`.
- Dans le `catch` de `getEmergencyFirstAid`, remplacer la chaîne `reponse` par un gabarit identique au texte actuel, où seul « 15 » est remplacé par `${numeroUrgenceMedicale(this.configService)}` :
  `` `Une erreur est survenue lors de la récupération des instructions de secours. En cas d'urgence vitale, appelez immédiatement le ${numeroUrgenceMedicale(this.configService)} ou les secours locaux.` ``
- Rien d'autre (les `eslint-disable` existants restent).

### 5. Nouveau fichier `src/configuration-publique/configuration-publique.constants.ts`

```ts
/** Version servie quand aucune n'est réglée : 0.0.0, donc aucun téléphone n'est bloqué. */
export const VERSION_PAR_DEFAUT = '0.0.0';

/** Version des CGU et de la politique de confidentialité quand aucune n'est réglée. */
export const VERSION_DOCUMENT_PAR_DEFAUT = '1.0';

/** Cache court (D34) : la version sert aussi de sonde de connectivité au téléphone. */
export const CACHE_VERSION = 'public, max-age=60';
export const CACHE_CONFIG = 'public, max-age=300';

/** Message du 426, affiché tel quel par l'application mobile. */
export const MESSAGE_VERSION_OBSOLETE =
  "Cette version de MedConnecte n'est plus prise en charge. Mettez à jour l'application pour continuer.";
```

### 6. Nouveau fichier `src/configuration-publique/versions.ts` (comparaison sans dépendance, D32)

```ts
/** Format exigé dans les variables d'environnement (validateEnv). */
export const FORMAT_VERSION_CONFIG = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;

// 1 à 3 nombres ; tout suffixe après « - » ou « + » est ignoré (1.2.0-beta vaut 1.2.0).
const FORMAT_LECTURE = /^(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:[-+].*)?$/;

export type Version = [number, number, number];

/** Lit une version envoyée par un client (« 1.4 », « 1.4.2-beta »), null si illisible. */
export function lireVersion(brut: string | undefined | null): Version | null { ... }

/** Négatif si a < b, 0 si égales, positif si a > b. */
export function comparerVersions(a: Version, b: Version): number { ... }
```
- `lireVersion` : `trim()` de l'entrée ; `null` si vide, absente ou si `FORMAT_LECTURE` ne correspond pas ; sinon les trois groupes convertis par `Number`, un groupe absent vaut `0`.
- `comparerVersions` : compare composante par composante, renvoie la première différence non nulle (`a[i] - b[i]`), sinon `0`.

### 7. Nouveau fichier `src/configuration-publique/configuration-publique.service.ts`

```ts
@Injectable()
export class ConfigurationPubliqueService {
  constructor(private readonly config: ConfigService) {}
  versionMinimale(plateforme: Plateforme): string
  versions(): Record<Plateforme, VersionPlateforme>
  configuration(): ConfigurationPublique
}
```
Types exportés depuis ce fichier :
```ts
export const PLATEFORMES = ['android', 'ios'] as const;
export type Plateforme = (typeof PLATEFORMES)[number];
export interface VersionPlateforme {
  versionMinimale: string;
  versionRecommandee: string;
  urlTelechargement: string | null;
}
export interface ConfigurationPublique {
  numerosUrgence: NumeroUrgence[];
  versionsDocuments: { cgu: string; politiqueConfidentialite: string };
  fonctions: { espaceSoignant: boolean; annulationSos: boolean; boutonDemo: boolean };
}
```
Règles (lecture à chaque appel par `this.config.get<string>(cle)`, coût négligeable ; valeurs `trim()` ; `undefined` ou vide = défaut) :
- Suffixe de variable par plateforme : `ANDROID` pour `android`, `IOS` pour `ios` (`plateforme.toUpperCase()`).
- `versionMinimale(p)` : `APP_VERSION_MINIMALE_<P>` si elle respecte `FORMAT_VERSION_CONFIG`, sinon `VERSION_PAR_DEFAUT`.
- `versions()` : pour chaque plateforme de `PLATEFORMES` :
  - `versionMinimale` : comme ci-dessus ;
  - `versionRecommandee` : `APP_VERSION_RECOMMANDEE_<P>` (même règle de format et même défaut) ; si elle est inférieure à la minimale (`comparerVersions` sur `lireVersion` des deux), renvoyer la minimale (D32) ;
  - `urlTelechargement` : `APP_URL_TELECHARGEMENT_<P>` si non vide, sinon `null`.
- `configuration()` :
  - `numerosUrgence` : `numerosUrgence(this.config)` (fichier du point 3) ;
  - `versionsDocuments.cgu` : `VERSION_CGU` sinon `VERSION_DOCUMENT_PAR_DEFAUT` ; `versionsDocuments.politiqueConfidentialite` : `VERSION_POLITIQUE_CONFIDENTIALITE` sinon `VERSION_DOCUMENT_PAR_DEFAUT` ;
  - `fonctions.espaceSoignant` / `annulationSos` / `boutonDemo` : vrai seulement si `FONCTION_ESPACE_SOIGNANT` / `FONCTION_ANNULATION_SOS` / `FONCTION_BOUTON_DEMO` vaut `true` après `trim().toLowerCase()`, faux sinon.
- Aucune autre donnée dans la réponse (pas d'identifiant, pas de secret, pas d'URL interne).

### 8. Nouveau fichier `src/configuration-publique/configuration-publique.controller.ts`

```ts
@ApiTags('Application mobile')
@SkipThrottle()
@Controller('app')
export class ConfigurationPubliqueController {
  constructor(private readonly service: ConfigurationPubliqueService) {}

  @Get('version')
  @Header('Cache-Control', CACHE_VERSION)
  @ApiOperation({ summary: "Versions minimale et recommandée de l'application mobile, URL de téléchargement par plateforme (public)" })
  version() {
    return { success: true, data: this.service.versions() };
  }

  @Get('config')
  @Header('Cache-Control', CACHE_CONFIG)
  @ApiOperation({ summary: "Configuration publique : numéros d'urgence, versions des CGU et de la politique de confidentialité, fonctions activées (public)" })
  config() {
    return { success: true, data: this.service.configuration() };
  }
}
```
Commentaire en tête de classe (français) : routes publiques sans jeton, jamais bloquées par la garde de version (`/app/*`) ni comptées par le limiteur (D28), réponses sans donnée sensible.

### 9. Nouveau fichier `src/configuration-publique/version-minimale.guard.ts`

```ts
@Injectable()
export class VersionMinimaleGuard implements CanActivate {
  constructor(private readonly service: ConfigurationPubliqueService) {}
  canActivate(context: ExecutionContext): boolean { ... }
}
```
Algorithme exact (D31), dans cet ordre :
1. `context.getType() !== 'http'` : renvoyer `true` (sockets non concernées).
2. `const req = context.switchToHttp().getRequest<Request>()` (type `Request` d'`express`). `const chemin = req.path ?? ''`. Si `chemin === '/app'` ou `chemin.startsWith('/app/')` : `true`.
3. Lire un en-tête par une fonction de module non exportée `entete(req, nom): string | undefined` (si tableau, premier élément ; `trim()` ; chaîne vide = `undefined`).
4. `entete(req, 'x-client')?.toLowerCase() !== 'mobile'` : `true` (le web n'est jamais concerné). Ne PAS réutiliser `typeClient` de `src/auth/client.ts` (il dépend de `SESSIONS_MULTI_APPAREILS`).
5. `const plateforme = entete(req, 'x-plateforme')?.toLowerCase()` ; si ce n'est pas une valeur de `PLATEFORMES` : `true`.
6. `const version = lireVersion(entete(req, 'x-app-version'))` ; si `null` : `true`.
7. `const minimale = lireVersion(this.service.versionMinimale(plateforme))` ; si `minimale` est `null` ou `comparerVersions(version, minimale) >= 0` : `true`.
8. Sinon : `throw new HttpException({ message: MESSAGE_VERSION_OBSOLETE, code: 'VERSION_OBSOLETE' }, HttpStatus.UPGRADE_REQUIRED);` (426).

Commentaire en tête de classe (français) : refuse en 426 VERSION_OBSOLETE un client mobile sous la version minimale de sa plateforme, sur toute route sauf `/app/*` ; un en-tête absent ou illisible laisse passer (défaut tolérant) ; le web n'envoie pas `X-Client: mobile` et n'est jamais affecté.

### 10. Nouveau fichier `src/configuration-publique/configuration-publique.module.ts`

```ts
@Module({
  controllers: [ConfigurationPubliqueController],
  providers: [ConfigurationPubliqueService],
  exports: [ConfigurationPubliqueService],
})
export class ConfigurationPubliqueModule {}
```
Commentaire court : version minimale et configuration publique de l'application mobile (TB5).

### 11. `src/app.module.ts`

- Importer `ConfigurationPubliqueModule` et `VersionMinimaleGuard`.
- Ajouter `ConfigurationPubliqueModule,` dans `imports`, juste avant `// Mode démo : ...` / `DemoModule`.
- Dans `providers`, insérer AVANT l'entrée `{ provide: APP_GUARD, useClass: UserThrottlerGuard }` :
  ```ts
    // Version minimale de l'application mobile (TB5) : avant le limiteur, une requête
    // refusée en 426 n'entame pas le quota.
    {
      provide: APP_GUARD,
      useClass: VersionMinimaleGuard,
    },
  ```
- Rien d'autre.

### 12. `src/config/env.validation.ts`

- Importer `FORMAT_VERSION_CONFIG` (`../configuration-publique/versions`), `VERSION_PAR_DEFAUT` et `VERSION_DOCUMENT_PAR_DEFAUT` (`../configuration-publique/configuration-publique.constants`), `NUMERO_URGENCE_MEDICALE_PAR_DEFAUT` (`./numeros-urgence`).
- Ajouter avant `const RULES` trois fonctions de validation non exportées :
  - `versionValide(v)` : `null` si `FORMAT_VERSION_CONFIG.test(v)`, sinon `'doit être une version au format X.Y.Z (ex. 1.4.0)'` ;
  - `urlValide(v)` : `null` si `v` commence par `https://` ou `http://`, sinon `'doit être une URL (https://...)'` ;
  - `booleenValide(v)` : `null` si `['true', 'false'].includes(v.toLowerCase())`, sinon `"doit valoir 'true' ou 'false'"`.
- Ajouter à la fin de `RULES` (après `SESSIONS_MULTI_APPAREILS`), précédé du commentaire `// Application mobile (TB5) : versions et URL par plateforme, lues par GET /app/version et la garde de version. Absentes : 0.0.0, personne n'est bloqué.` :
  - `APP_VERSION_MINIMALE_ANDROID`, `APP_VERSION_RECOMMANDEE_ANDROID`, `APP_VERSION_MINIMALE_IOS`, `APP_VERSION_RECOMMANDEE_IOS` : `required: false`, `default: VERSION_PAR_DEFAUT`, `validate: versionValide` ;
  - `APP_URL_TELECHARGEMENT_ANDROID`, `APP_URL_TELECHARGEMENT_IOS` : `required: false`, sans défaut, `validate: urlValide` ;
  - commentaire `// Configuration publique (GET /app/config) : numéro d'urgence, versions des documents légaux, fonctions activées.` puis :
  - `NUMERO_URGENCE_MEDICALE` : `required: false`, `default: NUMERO_URGENCE_MEDICALE_PAR_DEFAUT`, `validate` : `null` si `/^\+?[0-9]{2,15}$/` correspond, sinon `'doit être un numéro de téléphone (chiffres seulement, ex. 15)'` ;
  - `VERSION_CGU`, `VERSION_POLITIQUE_CONFIDENTIALITE` : `required: false`, `default: VERSION_DOCUMENT_PAR_DEFAUT`, `validate` : `null` si `/^[0-9A-Za-z._-]{1,20}$/` correspond, sinon `'doit être un numéro de version court (ex. 1.0 ou 2026-10)'` ;
  - `FONCTION_ESPACE_SOIGNANT`, `FONCTION_ANNULATION_SOS`, `FONCTION_BOUTON_DEMO` : `required: false`, `default: 'false'`, `validate: booleenValide`.
- Ne pas modifier les règles existantes ni `validateEnv`.

### 13. Variables d'environnement hors code

Les 12 variables, dans cet ordre : `APP_VERSION_MINIMALE_ANDROID`, `APP_VERSION_RECOMMANDEE_ANDROID`, `APP_URL_TELECHARGEMENT_ANDROID`, `APP_VERSION_MINIMALE_IOS`, `APP_VERSION_RECOMMANDEE_IOS`, `APP_URL_TELECHARGEMENT_IOS`, `NUMERO_URGENCE_MEDICALE`, `VERSION_CGU`, `VERSION_POLITIQUE_CONFIDENTIALITE`, `FONCTION_ESPACE_SOIGNANT`, `FONCTION_ANNULATION_SOS`, `FONCTION_BOUTON_DEMO`.

- **`.env.example` racine** (`D:\souleymane\perso-archive-20260923\perso\medconnecte\.env.example`) : insérer juste après la ligne `SESSIONS_MULTI_APPAREILS=true` (et avant la ligne vide qui précède `# ---------- MinIO / S3`) :
  ```
  # Application mobile : version minimale (en dessous, l'application demande une mise à
  # jour), version recommandée et lien de téléchargement, par plateforme. Format X.Y.Z.
  # Vides : 0.0.0, aucun téléphone n'est bloqué.
  APP_VERSION_MINIMALE_ANDROID=
  APP_VERSION_RECOMMANDEE_ANDROID=
  APP_URL_TELECHARGEMENT_ANDROID=
  APP_VERSION_MINIMALE_IOS=
  APP_VERSION_RECOMMANDEE_IOS=
  APP_URL_TELECHARGEMENT_IOS=
  # Numéro d'urgence médicale affiché par l'application et l'assistant de secours. Défaut : 15.
  NUMERO_URGENCE_MEDICALE=
  # Versions des CGU et de la politique de confidentialité (changer la valeur à chaque
  # nouvelle version publiée). Défaut : 1.0.
  VERSION_CGU=
  VERSION_POLITIQUE_CONFIDENTIALITE=
  # Fonctions de l'application mobile (true ou false, défaut false) : espace soignant,
  # annulation d'une alerte SOS par le patient, bouton Démonstration pour la revue des stores.
  FONCTION_ESPACE_SOIGNANT=false
  FONCTION_ANNULATION_SOS=false
  FONCTION_BOUTON_DEMO=false
  ```
- **`back_medconnect/.env.example`** (nouveau, D36) : en-tête
  ```
  # Exemple de variables du backend pour un lancement hors Docker.
  # Liste de référence complète : .env.example à la racine du monorepo.
  # Ce fichier ne reprend pour l'instant que les variables de l'application mobile (TB5).
  ```
  puis une ligne vide puis exactement le bloc ci-dessus (commentaires compris).
- **`compose.yml` racine**, service `backend`, bloc `environment`, juste après la ligne `SESSIONS_MULTI_APPAREILS: ${SESSIONS_MULTI_APPAREILS:-true}` :
  ```yaml
      # Application mobile (TB5) : versions minimale et recommandée, lien de téléchargement.
      # Vides : 0.0.0, aucun téléphone bloqué (défauts appliqués par env.validation.ts).
      APP_VERSION_MINIMALE_ANDROID: ${APP_VERSION_MINIMALE_ANDROID:-}
      APP_VERSION_RECOMMANDEE_ANDROID: ${APP_VERSION_RECOMMANDEE_ANDROID:-}
      APP_URL_TELECHARGEMENT_ANDROID: ${APP_URL_TELECHARGEMENT_ANDROID:-}
      APP_VERSION_MINIMALE_IOS: ${APP_VERSION_MINIMALE_IOS:-}
      APP_VERSION_RECOMMANDEE_IOS: ${APP_VERSION_RECOMMANDEE_IOS:-}
      APP_URL_TELECHARGEMENT_IOS: ${APP_URL_TELECHARGEMENT_IOS:-}
      # Configuration publique (GET /app/config)
      NUMERO_URGENCE_MEDICALE: ${NUMERO_URGENCE_MEDICALE:-}
      VERSION_CGU: ${VERSION_CGU:-}
      VERSION_POLITIQUE_CONFIDENTIALITE: ${VERSION_POLITIQUE_CONFIDENTIALITE:-}
      FONCTION_ESPACE_SOIGNANT: ${FONCTION_ESPACE_SOIGNANT:-false}
      FONCTION_ANNULATION_SOS: ${FONCTION_ANNULATION_SOS:-false}
      FONCTION_BOUTON_DEMO: ${FONCTION_BOUTON_DEMO:-false}
  ```
  Même indentation que les lignes voisines (6 espaces). Ces deux fichiers racine portent déjà des modifications d'autres tâches non commitées : n'ajouter que ces lignes, ne rien retirer.

### 14. Documentation `back_medconnect/CLAUDE.md`

- Section « Conventions importantes (pièges) », ajouter une puce juste après la puce « **Limiteur de débit** » :
  ```
  - **Version et configuration publiques (TB5)** : module `src/configuration-publique/`. `GET /app/version` (public, `Cache-Control: public, max-age=60`) renvoie `{ success, data: { android, ios } }`, chaque plateforme `{ versionMinimale, versionRecommandee, urlTelechargement }` (URL `null` si non réglée ; recommandée jamais sous la minimale). `GET /app/config` (public, `max-age=300`) renvoie `{ success, data: { numerosUrgence: [{ code, libelle, numero }], versionsDocuments: { cgu, politiqueConfidentialite }, fonctions: { espaceSoignant, annulationSos, boutonDemo } } }`, sans donnée sensible. Les deux routes échappent au limiteur (`@SkipThrottle`). `VersionMinimaleGuard` (garde globale, avant le limiteur) répond 426 `VERSION_OBSOLETE` à un client qui envoie `X-Client: mobile`, `X-Plateforme` (`android` ou `ios`) et une `X-App-Version` inférieure à la minimale de sa plateforme, sur toute route sauf `/app/*` ; un en-tête absent ou illisible laisse passer, le web n'est jamais affecté. Versions lues au format `1`, `1.4` ou `1.4.2` (suffixe `-beta` ignoré). Le numéro d'urgence a une source unique, `src/config/numeros-urgence.ts`, lue aussi par le repli de `AiService`. `X-Api-Version` est réservé (version 1 implicite), non lu.
  ```
- Section « Variables d'environnement », dans la phrase « Autres : ... », juste avant « Les anciennes `S3_*` sont **legacy** », ajouter :
  ```
  Application mobile (TB5, toutes optionnelles, refusées au démarrage si malformées) : `APP_VERSION_MINIMALE_ANDROID`, `APP_VERSION_RECOMMANDEE_ANDROID`, `APP_VERSION_MINIMALE_IOS`, `APP_VERSION_RECOMMANDEE_IOS` (format `X.Y.Z`, défaut `0.0.0`), `APP_URL_TELECHARGEMENT_ANDROID`, `APP_URL_TELECHARGEMENT_IOS` (URL, sans défaut), `NUMERO_URGENCE_MEDICALE` (défaut `15`), `VERSION_CGU`, `VERSION_POLITIQUE_CONFIDENTIALITE` (défaut `1.0`), `FONCTION_ESPACE_SOIGNANT`, `FONCTION_ANNULATION_SOS`, `FONCTION_BOUTON_DEMO` (`true` ou `false`, défaut `false`).
  ```
- Rien d'autre dans ce fichier.

### 15. Tests Jest (tous sous `src/`, `*.spec.ts`)

**a. Nouveau `src/configuration-publique/versions.spec.ts`**
- `lireVersion` : `'1.4.2'` donne `[1, 4, 2]` ; `'1.4'` donne `[1, 4, 0]` ; `'2'` donne `[2, 0, 0]` ; `' 1.2.0-beta '` donne `[1, 2, 0]` ; `'1.2.0+45'` donne `[1, 2, 0]` ; `''`, `undefined`, `'abc'`, `'1..2'`, `'v1.2.0'` donnent `null`.
- `comparerVersions` : `1.10.0 > 1.9.0` (positif) ; `1.2.0` égale `1.2.0` (0) ; `0.9.9 < 1.0.0` (négatif).

**b. Nouveau `src/configuration-publique/configuration-publique.spec.ts`** (niveau HTTP, supertest, sans base ni Redis)
- Fabrique `creerApp(variables: Record<string, string | undefined>)` :
  ```ts
  @Controller('essai')
  class ControleurEssai {
    @Get() lire() { return { ok: true }; }
  }
  const module = await Test.createTestingModule({
    controllers: [ConfigurationPubliqueController, ControleurEssai],
    providers: [
      ConfigurationPubliqueService,
      { provide: ConfigService, useValue: { get: (cle: string) => variables[cle] } },
      { provide: APP_GUARD, useClass: VersionMinimaleGuard },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  ```
  Fermer chaque app dans `afterEach` (`await app.close()`).
- En-têtes mobiles d'un client obsolète : `{ 'X-Client': 'mobile', 'X-Plateforme': 'android', 'X-App-Version': '1.0.0' }` avec `APP_VERSION_MINIMALE_ANDROID: '1.2.0'`.
- Cas obligatoires (un `it` chacun, intitulés en français) :
  1. client mobile obsolète sur `GET /essai` : statut 426, `body.code === 'VERSION_OBSOLETE'`, `body.message === MESSAGE_VERSION_OBSOLETE`, `body.error === 'Mise à jour requise'`, `body.statusCode === 426`.
  2. même client sur `GET /app/version` et sur `GET /app/config` : 200.
  3. web (mêmes `X-Plateforme` et `X-App-Version`, sans `X-Client`) sur `GET /essai` : 200 ; et avec `X-Client: web` : 200.
  4. version égale à la minimale (`1.2.0`) : 200 ; supérieure (`1.10.0`) : 200 ; `X-Client: ' Mobile '` avec `1.0.0` : 426 (casse et espaces ignorés).
  5. minimale réglée seulement pour android (`1.2.0`) : un client `ios` en `1.0.0` passe (200).
  6. aucune variable réglée (défaut 0.0.0) : client mobile android `0.0.1` passe (200).
  7. défauts tolérants : client mobile obsolète sans `X-App-Version`, avec `X-App-Version: 'abc'`, sans `X-Plateforme`, avec `X-Plateforme: 'windows'` : 200 dans les quatre cas.
  8. `GET /app/version` sans variable : 200, en-tête `cache-control` égal à `CACHE_VERSION`, `body` égal à `{ success: true, data: { android: { versionMinimale: '0.0.0', versionRecommandee: '0.0.0', urlTelechargement: null }, ios: { versionMinimale: '0.0.0', versionRecommandee: '0.0.0', urlTelechargement: null } } }`.
  9. `GET /app/version` avec `APP_VERSION_MINIMALE_ANDROID: '1.2.0'`, `APP_VERSION_RECOMMANDEE_ANDROID: '1.5.0'`, `APP_URL_TELECHARGEMENT_ANDROID: 'https://play.google.com/store/apps/details?id=com.medconnecte'`, `APP_VERSION_MINIMALE_IOS: '2.0.0'`, `APP_VERSION_RECOMMANDEE_IOS: '1.0.0'` : android `{ '1.2.0', '1.5.0', URL }`, ios `{ versionMinimale: '2.0.0', versionRecommandee: '2.0.0', urlTelechargement: null }`.
  10. `GET /app/config` sans variable : 200, `cache-control` égal à `CACHE_CONFIG`, `body` égal à `{ success: true, data: { numerosUrgence: [{ code: 'URGENCE_MEDICALE', libelle: 'Urgences médicales', numero: '15' }], versionsDocuments: { cgu: '1.0', politiqueConfidentialite: '1.0' }, fonctions: { espaceSoignant: false, annulationSos: false, boutonDemo: false } } }` (égalité stricte `toEqual` : prouve qu'aucune autre clé n'est servie).
  11. `GET /app/config` avec `NUMERO_URGENCE_MEDICALE: '117'`, `VERSION_CGU: '2026-10'`, `VERSION_POLITIQUE_CONFIDENTIALITE: '2'`, `FONCTION_ESPACE_SOIGNANT: 'TRUE'`, `FONCTION_ANNULATION_SOS: 'false'`, `FONCTION_BOUTON_DEMO: 'true'` : valeurs correspondantes (`numero: '117'`, `cgu: '2026-10'`, `politiqueConfidentialite: '2'`, `espaceSoignant: true`, `annulationSos: false`, `boutonDemo: true`).
  12. métadonnées : `Reflect.getMetadata('THROTTLER:SKIPdefault', ConfigurationPubliqueController)` vaut `true`.

**c. `src/app.module.spec.ts`** : ajouter un `it('enregistre VersionMinimaleGuard comme APP_GUARD global, avant UserThrottlerGuard', ...)` qui vérifie `estDeclare(APP_GUARD, VersionMinimaleGuard)` et que l'index de cette entrée dans `providers` est inférieur à celui de `UserThrottlerGuard` (`findIndex`).

**d. `src/common/services/ai.service.spec.ts`** : ajouter un `describe('AiService : repli de getEmergencyFirstAid', ...)` qui construit le service avec `post: jest.fn().mockReturnValue(throwError(() => new Error('panne')))` (`throwError` de `rxjs`) :
  - sans `NUMERO_URGENCE_MEDICALE` : `reponse` contient `'appelez immédiatement le 15 ou les secours locaux'` ;
  - avec `NUMERO_URGENCE_MEDICALE: '117'` : `reponse` contient `'appelez immédiatement le 117 ou les secours locaux'`.
  Ne pas modifier les tests existants.

**e. `src/config/env.validation.spec.ts`** : ajouter un `describe('Application mobile et configuration publique (TB5)', ...)` qui sauvegarde puis restaure dans `afterEach` les 12 variables dans `process.env` (même motif que le bloc `SESSIONS_MULTI_APPAREILS`) :
  - absentes : `APP_VERSION_MINIMALE_ANDROID` vaut `'0.0.0'`, `NUMERO_URGENCE_MEDICALE` vaut `'15'`, `VERSION_CGU` vaut `'1.0'`, `FONCTION_ANNULATION_SOS` vaut `'false'` dans la config renvoyée ; `APP_URL_TELECHARGEMENT_IOS` reste absente (`undefined`) ;
  - refus au démarrage (`toThrow(/<NOM>/)`) : `APP_VERSION_MINIMALE_IOS: '1.2'`, `APP_URL_TELECHARGEMENT_ANDROID: 'play.google.com/x'`, `NUMERO_URGENCE_MEDICALE: '15 ou 18'`, `VERSION_CGU: 'version une'`, `FONCTION_BOUTON_DEMO: 'oui'` ;
  - acceptés : `APP_VERSION_RECOMMANDEE_ANDROID: '1.4.0'`, `NUMERO_URGENCE_MEDICALE: '+224117'`, `FONCTION_ESPACE_SOIGNANT: 'TRUE'`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Propres à B4 :
- Aucune nouvelle dépendance npm (pas de `semver`) ; `package.json` et `package-lock.json` inchangés.
- Aucune migration Prisma, aucun accès base ou Redis dans les nouvelles routes et la garde.
- Textes visibles (message du 426, libellé « Urgences médicales », commentaires, Swagger) en français, recopiés à l'identique, sans tiret cadratin ni demi-cadratin.
- Ne jamais lire ni modifier un fichier `.env` réel (`back_medconnect/.env`, `back_medconnect/.env.production`, `.env` racine).
- Ne rien changer au front (`front_medconnect`, D39).
- Si une commande du « Done when » échoue sur un fichier hors de la liste ci-dessous (dette existante), ne pas le corriger : le signaler dans le Return.

Fichiers touchés (liste fermée) :
- nouveaux : `src/config/numeros-urgence.ts`, `src/configuration-publique/configuration-publique.constants.ts`, `src/configuration-publique/versions.ts`, `src/configuration-publique/versions.spec.ts`, `src/configuration-publique/configuration-publique.service.ts`, `src/configuration-publique/configuration-publique.controller.ts`, `src/configuration-publique/version-minimale.guard.ts`, `src/configuration-publique/configuration-publique.module.ts`, `src/configuration-publique/configuration-publique.spec.ts`, `.env.example` (back) ;
- modifiés : `src/common/filters/codes-erreur.ts`, `src/common/filters/all-exceptions.filter.ts`, `src/common/services/ai.service.ts`, `src/common/services/ai.service.spec.ts`, `src/app.module.ts`, `src/app.module.spec.ts`, `src/config/env.validation.ts`, `src/config/env.validation.spec.ts`, `CLAUDE.md` ;
- dépôt racine : `.env.example`, `compose.yml`.

## Done when

Toutes les commandes lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (conteneur `backend` démarré) :

1. `docker compose exec -T backend npx tsc --noEmit` : sortie vide, code 0.
2. `docker compose exec -T backend npx eslint src/config/numeros-urgence.ts src/configuration-publique/configuration-publique.constants.ts src/configuration-publique/versions.ts src/configuration-publique/versions.spec.ts src/configuration-publique/configuration-publique.service.ts src/configuration-publique/configuration-publique.controller.ts src/configuration-publique/version-minimale.guard.ts src/configuration-publique/configuration-publique.module.ts src/configuration-publique/configuration-publique.spec.ts src/common/filters/codes-erreur.ts src/common/filters/all-exceptions.filter.ts src/common/services/ai.service.ts src/common/services/ai.service.spec.ts src/app.module.ts src/app.module.spec.ts src/config/env.validation.ts src/config/env.validation.spec.ts` : 0 erreur (avertissements tolérés seulement s'ils existaient avant la tâche sur la même ligne).
3. `docker compose exec -T backend npx jest` : toutes les suites vertes, dont `versions.spec.ts`, `configuration-publique.spec.ts` (12 cas du point 15b au moins), et les nouveaux cas de `app.module.spec.ts`, `ai.service.spec.ts` et `env.validation.spec.ts`.
4. `docker compose config --quiet` : code 0 (le `compose.yml` modifié reste valide), et `grep -c "APP_VERSION_MINIMALE_ANDROID\|FONCTION_BOUTON_DEMO\|NUMERO_URGENCE_MEDICALE" compose.yml .env.example back_medconnect/.env.example` donne au moins 3 pour chacun des trois fichiers.
5. Contrôle de fumée sur le serveur de dev (rechargé automatiquement) : `docker compose exec -T backend node -e "Promise.all(['/app/version','/app/config'].map(p=>fetch('http://localhost:3001'+p).then(async r=>console.log(p,r.status,r.headers.get('cache-control'),await r.text()))))"` affiche deux statuts 200, `public, max-age=60` puis `public, max-age=300`, et des corps conformes aux points 15b-8 et 15b-10 (si le `.env` local règle déjà ces variables, les valeurs peuvent différer : le noter dans le Return).
6. (Git Bash) `git -C back_medconnect diff -U0 | grep "^+" | LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]"` et `LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]" back_medconnect/src/configuration-publique/*.ts back_medconnect/src/config/numeros-urgence.ts back_medconnect/.env.example` : aucune ligne (les tirets déjà présents dans les lignes non modifiées de CLAUDE.md ne comptent pas).
7. `grep -n '15 ou les secours' back_medconnect/src/common/services/ai.service.ts` : aucune ligne (le « 15 » en dur a disparu du repli).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

Liste des fichiers modifiés ou créés (back puis racine), puis une ligne de résultat par commande 1 à 7 du « Done when ».

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
