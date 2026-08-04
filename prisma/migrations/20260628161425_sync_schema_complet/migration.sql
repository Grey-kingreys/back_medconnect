/*
  Warnings:

  - You are about to drop the column `contactUrgence` on the `ProfilMedical` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PROGRAMME', 'CONFIRME', 'ANNULE', 'TERMINE');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('PRIVE', 'STRUCTURE');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXTE', 'IMAGE', 'FICHIER', 'SOS');

-- CreateEnum
CREATE TYPE "UrgenceStatus" AS ENUM ('LANCE', 'PRIS_EN_CHARGE', 'TERMINE', 'ANNULE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SOS_DECLENCHE', 'SOS_PRIS_EN_CHARGE', 'SOS_ALERTE', 'RENDEZ_VOUS', 'MESSAGE', 'SYSTEME', 'CATALOGUE_MODIF', 'STOCK_ALERTE', 'EXPIRATION_ALERTE', 'NOUVELLE_ORDONNANCE');

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "medecinId" TEXT;

-- AlterTable
ALTER TABLE "Ordonnance" ADD COLUMN     "medecinId" TEXT;

-- AlterTable
ALTER TABLE "ProfilMedical" DROP COLUMN "contactUrgence",
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactNom" TEXT,
ADD COLUMN     "contactTelephone" TEXT,
ALTER COLUMN "allergies" DROP NOT NULL,
ALTER COLUMN "allergies" DROP DEFAULT,
ALTER COLUMN "allergies" SET DATA TYPE TEXT,
ALTER COLUMN "pathologies" DROP NOT NULL,
ALTER COLUMN "pathologies" DROP DEFAULT,
ALTER COLUMN "pathologies" SET DATA TYPE TEXT,
ALTER COLUMN "traitements" DROP NOT NULL,
ALTER COLUMN "traitements" DROP DEFAULT,
ALTER COLUMN "traitements" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "ResultatAnalyse" ADD COLUMN     "medecinId" TEXT;

-- AlterTable
ALTER TABLE "Structure" ADD COLUMN     "estOuvertManuel" BOOLEAN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dateNaissance" TIMESTAMP(3),
ADD COLUMN     "medecinTraitantId" TEXT,
ADD COLUMN     "poids" DOUBLE PRECISION,
ADD COLUMN     "specialite" TEXT,
ADD COLUMN     "taille" INTEGER;

-- AlterTable
ALTER TABLE "Vaccination" ADD COLUMN     "medecinId" TEXT;

-- CreateTable
CREATE TABLE "RendezVous" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "medecinId" TEXT NOT NULL,
    "structureId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "motif" TEXT NOT NULL,
    "notes" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PROGRAMME',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RendezVous_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutorisationStructure" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutorisationStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "patientId" TEXT,
    "medecinId" TEXT,
    "structureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isLocation" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "lu" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Urgence" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "message" TEXT,
    "status" "UrgenceStatus" NOT NULL DEFAULT 'LANCE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Urgence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "titre" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "lu" BOOLEAN NOT NULL DEFAULT false,
    "lien" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutorisationStructure_patientId_structureId_key" ON "AutorisationStructure"("patientId", "structureId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_medecinTraitantId_fkey" FOREIGN KEY ("medecinTraitantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ordonnance" ADD CONSTRAINT "Ordonnance_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultatAnalyse" ADD CONSTRAINT "ResultatAnalyse_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vaccination" ADD CONSTRAINT "Vaccination_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendezVous" ADD CONSTRAINT "RendezVous_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendezVous" ADD CONSTRAINT "RendezVous_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendezVous" ADD CONSTRAINT "RendezVous_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutorisationStructure" ADD CONSTRAINT "AutorisationStructure_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutorisationStructure" ADD CONSTRAINT "AutorisationStructure_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Urgence" ADD CONSTRAINT "Urgence_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
