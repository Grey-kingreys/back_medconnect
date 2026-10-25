-- CreateEnum
CREATE TYPE "SessionClientType" AS ENUM ('WEB', 'MOBILE');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientType" "SessionClientType" NOT NULL,
    "platform" TEXT,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "appVersion" TEXT,
    "refreshHash" TEXT NOT NULL,
    "previousRefreshHash" TEXT,
    "graceUntil" TIMESTAMP(3),
    "graceSecretEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_userId_deviceId_idx" ON "Session"("userId", "deviceId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
