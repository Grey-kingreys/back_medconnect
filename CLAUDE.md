# MedConnecte — Backend (NestJS 11 + Prisma 7)

API REST + WebSocket de la plateforme de santé. Voir aussi le `CLAUDE.md` racine
(architecture globale + liste complète des problématiques).

## Stack & démarrage

- **NestJS 11**, **Prisma 7** (driver adapter `pg`), **PostgreSQL**, **Socket.io**,
  **BullMQ** (Redis), **JWT** (passport), **bcrypt**, Swagger.
- Lancé via Docker (voir racine). Local : `npm run dev` (= `nest start --watch`).
- Swagger : `/api`. Port : `3001`.

## Structure

`src/<domaine>/` = un module Nest (controller + service + dto + module). Domaines :
`auth`, `user`, `structure`, `super-admin`, `carnet-sante` (cœur métier : profil,
consultations, ordonnances, analyses, vaccinations, RDV, **urgences SOS**),
`pharmacie`, `geo`, `chat` (socket.io), `notifications`.

Services transverses dans `src/common/services/` : `prisma`, `encryption` (AES-256-GCM
des données médicales), `email` (Resend), `sms` (Nimba), `ai`. Le **stockage objets**
vit désormais dans son propre module `src/storage/` (**Cloudflare R2**, cf. plus bas) ;
l'ancien `src/common/storage.*` (S3/MinIO générique) est **dormant, à retirer**.
File asynchrone dans `src/queue/` (**BullMQ**).

## Conventions importantes (pièges)

- **Client Prisma généré** dans `../generated/prisma` (hors `node_modules`, gitignoré).
  - Import en *bare specifier* : `import { … } from 'generated/prisma/client'`.
  - Build : `prisma generate` obligatoire. Runtime prod : démarré avec
    `node -r tsconfig-paths/register dist/src/main.js` pour résoudre ce bare import
    (baseUrl `./`). **Ne pas** retirer le `tsconfig-paths/register`.
  - `prisma.config.ts` lit `DATABASE_URL` ; le `datasource` n'a pas d'`url` (driver adapter).
- **Migrations** appliquées au démarrage du conteneur par `docker-entrypoint.sh`
  (`prisma migrate deploy`). En dev, l'entrypoint **resynchronise aussi** `node_modules`
  (npm ci si `package-lock.json` a changé) et le client Prisma (si `schema.prisma` a
  changé), via comparaison de hash → après un ajout de dépendance, un simple
  `docker compose up`/`restart` suffit (plus besoin de `down -v`).
- **`npm ci` est strict** : garder `package.json` ↔ `package-lock.json` synchro
  (`npm install --package-lock-only` après édition manuelle).
- **Auth** : `AuthGuard` (`src/common/guards/auth.guard.ts`) attend `JwtService` →
  tout module exposant un contrôleur guardé doit `imports: [AuthModule]`.
  `req.user.userId` / `req.user.role` après garde. RBAC via `@Roles(...)` + `RolesGuard`.
