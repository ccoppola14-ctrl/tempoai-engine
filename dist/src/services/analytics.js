"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBeforeAfterRevenue = getBeforeAfterRevenue;
exports.getAttribution = getAttribution;
exports.getBeforeAfterSnippet = getBeforeAfterSnippet;
const client_1 = __importDefault(require("../db/client"));
const logger_1 = require("../utils/logger");
function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}
function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}
/**
 * Compute average daily revenue for a date range.
 * Returns { avgDaily, totalDays, totalRevenue }
 */
async function avgDailyRevenue(locationId, from, to) {
    const orders = await client_1.default.order.findMany({
        where: {
            locationId,
            timestamp: { gte: startOfDay(from), lte: endOfDay(to) },
        },
        select: { total: true, timestamp: true },
    });
    if (orders.length === 0)
        return { avgDaily: 0, totalDays: 0, totalRevenue: 0 };
    // Count unique days
    const daySet = new Set(orders.map(o => o.timestamp.toISOString().split('T')[0]));
    const totalDays = daySet.size;
    const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
    return {
        avgDaily: totalDays > 0 ? totalRevenue / totalDays : 0,
        totalDays,
        totalRevenue,
    };
}
async function getBeforeAfterRevenue(locationId) {
    const location = await client_1.default.location.findUniqueOrThrow({ where: { id: locationId } });
    const installDate = location.createdAt;
    const now = new Date();
    // Determine "before" window: 30 days before install
    const beforeEnd = new Date(installDate);
    beforeEnd.setDate(beforeEnd.getDate() - 1);
    const beforeStart = new Date(beforeEnd);
    beforeStart.setDate(beforeStart.getDate() - 29);
    // Check if pre-install data exists
    const preInstallOrders = await client_1.default.order.count({
        where: {
            locationId,
            timestamp: { lt: installDate },
        },
    });
    let baselineFrom;
    let baselineTo;
    let afterFrom;
    if (preInstallOrders > 0) {
        // Use 30 days before install as baseline
        baselineFrom = beforeStart;
        baselineTo = beforeEnd;
        afterFrom = installDate;
    }
    else {
        // Use first 7 days after install as baseline
        baselineFrom = installDate;
        baselineTo = new Date(installDate);
        baselineTo.setDate(baselineTo.getDate() + 6);
        afterFrom = new Date(baselineTo);
        afterFrom.setDate(afterFrom.getDate() + 1);
    }
    const before = await avgDailyRevenue(locationId, baselineFrom, baselineTo);
    const after = afterFrom <= now
        ? await avgDailyRevenue(locationId, afterFrom, now)
        : { avgDaily: 0, totalDays: 0, totalRevenue: 0 };
    // If no baseline data at all, we can't compute a meaningful lift
    const liftPercent = before.avgDaily > 0 && after.totalDays > 0
        ? ((after.avgDaily - before.avgDaily) / before.avgDaily) * 100
        : 0;
    // Monthly dollar lift (30 days)
    const liftDollars = after.totalDays > 0
        ? (after.avgDaily - before.avgDaily) * 30
        : 0;
    // Weekly comparison: break the "after" period into weeks
    const weeklyComparison = [];
    const afterStartMs = afterFrom.getTime();
    const nowMs = now.getTime();
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const totalWeeks = Math.min(12, Math.ceil((nowMs - afterStartMs) / msPerWeek));
    for (let w = 0; w < totalWeeks; w++) {
        const weekStart = new Date(afterStartMs + w * msPerWeek);
        const weekEnd = new Date(Math.min(afterStartMs + (w + 1) * msPerWeek - 1, nowMs));
        const weekAfter = await avgDailyRevenue(locationId, weekStart, weekEnd);
        // Corresponding "before" week (from baseline)
        const bWeekStart = new Date(baselineFrom.getTime() + w * msPerWeek);
        const bWeekEnd = new Date(Math.min(baselineFrom.getTime() + (w + 1) * msPerWeek - 1, baselineTo.getTime()));
        const weekBefore = bWeekStart <= baselineTo
            ? await avgDailyRevenue(locationId, bWeekStart, bWeekEnd)
            : before; // reuse overall baseline if we run out of before weeks
        const weekLift = weekBefore.avgDaily > 0
            ? ((weekAfter.avgDaily - weekBefore.avgDaily) / weekBefore.avgDaily) * 100
            : 0;
        weeklyComparison.push({
            week: w + 1,
            before_avg: Math.round(weekBefore.avgDaily * 100) / 100,
            after_avg: Math.round(weekAfter.avgDaily * 100) / 100,
            lift_pct: Math.round(weekLift * 10) / 10,
        });
    }
    // Best day since install
    const afterOrders = await client_1.default.order.findMany({
        where: {
            locationId,
            timestamp: { gte: afterFrom },
        },
        select: { total: true, timestamp: true },
    });
    const dailyMap = new Map();
    for (const o of afterOrders) {
        const key = o.timestamp.toISOString().split('T')[0];
        const entry = dailyMap.get(key) || { revenue: 0, count: 0 };
        entry.revenue += o.total;
        entry.count += 1;
        dailyMap.set(key, entry);
    }
    let bestDay = null;
    for (const [date, data] of dailyMap.entries()) {
        if (!bestDay || data.revenue > bestDay.revenue) {
            bestDay = { date, revenue: Math.round(data.revenue * 100) / 100, order_count: data.count };
        }
    }
    // Confidence based on data volume
    const totalDataDays = before.totalDays + after.totalDays;
    let confidence = 0.3;
    if (totalDataDays >= 60)
        confidence = 0.95;
    else if (totalDataDays >= 45)
        confidence = 0.85;
    else if (totalDataDays >= 30)
        confidence = 0.75;
    else if (totalDataDays >= 14)
        confidence = 0.6;
    else if (totalDataDays >= 7)
        confidence = 0.45;
    const estimatedAnnualImpact = Math.max(0, liftDollars * 12);
    logger_1.logger.info('Analytics', `Before/After for ${location.name}: ${liftPercent.toFixed(1)}% lift`);
    return {
        location_id: locationId,
        location_name: location.name,
        install_date: installDate.toISOString().split('T')[0],
        days_before: before.totalDays,
        days_after: after.totalDays,
        revenue_before: Math.round(before.avgDaily * 100) / 100,
        revenue_after: Math.round(after.avgDaily * 100) / 100,
        lift_percent: Math.round(liftPercent * 10) / 10,
        lift_dollars: Math.round(liftDollars * 100) / 100,
        weekly_comparison: weeklyComparison,
        best_day: bestDay,
        estimated_annual_impact: Math.round(estimatedAnnualImpact * 100) / 100,
        confidence,
    };
}
async function getAttribution(locationId) {
    const location = await client_1.default.location.findUniqueOrThrow({ where: { id: locationId } });
    const allRecs = await client_1.default.recommendation.findMany({
        where: { locationId },
        include: { menuItem: true },
        orderBy: { expectedLift: 'desc' },
    });
    const applied = allRecs.filter(r => r.status === 'applied');
    const active = allRecs.filter(r => r.currentlyActive);
    // Top 5 by expected lift among applied recs
    const topPerforming = applied
        .sort((a, b) => b.expectedLift - a.expectedLift)
        .slice(0, 5)
        .map(r => ({
        id: r.id,
        type: r.type,
        message: r.message,
        item_name: r.menuItem.name,
        expected_lift: r.expectedLift,
        confidence: r.confidence,
        applied_at: r.appliedAt?.toISOString() ?? null,
    }));
    // Rough revenue attribution: for each applied rec, estimate daily lift
    // based on the item's average daily revenue * expected lift %
    let estimatedRevenue = 0;
    for (const rec of applied) {
        // Find avg daily revenue for this item in last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const itemOrders = await client_1.default.orderItem.findMany({
            where: {
                menuItemId: rec.menuItemId,
                order: {
                    locationId,
                    timestamp: { gte: thirtyDaysAgo },
                },
            },
            select: { amount: true },
        });
        const totalItemRevenue = itemOrders.reduce((s, o) => s + o.amount, 0);
        // Attribute the lift portion to the recommendation
        const liftFraction = rec.expectedLift / 100;
        const attributedRevenue = totalItemRevenue * (liftFraction / (1 + liftFraction));
        estimatedRevenue += attributedRevenue;
    }
    return {
        location_id: locationId,
        location_name: location.name,
        recommendations_applied: applied.length,
        recommendations_active: active.length,
        total_recommendations: allRecs.length,
        top_performing_recommendations: topPerforming,
        estimated_revenue_from_recs: Math.round(estimatedRevenue * 100) / 100,
    };
}
/**
 * Quick before/after snippet for daily summary inclusion.
 */
async function getBeforeAfterSnippet(locationId) {
    try {
        const result = await getBeforeAfterRevenue(locationId);
        if (result.days_after < 2)
            return null;
        const direction = result.lift_percent >= 0 ? 'up' : 'down';
        return `Since TempoAi (${result.days_after}d): avg daily revenue ${direction} ${Math.abs(result.lift_percent).toFixed(1)}% ($${result.revenue_before.toFixed(0)} -> $${result.revenue_after.toFixed(0)})`;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=analytics.js.map