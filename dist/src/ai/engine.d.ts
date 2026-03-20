/**
 * Main AI analysis entry point.
 * Queries orders + weather, detects patterns, generates recommendations.
 */
export declare function analyzeLocation(locationId: string): Promise<{
    patternsFound: number;
    recommendationsGenerated: number;
}>;
/**
 * Run analysis for all locations
 */
export declare function analyzeAllLocations(): Promise<void>;
//# sourceMappingURL=engine.d.ts.map