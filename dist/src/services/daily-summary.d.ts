export interface TopItem {
    name: string;
    quantity: number;
    revenue: number;
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
}
export declare function generateDailySummary(locationId: string, date?: Date): Promise<SummaryData>;
export declare function generateAllDailySummaries(date?: Date): Promise<void>;
//# sourceMappingURL=daily-summary.d.ts.map