- **Sessions (TB3)** : une connexion = une ligne `Session` (modèle Prisma) = une famille
  de refresh. Le refresh a le format `<sessionId>.<secret>` et seul le sha256 du secret
  est stocké. `SessionsService` (`src/auth/sessions.service.ts`) est le seul endroit qui
  émet, tourne ou révoque un refresh.
  - Web : refresh uniquement dans le cookie httpOnly `refresh_token`, jamais dans le JSON.
    Mobile : en-tête `X-Client: mobile`, `deviceId` et `plateforme` obligatoires à la
    connexion, refresh envoyé et reçu dans le corps (`refreshToken`, `expiresIn`,
    `sessionId`), jamais de cookie.
  - Rotation à chaque refresh, grâce de 30 s (l'ancien refresh renvoie le refresh
    courant). Réutilisation hors grâce : session révoquée et 401 `REFRESH_REUTILISE`.
  - Durées : jeton d'accès 15 min portant `sid` ; sessions glissantes de 30 jours (web,
    mobile patient) et 12 h (mobile autres rôles), Q11 révisable.
  - `POST /auth/logout` est public (refresh seul ou jeton d'accès).
  - Erreurs (TB2) : le corps `{ statusCode, message, error }` peut porter `code` (catalogue `src/common/filters/codes-erreur.ts`, toute 403 sans code reçoit PERMISSION_REFUSEE), `champs` pour VALIDATION (nom et contraintes, jamais la valeur, y compris en production) et `donnees` (liste blanche, aujourd'hui `peutRelancerA` du 409 SOS_DEJA_ACTIF). Le SOS est réservé au rôle PATIENT (403 SOS_ROLE_INTERDIT) ; le patient n'annule un rendez-vous que depuis PROGRAMME, EN_ATTENTE ou CONFIRME (409 TRANSITION_INTERDITE).
  - Révocation (TB4) : routes `GET /auth/sessions`, `DELETE /auth/sessions/:id` et
    `POST /auth/sessions/revoquer-autres`. Le changement de mot de passe déconnecte les
    autres appareils (`deconnecterAutresAppareils`, vrai par défaut) ; la réinitialisation
    et la désactivation du compte révoquent tout. `AuthGuard` contrôle chaque requête par
    `RevocationService` (état en Redis : 30 s si valide, 16 min si révoqué, repli
    PostgreSQL). L'événement socket `sessionRevoquee` `{ code, message }` précède la
    déconnexion. Purge horaire des sessions expirées ou révoquées depuis plus de 30 jours.
- **Limiteur de débit** : `UserThrottlerGuard` (garde globale) compte par utilisateur en lisant le jeton Bearer (signature vérifiée), sinon par IP ; `/auth/register`, `/auth/login`, `/auth/forgot-password` et `/auth/reset-password` restent comptés par IP. Stockage Redis (`StockageLimiteRedis`, script Lua, juste à plusieurs instances). Redis absent ou plus lent que 250 ms : les routes `@LimitePermissiveSiRedisIndisponible()` (le SOS) passent, les autres sont comptées en mémoire locale. L'email et le SMS au proche d'un SOS sont mis en file avec un délai de 2 s, sans faire échouer l'alerte.
- **Version et configuration publiques (TB5)** : module `src/configuration-publique/`. `GET /app/version` (public, `Cache-Control: public, max-age=60`) renvoie `{ success, data: { android, ios } }`, chaque plateforme `{ versionMinimale, versionRecommandee, urlTelechargement }` (URL `null` si non réglée ; recommandée jamais sous la minimale). `GET /app/config` (public, `max-age=300`) renvoie `{ success, data: { numerosUrgence: [{ code, libelle, numero }], versionsDocuments: { cgu, politiqueConfidentialite }, fonctions: { espaceSoignant, annulationSos, boutonDemo } } }`, sans donnée sensible. Les deux routes échappent au limiteur (`@SkipThrottle`). `VersionMinimaleGuard` (garde globale, avant le limiteur) répond 426 `VERSION_OBSOLETE` à un client qui envoie `X-Client: mobile`, `X-Plateforme` (`android` ou `ios`) et une `X-App-Version` inférieure à la minimale de sa plateforme, sur toute route sauf `/app/*` ; un en-tête absent ou illisible laisse passer, le web n'est jamais affecté. Versions lues au format `1`, `1.4` ou `1.4.2` (suffixe `-beta` ignoré). Le numéro d'urgence a une source unique, `src/config/numeros-urgence.ts`, lue aussi par le repli de `AiService`. `X-Api-Version` est réservé (version 1 implicite), non lu.
- **Validation** globale : `ValidationPipe` (whitelist + forbidNonWhitelisted) — tout
  champ d'entrée doit être déclaré dans un DTO `class-validator`.
- **Langue** : messages/logs/commentaires en français.

## Hooks git (configuration locale à rejouer après chaque clone)

`core.hooksPath` n'est pas versionné. Depuis la racine du monorepo : `./setup-dev.sh`
(voir le `CLAUDE.md` racine). Si ce dépôt est cloné seul :

```bash
git config core.hooksPath "$(git rev-parse --show-toplevel)/.githooks"
npm ci && npx prisma generate
```

Les gates (`.githooks/gate-lib.sh`) tournent dans le conteneur `backend` via
`docker compose exec` s'il est démarré, sinon en local : pre-commit = `tsc --noEmit` sur
tout le projet + `eslint` sur les **seuls fichiers indexés** (la dette existante ne bloque
pas, mais tout fichier touché doit être propre) ; pre-push = `npm test`. **Consigne pour Claude** : si `git config core.hooksPath`
est vide, le signaler et proposer la commande ci-dessus avant tout commit.

## Variables d'environnement (lecture mixte `process.env` ET `ConfigService`)

Obligatoires : `DATABASE_URL`, `JWT_SECRET`, **`ENCRYPTION_KEY`** (hex 64 car. — lue via
`ConfigService`, app **crashe** si absente/invalide), et les **6 `R2_*`** du stockage
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_PUBLIC`,
`R2_BUCKET_PRIVATE`, `R2_PUBLIC_URL`) — toutes validées au boot (`config/env.validation.ts`).
Autres : `FRONTEND_URL`, `PORT`, `REDIS_URL`, `RESEND_*`, `NIMBA_*`, `AI_SERVICE_URL`,
`AI_URGENCE`, `SWAGGER_ENABLED` (optionnelle, `true` pour ouvrir Swagger en production,
fermé par défaut), `AI_SHARED_SECRET` (optionnelle, 32 caractères min., secret partagé
avec les services IA, envoyé dans l'en-tête `X-MedConnecte-Secret`), `DEMO_MODE`
(optionnelle, `false` par défaut, seule la valeur `true` active le mode démo, toute
valeur autre que `true` ou `false` est refusée au démarrage), `DEMO_RESET` (optionnelle,
`false` par défaut, même analyse stricte que `DEMO_MODE` : purge puis recrée les données
démo au démarrage, sans effet si `DEMO_MODE` est inactif), `SESSIONS_MULTI_APPAREILS` (optionnelle, `true`
par défaut, seules `true` ou `false` acceptées au démarrage ; `false` revient à l'ancien
refresh unique par utilisateur, cookie seul, en-tête mobile ignoré ; retour arrière sans
redéploiement). Application mobile (TB5, toutes optionnelles, refusées au démarrage si malformées) : `APP_VERSION_MINIMALE_ANDROID`, `APP_VERSION_RECOMMANDEE_ANDROID`, `APP_VERSION_MINIMALE_IOS`, `APP_VERSION_RECOMMANDEE_IOS` (format `X.Y.Z`, défaut `0.0.0`), `APP_URL_TELECHARGEMENT_ANDROID`, `APP_URL_TELECHARGEMENT_IOS` (URL, sans défaut), `NUMERO_URGENCE_MEDICALE` (défaut `15`), `VERSION_CGU`, `VERSION_POLITIQUE_CONFIDENTIALITE` (défaut `1.0`), `FONCTION_ESPACE_SOIGNANT`, `FONCTION_ANNULATION_SOS`, `FONCTION_BOUTON_DEMO` (`true` ou `false`, défaut `false`). Les anciennes `S3_*` sont **legacy** (module dormant). Toujours mettre à
jour `.env.example` (racine) **et** l'`environment` du service `backend` dans `compose.yml`
en ajoutant une variable obligatoire.

## Mode démo (`src/demo/`)

Actif seulement si `DEMO_MODE=true` (avertissement au démarrage, renforcé en production).
`DemoSeeder` crée au boot, une seule fois et dans une transaction, un jeu de données
guinéen fictif (5 structures, 20 comptes, carnets chiffrés via `EncryptionService`,
stocks, messagerie, SOS, notifications), puis rattache les rôles RBAC. Le compte vitrine
patient (Aminata Diallo) porte un dossier riche sur 3 ans (9 consultations dans 3
structures, ordonnances sans pénicilline car elle y est allergique, analyses, vaccins,
rendez-vous, messagerie). Comme le seed ne crée rien si des données démo existent déjà,
`DEMO_RESET=true` (avec `DEMO_MODE=true`) supprime au démarrage toutes les données démo
(comptes et structures en `@demo.medconnecte.gn`, leurs journaux d'audit, et tout ce qui
leur est rattaché par cascade) puis recrée le jeu complet, dans une seule transaction ;
le catalogue de médicaments, partagé, n'est jamais supprimé. Purge physique volontaire
(pas de soft-delete sur ces données fictives), journalisée « Données de démonstration
supprimées puis recréées ». À remettre à `false` ensuite, sinon chaque redémarrage
recrée les données (nouveaux identifiants, sessions démo invalidées). `DEMO_RESET=true`
sans mode démo : avertissement, rien n'est supprimé. Un compte démo
se reconnaît à son email en `@demo.medconnecte.gn` ; son mot de passe est aléatoire et
inconnu, et son mot de passe comme son email ne peuvent pas être modifiés. Aucun email ni SMS réel ne part depuis ou vers un compte démo : `EmailService` ignore toute adresse en `@demo.medconnecte.gn`, le SOS d'un patient démo ne prévient pas son proche (le patient en est informé), et l'OTP de partage d'un patient démo n'envoie pas de SMS mais renvoie le code à l'accueil (`codeDemo`, seulement si le mode démo est actif). Routes
publiques : `GET /auth/demo/comptes` et `POST /auth/demo/connexion` (`{ userId }`, même
réponse et même cookie que `POST /auth/login`, 403 pour tout compte non démo). Mode
inactif : 404 sur ces deux routes et aucune donnée créée. Ne jamais activer sur une
instance qui contient de vraies données de santé.

## Capacités Phase 2 (implémentées)

- **Stockage Cloudflare R2** — module isolé `src/storage/` (**`StorageModule`**, global).
  `S3Client` instancié une seule fois (provider `R2_CLIENT`). Deux buckets : **public**
  (avatars/logos, servis via `R2_PUBLIC_URL`) et **privé** (documents médicaux, URLs
  présignées courtes uniquement). `StorageService` : `upload`, `getSignedUploadUrl`
  (PUT, 600 s), `getSignedReadUrl` (GET privé, 300 s), `getPublicUrl`, `delete`, `exists`,
  et la persistance (`createUploadTicket`/`confirmUpload`/`purgeStalePending`). Clés en
  `{prefix}/{YYYY}/{MM}/{uuid}.{ext}` (jamais le nom original). Modèle **`StoredFile`**
  (`key` unique, `bucket`, `status pending→confirmed`, `ownerId`). Whitelist MIME +
  tailles (5 Mo images / 20 Mo docs) **côté serveur**. Endpoints : `POST /storage/presign`,
  `POST /storage/confirm`, `GET /storage/:id/read-url` (contrôle d'accès `FileAccessService`
  + audit sur bucket privé), `DELETE /storage/:id`.
  - ⚠️ **Legacy** : l'ancien `src/common/storage.*` (S3/MinIO, endpoints `/storage/upload-url`
    et `/storage/download-url`) est **encore branché mais dormant** — à retirer une fois
    les usages migrés (aucun consommateur métier/front à ce jour).
- **File BullMQ** — `QueueService` (global) : `enqueueSms`, `enqueueSos`,
  `enqueueWelcomeEmail`, `enqueueEmergencyEmail`. Processor : `src/queue/notifications.processor.ts`.
  **Le SOS (`carnet-sante.createUrgence`) envoie email + SMS via la file** (réponse
  immédiate, 3 retries + backoff). Toggle diag : `QUEUE_SELFTEST=1`.
  - Processors **in-process** pour l'instant ; externalisables dans un service `worker`
    dédié plus tard (les jobs sont déjà découplés via Redis).
- **Socket.io ↔ Redis** — `RedisIoAdapter` (`src/common/redis-io.adapter.ts`), branché
  dans `main.ts`. Prérequis au scaling : `BACKEND_REPLICAS > 1` **exige** cet adapter.

## ⚠️ Dette/risques spécifiques backend

Référence à jour : `BACKLOG-PRIORISE.md` à la racine du monorepo. Les points P0 à P3 ont
été intégrés le 2026-10-07 (branche `integration/2026-10`, runs archivés dans
`docs/plans/archive/`). Déjà corrigé : secrets JWT sans repli, refresh token en cookie
seul, audit trail et soft-delete, contrôle d'accès au carnet et au chat, statut de RDV
validé, logs sans données de santé, Swagger fermé en production. Reste notamment :
- **Typage** : `tsconfig` non strict (`noImplicitAny: false`), parqué jusqu'à la fin de
  l'intégration (passage progressif recommandé, voir décision D03 du run p3-fond).
- **Lint** : environ 2 000 erreurs historiques (surtout formatage), et plusieurs fichiers
  avec un `eslint-disable` global marqué « Dette préexistante, backlog points 21 et 22 ».
- **Tests** : 148 tests sur les domaines sensibles (auth, carnet, chat, audit, SOS,
  pharmacie, stockage, chiffrement) ; pas de tests e2e.
- **Mobile** : sessions par appareil livrées (TB3). La colonne
  `User.refreshToken` est conservée une version pour le retour arrière, à supprimer
  ensuite avec `AuthService.generateTokens` et `generateToken`.

<!-- orchestrator:start v2 -->
## Règles du projet et orchestrateur

Audience: mixte par surface ; API REST, WebSocket et Swagger = dev (consommés par front_medconnect) ; messages d'erreur renvoyés au front et affichés, emails, SMS et notifications = non-dev (patients, médecins, pharmaciens, agents d'accueil, administrateurs de structure)
Maturité: avancé (anti-slop préventif + passe curative disponible)
Langues: interface, messages d'erreur, emails, SMS et logs en français ; commentaires de code en français, identifiants existants conservés tels quels (pas de renommage) ; docs, plans et commits en français
Gate: tsc --noEmit (projet) ; eslint (fichiers indexés) (pre-commit) ; npm test (pre-push) ; via docker compose exec backend si démarré, sinon local (.githooks/gate-lib.sh)

Règles contraignantes, détail dans docs/ORCHESTRATOR.md :
- **Audience** (prioritaire) : avant toute UI, tout texte visible ou message d'erreur, appliquer le régime de l'audience ci-dessus (section 1). Non-dev : vocabulaire utilisateur, erreurs humaines et actionnables, empty states qui guident, preuves exigées.
- **Code** : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Jamais de refactor non demandé.
- **Visuel** : tokens, échelles restreintes, pas de « boîte dans une boîte », WCAG AA, tous les thèmes.
- **Typographie** : jamais de tiret cadratin ni demi-cadratin (hook actif).
- **Langues** : commentaires de code en français ; identifiants existants conservés tels quels (pas de renommage).
- **Multi-tâches** : lire docs/plans/ACTIVE.md d'abord, puis seulement le fichier de la prochaine tâche. Tâche unique ou petite : travailler directement.
- **Commits** : pendant un run, un commit par tâche validée sur `orch/<nom>` ; hors run, jamais sans demande.
<!-- orchestrator:end -->
