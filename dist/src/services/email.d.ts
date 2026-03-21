import type { SummaryData } from './daily-summary';
export declare function sendDailySummary(to: string, summary: SummaryData, locationName: string): Promise<{
    success: boolean;
    id?: string;
    error?: string;
}>;
export declare function buildMockSummary(): SummaryData;
//# sourceMappingURL=email.d.ts.map