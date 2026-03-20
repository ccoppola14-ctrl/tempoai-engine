-- AlterTable
ALTER TABLE "CloverMerchant" ADD COLUMN "billingPlan" TEXT;
ALTER TABLE "CloverMerchant" ADD COLUMN "billingStatus" TEXT;
ALTER TABLE "CloverMerchant" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "CloverMerchant" ADD COLUMN "stripeSubscriptionId" TEXT;

-- AlterTable
ALTER TABLE "SquareMerchant" ADD COLUMN "billingPlan" TEXT;
ALTER TABLE "SquareMerchant" ADD COLUMN "billingStatus" TEXT;
ALTER TABLE "SquareMerchant" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "SquareMerchant" ADD COLUMN "stripeSubscriptionId" TEXT;
