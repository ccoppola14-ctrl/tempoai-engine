/*
  Warnings:

  - A unique constraint covering the columns `[locationId,squareItemId]` on the table `MenuItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[locationId,cloverItemId]` on the table `MenuItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Location" ADD COLUMN "cloverApiToken" TEXT;
ALTER TABLE "Location" ADD COLUMN "cloverMerchantId" TEXT;

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN "cloverItemId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "cloverOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_locationId_squareItemId_key" ON "MenuItem"("locationId", "squareItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_locationId_cloverItemId_key" ON "MenuItem"("locationId", "cloverItemId");
