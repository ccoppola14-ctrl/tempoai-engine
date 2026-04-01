export interface TopItem {
    name: string;
    quantity: number;
    revenue: number;
}
export interface PromoRecommendation {
    itemName: string;
    message: string;
    expectedLift: number;
    triggerType: string;
    triggerCondition: string;
    promoSuggestion: string;
}
export interface UpsellTip {
    baseItem: string;
    suggestItem: string;
    reason: string;
}
export interface StaffingNote {
    message: string;
    action: string;
}
export interface SummaryData {
    locationId: string;
    locationName: string;
    date: string;
    totalSales: number;
    orderCount: number;
    topItems: TopItem[];
    laborCostPct: number | null;
    prevWeekSales: number | null;
    prevWeekOrders: number | null;
    changePercent: number | null;
    weatherNote: string | null;
    weatherImpactNote: string | null;
    topRecommendation: string | null;
    beforeAfterSnippet: string | null;
    upcomingEvents: string | null;
    promoRecommendations: PromoRecommendation[];
    upsellTip: UpsellTip | null;
    staffingNote: StaffingNote | null;
    underperformers: Array<{
        name: string;
        soldYesterday: number;
        avgSold: number;
    }>;
}
export declare function generateDailySummary(locationId: string, date?: Date): Promise<SummaryData>;
export declare function generateAllDailySummaries(date?: Date): Promise<void>;
//# sourceMappingURL=daily-summary.d.ts.map