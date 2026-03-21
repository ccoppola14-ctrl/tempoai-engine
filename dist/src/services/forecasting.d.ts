interface DayForecast {
    date: string;
    predictedSales: number;
    predictedOrders: number;
    confidence: number;
    factors: {
        dayOfWeek: {
            name: string;
            avgSales: number;
            avgOrders: number;
        };
        weather: {
            condition: string;
            temperature: number;
            impact: number;
        } | null;
        trend: {
            direction: string;
            percentChange: number;
        };
    };
    staffing: {
        recommended: number;
        reason: string;
    };
}
/**
 * Generate a 7-day sales forecast for a location.
 */
export declare function generateForecast(locationId: string): Promise<DayForecast[]>;
export {};
//# sourceMappingURL=forecasting.d.ts.map