-- CreateTable
CREATE TABLE "StaffShift" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "employeeName" TEXT,
    "role" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "hourlyRate" DOUBLE PRECISION,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborRecommendation" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "daypart" TEXT NOT NULL,
    "currentStaff" INTEGER NOT NULL,
    "recommendedStaff" INTEGER NOT NULL,
    "overstaffed" BOOLEAN NOT NULL,
    "wastedHours" DOUBLE PRECISION NOT NULL,
    "wastedCost" DOUBLE PRECISION NOT NULL,
    "missedRevenue" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaborRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborTarget" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "daypart" TEXT NOT NULL,
    "targetLaborPct" DOUBLE PRECISION NOT NULL,
    "minStaff" INTEGER NOT NULL,
    "maxStaff" INTEGER NOT NULL,
    "revenuePerStaffHour" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LaborTarget_locationId_dayOfWeek_daypart_key" ON "LaborTarget"("locationId", "dayOfWeek", "daypart");

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborRecommendation" ADD CONSTRAINT "LaborRecommendation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborTarget" ADD CONSTRAINT "LaborTarget_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
