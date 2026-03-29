interface DaypartAnalysis {
    daypart: string;
    label: string;
    staffCount: number;
    laborHours: number;
    laborCost: number;
    revenue: number;
    laborPct: number;
    revenuePerLaborHour: number;
    overstaffed: boolean;
    understaffed: boolean;
    wastedHours: number;
    wastedCost: number;
    missedRevenue: number;
}
interface LaborAnalysis {
    locationId: string;
    periodDays: number;
    totalRevenue: number;
    totalLaborCost: number;
    totalLaborPct: number;
    totalWastedCost: number;
    totalMissedRevenue: number;
    avgDailyLaborCost: number;
    avgDailyWaste: number;
    bestDay: {
        date: string;
        laborPct: number;
    } | null;
    worstDay: {
        date: string;
        laborPct: number;
    } | null;
    byDaypart: DaypartAnalysis[];
    dailyBreakdown: Array<{
        date: string;
        dayOfWeek: string;
        revenue: number;
        laborCost: number;
        laborPct: number;
        wastedCost: number;
        dayparts: DaypartAnalysis[];
    }>;
}
/**
 * Analyze labor efficiency over a period.
 */
export declare function analyzeLaborEfficiency(locationId: string, days?: number): Promise<LaborAnalysis>;
interface DaypartRecommendation {
    daypart: string;
    label: string;
    predictedRevenue: number;
    recommendedStaff: number;
    currentScheduled: number | null;
    delta: number | null;
    estimatedSavings: number;
    reasoning: string;
}
interface StaffingRecommendation {
    date: string;
    dayOfWeek: string;
    totalPredictedRevenue: number;
    totalRecommendedStaff: number;
    dayparts: DaypartRecommendation[];
}
/**
 * Generate staffing recommendation for a specific date.
 */
export declare function generateStaffingRecommendation(locationId: string, targetDate: string): Promise<StaffingRecommendation>;
/**
 * Generate a full week staffing plan.
 */
export declare function generateWeeklyLaborPlan(locationId: string, startDate: string): Promise<{
    locationId: string;
    startDate: string;
    endDate: string;
    days: StaffingRecommendation[];
    summary: {
        totalRecommendedHours: number;
        estimatedLaborCost: number;
        targetLaborPct: number;
        totalPredictedRevenue: number;
        potentialSavings: number;
    };
}>;
/**
 * Calculate labor waste — the money shot.
 * Shows how much was wasted on overstaffing in the last N days.
 */
export declare function calculateLaborWaste(locationId: string, days?: number): Promise<{
    locationId: string;
    periodDays: number;
    totalWastedHours: number;
    totalWastedDollars: number;
    avgDailyWaste: number;
    totalMissedRevenue: number;
    byDaypart: Array<{
        daypart: string;
        label: string;
        wastedHours: number;
        wastedDollars: number;
        missedRevenue: number;
        trend: string;
    }>;
    worstDays: Array<{
        date: string;
        dayOfWeek: string;
        wastedDollars: number;
        reason: string;
    }>;
    recommendation: string;
}>;
/**
 * Seed default labor targets for a location.
 */
export declare function seedDefaultLaborTargets(locationId: string): Promise<number>;
export {};
//# sourceMappingURL=labor.d.ts.map