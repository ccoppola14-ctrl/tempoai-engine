export interface WeeklyReportData {
    merchantName: string;
    locationName: string;
    weekOf: string;
    revenueThisWeek: number;
    revenueLastWeek: number;
    revenueChange: number;
    topItems: Array<{
        name: string;
        unitsSold: number;
        revenue: number;
        trend: 'up' | 'down' | 'flat';
    }>;
    recommendationsApplied: number;
    recommendationsTotal: number;
    estimatedLift: number;
    weatherSummary: string;
    weatherDays: Array<{
        day: string;
        condition: string;
        avgTemp: number;
        revenueImpact: number;
    }>;
}
export declare function generateWeeklyReportHtml(data: WeeklyReportData): string;
export declare function generateWeeklyReportSubject(data: WeeklyReportData): string;
//# sourceMappingURL=weekly-report.d.ts.map