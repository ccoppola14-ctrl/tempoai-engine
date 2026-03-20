-- CreateTable
CREATE TABLE "SquareMerchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL DEFAULT '',
    "expiresAt" DATETIME,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "locations" TEXT NOT NULL DEFAULT '[]',
    "plan" TEXT NOT NULL DEFAULT 'basic',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SquareMerchant_merchantId_key" ON "SquareMerchant"("merchantId");
