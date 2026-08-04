-- Stockage objets Cloudflare R2 : métadonnées des fichiers (StoredFile).
-- On ne stocke JAMAIS d'URL présignée (elle expire) — uniquement la clé R2.
-- Cf. src/storage/ (StorageModule).

-- ====== Enums ======

CREATE TYPE "StoredFileBucket" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "StoredFileStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- ====== Table StoredFile ======

CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "bucket" "StoredFileBucket" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "StoredFileStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    CONSTRAINT "StoredFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Clé R2 unique (une clé = un objet)
CREATE UNIQUE INDEX "StoredFile_key_key" ON "StoredFile"("key");
-- Fichiers d'un propriétaire (contrôle d'accès, affichage)
CREATE INDEX "StoredFile_ownerId_idx" ON "StoredFile"("ownerId");
-- Purge des uploads `pending` périmés (> 24 h)
CREATE INDEX "StoredFile_status_createdAt_idx" ON "StoredFile"("status", "createdAt");
