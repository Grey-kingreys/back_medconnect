-- Rattachement des fichiers R2 aux entités métier (avatar, logo, document analyse, ordonnance scannée).
-- Additif : 4 colonnes nullables + index unique (relation 1-1) + FK ON DELETE SET NULL.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "avatarFileId" TEXT;
ALTER TABLE "Structure" ADD COLUMN "logoFileId" TEXT;
ALTER TABLE "Ordonnance" ADD COLUMN "scanFileId" TEXT;
ALTER TABLE "ResultatAnalyse" ADD COLUMN "documentFileId" TEXT;

-- CreateIndex (unicité : un fichier ne sert qu'à une seule entité)
CREATE UNIQUE INDEX "User_avatarFileId_key" ON "User"("avatarFileId");
CREATE UNIQUE INDEX "Structure_logoFileId_key" ON "Structure"("logoFileId");
CREATE UNIQUE INDEX "Ordonnance_scanFileId_key" ON "Ordonnance"("scanFileId");
CREATE UNIQUE INDEX "ResultatAnalyse_documentFileId_key" ON "ResultatAnalyse"("documentFileId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarFileId_fkey" FOREIGN KEY ("avatarFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Structure" ADD CONSTRAINT "Structure_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ordonnance" ADD CONSTRAINT "Ordonnance_scanFileId_fkey" FOREIGN KEY ("scanFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResultatAnalyse" ADD CONSTRAINT "ResultatAnalyse_documentFileId_fkey" FOREIGN KEY ("documentFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
