import type { Recommendation, PatternResult, ComboPattern } from './types';
export declare function generateRecommendations(locationId: string, patterns: PatternResult[], currentConditions?: {
    temperature?: number;
    weather?: string;
    daypart?: string;
    dayOfWeek?: number;
}): Recommendation[];
export declare function generateComboRecommendations(locationId: string, combos: ComboPattern[]): Recommendation[];
//# sourceMappingURL=recommendations.d.ts.map