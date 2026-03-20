export interface Recommendation {
    id: string;
    locationId: string;
    type: 'promote' | 'demote' | 'upsell' | 'timing';
    itemId: string;
    itemName: string;
    trigger: {
        type: 'weather' | 'temperature' | 'daypart' | 'day_of_week' | 'trend';
        condition: string;
        currentlyActive: boolean;
    };
    impact: {
        expectedLift: number;
        confidence: number;
        historicalDataPoints: number;
    };
    message: string;
    channels: string[];
    createdAt: Date;
}
export interface PatternResult {
    menuItemId: string;
    menuItemName: string;
    patternType: 'weather' | 'temperature' | 'daypart' | 'day_of_week' | 'trend' | 'combo';
    triggerCondition: string;
    baselineSales: number;
    conditionSales: number;
    liftPercent: number;
    confidence: number;
    dataPoints: number;
}
export interface OrderWithWeather {
    orderId: string;
    timestamp: Date;
    menuItemId: string;
    menuItemName: string;
    quantity: number;
    amount: number;
    temperature: number | null;
    conditions: string | null;
    precipitation: number | null;
    humidity: number | null;
    windSpeed: number | null;
    hourOfDay: number;
    dayOfWeek: number;
}
export interface ItemSalesGroup {
    menuItemId: string;
    menuItemName: string;
    totalQuantity: number;
    orderCount: number;
    avgDailyQuantity: number;
}
export interface ComboPattern {
    itemA: string;
    itemAName: string;
    itemB: string;
    itemBName: string;
    coOccurrenceCount: number;
    totalOrdersWithA: number;
    totalOrdersWithB: number;
    supportPercent: number;
    confidenceAtoB: number;
    confidenceBtoA: number;
}
//# sourceMappingURL=types.d.ts.map