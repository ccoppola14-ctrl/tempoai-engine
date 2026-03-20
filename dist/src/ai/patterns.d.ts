import type { OrderWithWeather, PatternResult, ComboPattern } from './types';
/**
 * Detect temperature-correlated patterns.
 * Buckets: <60, 60-75, 75-85, 85+
 */
export declare function detectTemperaturePatterns(orders: OrderWithWeather[]): PatternResult[];
/**
 * Detect weather-condition patterns (rain, snow, clear, etc.)
 */
export declare function detectWeatherPatterns(orders: OrderWithWeather[]): PatternResult[];
/**
 * Detect daypart patterns (breakfast rush, lunch spike, etc.)
 */
export declare function detectDaypartPatterns(orders: OrderWithWeather[]): PatternResult[];
/**
 * Detect day-of-week patterns
 */
export declare function detectDayOfWeekPatterns(orders: OrderWithWeather[]): PatternResult[];
/**
 * Detect trending items (up or down over the last 30 days vs previous period)
 */
export declare function detectTrends(orders: OrderWithWeather[]): PatternResult[];
/**
 * Detect combo patterns — items frequently ordered together
 */
export declare function detectCombos(orderItemsByOrder: Map<string, {
    menuItemId: string;
    menuItemName: string;
}[]>): ComboPattern[];
export declare function generatePatternMessage(pattern: PatternResult): string;
//# sourceMappingURL=patterns.d.ts.map