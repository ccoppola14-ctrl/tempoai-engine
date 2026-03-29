interface WeekComparison {
    week: number;
    before_avg: number;
    after_avg: number;
    lift_pct: number;
}
interface BestDay {
    date: string;
    revenue: number;
    order_count: number;
}
interface BeforeAfterResult {
    location_id: string;
    location_name: string;
    install_date: string;
    days_before: number;
    days_after: number;
    revenue_before: number;
    revenue_after: number;
    lift_percent: number;
    lift_dollars: number;
    weekly_comparison: WeekComparison[];
    best_day: BestDay | null;
    estimated_annual_impact: number;
    confidence: number;
}
export declare function getBeforeAfterRevenue(locationId: string): Promise<BeforeAfterResult>;
interface TopRecommendation {
    id: string;
    type: string;
    message: string;
    item_name: string;
    expected_lift: number;
    confidence: number;
    applied_at: string | null;
}
interface AttributionResult {
    location_id: string;
    location_name: string;
    recommendations_applied: number;
    recommendations_active: number;
    total_recommendations: number;
    top_performing_recommendations: TopRecommendation[];
    estimated_revenue_from_recs: number;
}
export declare function getAttribution(locationId: string): Promise<AttributionResult>;
/**
 * Quick before/after snippet for daily summary inclusion.
 */
export declare function getBeforeAfterSnippet(locationId: string): Promise<string | null>;
export {};
//# sourceMappingURL=analytics.d.ts.map