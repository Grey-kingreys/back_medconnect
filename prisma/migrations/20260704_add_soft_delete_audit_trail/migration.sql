-- Phase 2.1 & 2.2: Ajouter soft-delete (deletedAt) sur modèles médicaux + créer AuditLog

-- ====== Soft-delete: Ajouter deletedAt aux modèles médicaux ======

ALTER TABLE "Consultation"
ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Ordonnance"
ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "ResultatAnalyse"
ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Vaccination"
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- ====== Audit trail: Créer la table AuditLog ======

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ip" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL
);

-- Index sur les queries audit trail courantes
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
