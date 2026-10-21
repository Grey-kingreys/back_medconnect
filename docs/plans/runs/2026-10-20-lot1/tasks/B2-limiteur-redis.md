# B2 - TB1 : limiteur de débit par utilisateur, stockage Redis, SOS permissif si Redis tombe

Tier: spécifié (agent implementeur-specifie)
Audience: dev (comportement de l'API) ; aucun nouveau texte visible (le 429 garde le message existant du filtre global)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot1-back` (arbre principal, ne pas créer de branche, NE PAS COMMITER : l'orchestrateur commite après validation).
Décisions de référence : `docs/plans/runs/2026-10-20-lot1/decisions.md`, D14 à D19.

## Spec

### Contexte (à lire avant de coder)

- `@nestjs/throttler` 6.5.0. `UserThrottlerGuard` (`src/common/guards/user-throttler.guard.ts`) est la garde globale (`APP_GUARD` dans `src/app.module.ts`). Son `getTracker` lit `req.user?.userId`, MAIS une garde globale passe avant l'`AuthGuard` posé par `@UseGuards` sur les contrôleurs : `req.user` est donc toujours vide à ce moment et tout est compté par IP. C'est le défaut à corriger (D14).
- Stockage actuel : en mémoire (`ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 120 }] })`), faux à plusieurs instances.
- API utile de la 6.5.0 : interface `ThrottlerStorage.increment(key, ttl, limit, blockDuration, throttlerName): Promise<ThrottlerStorageRecord>` avec `ThrottlerStorageRecord = { totalHits, timeToExpire, isBlocked, timeToBlockExpire }` (`ttl` et `blockDuration` en millisecondes, les deux durées renvoyées en SECONDES arrondies au supérieur). `ThrottlerStorageService` (stockage mémoire) est exporté. La garde appelle `getTracker(req, context)` puis `generateKey(context, tracker, throttlerName)` (par défaut sha256 de `<Classe>-<méthode>-<nom>-<tracker>`), puis `storageService.increment(...)`. Une option `getTracker` posée dans `@Throttle({ default: { ..., getTracker } })` remplace celui de la garde pour cette route. `ThrottlerModule.forRootAsync({ inject, useFactory })` accepte `storage` dans les options renvoyées. Décorateurs `InjectThrottlerOptions()` et `InjectThrottlerStorage()` exportés.
- Redis : client ioredis partagé `@Inject(REDIS_CLIENT) redis: Redis` (`src/common/redis/redis.module.ts`, module global, `maxRetriesPerRequest: 2`, `enableOfflineQueue: true` : Redis arrêté, une commande attend plusieurs secondes avant d'échouer, d'où un délai maximal côté appelant).
- `AuthModule` exporte `JwtModule` et `AppModule` importe `AuthModule` : `JwtService` est injectable dans la garde globale.
- SOS : `POST /carnet-sante/sos`, `CarnetSanteController.createUrgence` (`src/carnet-sante/carnet-sante.controller.ts`, `@Throttle({ default: { limit: 5, ttl: 3_600_000 } })`). `CarnetSanteService.createUrgence` (`src/carnet-sante/carnet-sante.service.ts`, vers la ligne 1350) enregistre l'alerte puis fait `await this.queueService.enqueueEmergencyEmail(...)` et `await this.queueService.enqueueSos(...)` (BullMQ sur Redis) : Redis arrêté, ces `await` ne rendent jamais la main et le SOS ne répond pas (D18).
- Le filtre global traduit déjà `ThrottlerException` en 429 « Trop de tentatives » : ne rien changer.

