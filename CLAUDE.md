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
- **Validation** globale : `ValidationPipe` (whitelist + forbidNonWhitelisted) — tout
  champ d'entrée doit être déclaré dans un DTO `class-validator`.
- **Langue** : messages/logs/commentaires en français.

## Variables d'environnement (lecture mixte `process.env` ET `ConfigService`)

Obligatoires : `DATABASE_URL`, `JWT_SECRET`, **`ENCRYPTION_KEY`** (hex 64 car. — lue via
`ConfigService`, app **crashe** si absente/invalide), et les **6 `R2_*`** du stockage
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_PUBLIC`,
`R2_BUCKET_PRIVATE`, `R2_PUBLIC_URL`) — toutes validées au boot (`config/env.validation.ts`).
Autres : `FRONTEND_URL`, `PORT`, `REDIS_URL`, `RESEND_*`, `NIMBA_*`, `AI_SERVICE_URL`,
`AI_URGENCE`. Les anciennes `S3_*` sont **legacy** (module dormant). Toujours mettre à
jour `.env.example` (racine) **et** l'`environment` du service `backend` dans `compose.yml`
en ajoutant une variable obligatoire.

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

Voir la liste complète dans le `CLAUDE.md` racine. En résumé, à traiter en priorité :
fallback `JWT_SECRET || 'secret'` (`chat.gateway.ts:42`), refresh token en clair dans
le JSON, **absence d'audit trail et de soft-delete** sur les données médicales, boot qui
crashe sans `ENCRYPTION_KEY`/`RESEND_API_KEY`, rate-limit auth trop permissif, logs non
structurés sur données sensibles, **aucun test** (`.spec.ts`). IDOR à confirmer sur la
création de consultation.