Tout ce qui suit est livré dans cette seule tâche (les morceaux ne fonctionnent qu'ensemble pour tenir le critère).

### 1. Nouveau décorateur `src/common/decorators/limite-permissive.decorator.ts`

```ts
import { SetMetadata } from '@nestjs/common';

/** Métadonnée posée par @LimitePermissiveSiRedisIndisponible(). */
export const LIMITE_PERMISSIVE = 'limitePermissiveSiRedisIndisponible';

/** Préfixe ajouté par UserThrottlerGuard à la clé d'une route permissive. */
export const PREFIXE_CLE_PERMISSIVE = 'permissif:';

/**
 * Route qui doit passer si le stockage Redis du limiteur est indisponible
 * (réservé au SOS : une urgence ne doit jamais être bloquée par une panne Redis).
 */
export const LimitePermissiveSiRedisIndisponible = () =>
  SetMetadata(LIMITE_PERMISSIVE, true);
```

### 2. `src/common/guards/user-throttler.guard.ts` (réécrire)

- Constructeur :
  ```ts
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    super(options, storageService, reflector);
  }
  ```
- `protected async getTracker(req: Record<string, any>): Promise<string>` : `const userId = requete.user?.userId ?? (await this.userIdDuJeton(requete))` ; renvoie `utilisateur:${userId}` si `userId` est une chaîne non vide, sinon `suivreParIp(req)`. Dans le corps, retyper une fois `req` en `{ ip?: string; user?: { userId?: string }; headers?: { authorization?: string } }` pour éviter les erreurs eslint `no-unsafe-*` (la signature `Record<string, any>` est imposée par la classe parente).
- `private async userIdDuJeton(requete): Promise<string | undefined>` : lit `Authorization: Bearer <jeton>` (même découpage que `AuthGuard.extractTokenFromHeader`) ; `await this.jwtService.verifyAsync<{ userId?: unknown }>(jeton, { secret: process.env.JWT_SECRET })` ; renvoie `charge.userId` si c'est une chaîne, sinon `undefined` ; toute exception (jeton expiré, mauvaise signature, malformé) donne `undefined`. Pas de contrôle de révocation ici.
- `protected generateKey(context: ExecutionContext, suffix: string, name: string): string` : `const cle = super.generateKey(context, suffix, name)` ; si `this.reflector.getAllAndOverride<boolean>(LIMITE_PERMISSIVE, [context.getHandler(), context.getClass()])` est vrai, renvoyer `${PREFIXE_CLE_PERMISSIVE}${cle}`, sinon `cle`.
- Exporter, dans le même fichier, `export function suivreParIp(req: Record<string, any>): string` qui renvoie `ip:${ip ?? 'inconnue'}` (même retypage local de `req`).
- Mettre à jour le commentaire JSDoc de la classe : compte par utilisateur (jeton vérifié, la garde globale passant avant l'AuthGuard), par IP sinon ; routes d'auth forcées par IP ; stockage Redis.

### 3. Nouveau stockage `src/common/redis/stockage-limite-redis.ts`

Classe NON `@Injectable` (instanciée par la fabrique du module) :

```ts
export const DELAI_REDIS_LIMITE_MS = 250;
export const INTERVALLE_AVERTISSEMENT_MS = 60_000;

export class StockageLimiteRedis implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(StockageLimiteRedis.name);
  private readonly memoire = new ThrottlerStorageService();
  private dernierAvertissement = 0;
  constructor(private readonly redis: Redis) {}
  ...
}
```

Script Lua (constante `SCRIPT_LIMITE` du fichier, reproduire exactement) :

```lua
local bloc = redis.call('PTTL', KEYS[2])
if bloc > 0 then
  return { tonumber(redis.call('GET', KEYS[2]) or '0'), bloc, 1, bloc }
end
local coups = redis.call('INCR', KEYS[1])
local reste = redis.call('PTTL', KEYS[1])
if reste < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  reste = tonumber(ARGV[1])
end
if coups > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], coups, 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return { coups, tonumber(ARGV[3]), 1, tonumber(ARGV[3]) }
end
return { coups, reste, 0, 0 }
```

(Pendant un blocage, les appels ne sont pas comptés ; à la fin du blocage le compteur repart de zéro, comme le stockage mémoire de la bibliothèque.)

`async increment(key, ttl, limit, blockDuration, throttlerName): Promise<ThrottlerStorageRecord>` :
- `const resultat = await this.avecDelai(this.redis.eval(SCRIPT_LIMITE, 2, \`limite:${key}\`, \`limite:${key}:bloc\`, ttl, limit, Math.max(1, blockDuration)))`.
- Si `resultat` n'est pas un tableau de 4 nombres : lever une `Error('Réponse Redis inattendue')` (traitée comme une panne ci-dessous).
- Renvoyer `{ totalHits: r[0], timeToExpire: Math.ceil(r[1] / 1000), isBlocked: r[2] === 1, timeToBlockExpire: Math.ceil(r[3] / 1000) }`.
- En cas d'erreur ou de délai dépassé : `this.avertir(erreur)` ; si `key.startsWith(PREFIXE_CLE_PERMISSIVE)`, renvoyer `{ totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 }` ; sinon `return this.memoire.increment(key, ttl, limit, blockDuration, throttlerName)`.

`private avecDelai<T>(promesse: Promise<T>): Promise<T>` : `Promise.race` avec un `setTimeout` de `DELAI_REDIS_LIMITE_MS` qui rejette `new Error('délai Redis dépassé')`, minuteur nettoyé par `clearTimeout` dans un `finally`.

`private avertir(erreur: unknown)` : au plus un `this.logger.warn` toutes les `INTERVALLE_AVERTISSEMENT_MS`, texte : `Redis indisponible pour le limiteur de débit (${message}) : SOS laissés passer, autres routes comptées en mémoire locale.`

`onApplicationShutdown()` : `this.memoire.onApplicationShutdown()`.

### 4. `src/app.module.ts` (modifier)

Remplacer `ThrottlerModule.forRoot({...})` par :

```ts
ThrottlerModule.forRootAsync({
  inject: [REDIS_CLIENT],
  useFactory: (redis: Redis) => ({
    throttlers: [{ ttl: 60000, limit: 120 }],
    storage: new StockageLimiteRedis(redis),
  }),
}),
```

Imports : `REDIS_CLIENT` depuis `./common/redis/redis.module`, `StockageLimiteRedis` depuis `./common/redis/stockage-limite-redis`, `Redis` depuis `ioredis` (`import type` si le lint le demande). Mettre à jour le commentaire au-dessus : supprimer la ligne « Stockage en mémoire pour l'instant... brancher un ThrottlerStorage Redis » et dire que le stockage est Redis (juste à plusieurs instances), compté par utilisateur, SOS laissé passer si Redis tombe (D17). Ne rien changer d'autre dans ce fichier.

### 5. `src/auth/auth.controller.ts` (modifier une ligne et son commentaire)

```ts
/** Palier strict pour les endpoints sensibles d'auth : 10 req/min par IP, même avec un jeton. */
const AUTH_THROTTLE = {
  default: { limit: 10, ttl: 60_000, getTracker: suivreParIp },
};
```

Import de `suivreParIp` depuis `src/common/guards/user-throttler.guard`. Ne pas toucher `src/demo/demo.controller.ts`.

### 6. `src/carnet-sante/carnet-sante.controller.ts` (modifier)

Sur `createUrgence`, ajouter `@LimitePermissiveSiRedisIndisponible()` sous le `@Throttle` existant (limite inchangée : 5 par heure) ; commentaire : `// Anti-spam SOS : 5 par heure et par utilisateur ; laissé passer si Redis est indisponible.`

### 7. `src/carnet-sante/carnet-sante.service.ts` (modifier, D18)

- Exporter à côté de `SOS_ANTI_DOUBLON_MINUTES` : `export const DELAI_FILE_SOS_MS = 2000;` avec un commentaire d'une ligne.
- Ajouter une méthode privée :
  ```ts
  /** Envoi en file d'un message SOS au proche, borné : une panne de file ne fait pas échouer l'alerte. */
  private async enfilerSansBloquer(
    nature: 'email' | 'sms',
    urgenceId: string,
    envoi: () => Promise<unknown>,
  ): Promise<void> {
    let minuteur: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        envoi(),
        new Promise((_, rejeter) => {
          minuteur = setTimeout(
            () => rejeter(new Error(`délai de ${DELAI_FILE_SOS_MS} ms dépassé`)),
            DELAI_FILE_SOS_MS,
          );
        }),
      ]);
    } catch (e) {
      this.logger.error(
        `sos.file_indisponible urgenceId=${urgenceId} envoi=${nature} : ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(minuteur);
    }
  }
  ```
- Dans `createUrgence`, remplacer `await this.queueService.enqueueEmergencyEmail({...})` par `await this.enfilerSansBloquer('email', urgence.id, () => this.queueService.enqueueEmergencyEmail({...}))` et de même pour `enqueueSos` avec `'sms'`. Charges utiles strictement identiques. Aucune autre modification de la méthode.

### 8. Tests

#### a. `src/common/redis/stockage-limite-redis.spec.ts` (nouveau)

`afterEach` : `stockage.onApplicationShutdown()`. Faux client : `{ eval: jest.fn() }` passé `as never`.
1. `eval` résout `[3, 59000, 0, 0]` : résultat `{ totalHits: 3, timeToExpire: 59, isBlocked: false, timeToBlockExpire: 0 }` ; `eval` appelé avec `(SCRIPT, 2, 'limite:k', 'limite:k:bloc', 60000, 5, 60000)` (vérifier les 6 derniers arguments, le premier avec `expect.any(String)`).
2. `eval` rejette, clé `permissif:abc`, limite 5 : 10 appels, tous `isBlocked: false`, `totalHits: 0`.
3. `eval` rejette, clé `abc`, limite 2 : 3e appel `isBlocked: true` (repli mémoire).
4. `eval` ne se résout jamais (`new Promise(() => {})`), clé `permissif:abc` : `increment` résout `isBlocked: false` en moins de 1000 ms (minuteurs réels, mesurer avec `Date.now()`).
5. Trois échecs d'affilée : `jest.spyOn(Logger.prototype, 'warn')` appelé une seule fois.
6. Bloc `const decrireAvecRedis = process.env.TEST_REDIS_URL ? describe : describe.skip;` (D19) contre un vrai Redis (`new Redis(process.env.TEST_REDIS_URL!)`, `quit()` dans `afterAll`, clés aléatoires `test-b2-<Date.now()>-<Math.random()>`, supprimées en `afterEach` avec `del('limite:<clé>', 'limite:<clé>:bloc')`) :
   - limite 5, ttl 60000 : appels 1 à 5 non bloqués avec `totalHits` 1 à 5 et `timeToExpire` entre 1 et 60 ; 6e bloqué avec `timeToBlockExpire` entre 1 et 60 ; 7e toujours bloqué ;
   - une seconde clé est indépendante (son 1er appel donne `totalHits: 1`) ;
   - limite 1, ttl 1000, blockDuration 1000 : 2e appel bloqué ; après 1100 ms d'attente réelle, l'appel suivant donne `totalHits: 1`, non bloqué.

#### b. `src/common/guards/user-throttler.guard.spec.ts` (nouveau)

- `const jwt = new JwtService({ secret: process.env.JWT_SECRET })` (la valeur vient de `test/jest.setup-env.ts`) ; jetons `jwt.sign({ userId: 'patient-a', role: 'PATIENT' })` et `'patient-b'`.
- Fabrique `creerGarde(stockage)` : `new UserThrottlerGuard({ throttlers: [{ ttl: 60000, limit: 120 }] }, stockage, new Reflector(), jwt)` puis `await garde.onModuleInit()`.
- Contexte : `{ getHandler: () => handler, getClass: () => classe, switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header: jest.fn() }) }) } as never`, avec `req = { ip, headers: { authorization } }`. Utiliser les vrais gestionnaires pour lire les vraies métadonnées : `CarnetSanteController` et `CarnetSanteController.prototype.createUrgence` ; `AuthController` et `AuthController.prototype.login` / `.forgotPassword`.
- Stockage mémoire `new ThrottlerStorageService()` (appeler `onApplicationShutdown()` en `afterEach`) sauf mention contraire.
- Tests (même IP `41.223.10.1` partout sauf mention) :
  1. Critère : patient A fait 5 SOS acceptés, le 6e lève `ThrottlerException` ; patient B, même IP, fait ensuite 5 SOS acceptés, son 6e lève `ThrottlerException`.
  2. Jeton invalide (`Bearer nimporte-quoi`) : compté par IP (5 acceptés, le 6e refusé, puis un 7e sans jeton depuis la même IP refusé aussi).
  3. `/auth/login` : 10 requêtes alternant jeton A, jeton B et sans jeton sont acceptées, la 11e (jeton A) lève `ThrottlerException` ; une requête depuis l'IP `41.223.10.2` passe.
  4. `/auth/forgot-password` : 10 requêtes avec jeton A acceptées, la 11e avec jeton B refusée.
  5. Redis en panne : garde construite avec `new StockageLimiteRedis({ eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as never)` : 8 SOS du patient A acceptés ; 11 `/auth/login` depuis la même IP : la 11e refusée (repli mémoire).
  6. Redis arrêté (client réel) : `const client = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 2, enableOfflineQueue: true }); client.on('error', () => {});` ; garde sur `new StockageLimiteRedis(client)` : un SOS du patient A résout `true` en moins de 1000 ms. `client.disconnect()` et `onApplicationShutdown()` du stockage en fin de test.

#### c. `src/carnet-sante/carnet-sante.urgence.spec.ts` (ajouter un `describe`, ne pas modifier les tests existants)

Scénario où le proche est prévenu : `prisma.urgence.create` résout une alerte dont `patient` vaut `{ nom: 'N', prenom: 'P', telephone: null, email: 'patient@exemple.gn', profilMedical: { contactTelephone: '+224620000000', contactEmail: 'proche@exemple.gn', contactNom: 'Proche' } }` (vérifier dans `src/demo/demo-mode.ts` que cet email n'est pas un compte démo).
1. `queueService.enqueueSos.mockRejectedValue(new Error('Redis arrêté'))` et `enqueueEmergencyEmail` idem : `createUrgence('p1', {})` résout `success: true` ; `jest.spyOn(Logger.prototype, 'error')` reçoit un message contenant `sos.file_indisponible` et ne contenant ni `+224620000000` ni `proche@exemple.gn`.
2. `enqueueSos` et `enqueueEmergencyEmail` renvoient `new Promise(() => {})` : avec `jest.useFakeTimers()`, lancer `createUrgence('p1', {})`, faire `await jest.advanceTimersByTimeAsync(DELAI_FILE_SOS_MS * 2 + 100)`, la promesse est résolue avec `success: true` ; `jest.useRealTimers()` en fin de test. Si l'avancement des minuteurs n'atteint pas les deux `await` successifs, avancer en deux fois (`DELAI_FILE_SOS_MS + 50`, deux fois).

### 9. `CLAUDE.md` du dépôt back (modifier)

Dans « Conventions importantes (pièges) », ajouter une puce après la puce « Sessions (TB3) » :
« **Limiteur de débit** : `UserThrottlerGuard` (garde globale) compte par utilisateur en lisant le jeton Bearer (signature vérifiée), sinon par IP ; `/auth/register`, `/auth/login`, `/auth/forgot-password` et `/auth/reset-password` restent comptés par IP. Stockage Redis (`StockageLimiteRedis`, script Lua, juste à plusieurs instances). Redis absent ou plus lent que 250 ms : les routes `@LimitePermissiveSiRedisIndisponible()` (le SOS) passent, les autres sont comptées en mémoire locale. L'email et le SMS au proche d'un SOS sont mis en file avec un délai de 2 s, sans faire échouer l'alerte. »

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Spécifique :
- Aucune nouvelle dépendance npm, aucune migration Prisma, aucune variable d'environnement nouvelle pour l'application (`TEST_REDIS_URL` ne sert qu'au test).
- Commentaires, logs et textes en français ; jamais de tiret cadratin ni demi-cadratin.
- Ne journaliser ni coordonnées du proche, ni position, ni jeton.
- Fichiers autorisés : les 10 fichiers listés dans « Done when », plus `CLAUDE.md` du dépôt back. Tout autre fichier : BLOCKED.

## Done when

Toutes les commandes sont lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/common/decorators/limite-permissive.decorator.ts src/common/guards/user-throttler.guard.ts src/common/guards/user-throttler.guard.spec.ts src/common/redis/stockage-limite-redis.ts src/common/redis/stockage-limite-redis.spec.ts src/app.module.ts src/auth/auth.controller.ts src/carnet-sante/carnet-sante.controller.ts src/carnet-sante/carnet-sante.service.ts src/carnet-sante/carnet-sante.urgence.spec.ts` : 0 erreur (les avertissements préexistants de ces fichiers sont tolérés, aucun nouvel avertissement dans les fichiers nouveaux).
3. `docker compose exec -T backend npx jest` : toutes les suites passent ; les tests des points 8a (sauf le bloc Redis réel, sauté), 8b et 8c sont présents et verts.
4. `docker compose exec -T -e TEST_REDIS_URL=redis://redis:6379 backend npx jest src/common/redis/stockage-limite-redis.spec.ts --verbose` : tous les tests passent, y compris ceux du bloc contre le vrai Redis (aucun « skipped »).
5. `git -C back_medconnect status --porcelain` ne liste, hors `docs/plans/` (tenu par le chef d'équipe), que les 10 fichiers ci-dessus et `CLAUDE.md`.
6. `LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]"` (Bash, depuis `back_medconnect`) sur ces 11 fichiers : aucune occurrence (code de sortie 1).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
