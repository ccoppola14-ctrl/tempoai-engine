"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateAlerts = evaluateAlerts;
exports.evaluateAllAlerts = evaluateAllAlerts;
exports.getActiveAlerts = getActiveAlerts;
exports.acknowledgeAlert = acknowledgeAlert;
const client_1 = __importDefault(require("../db/client"));
const logger_1 = require("../utils/logger");
const LABOR_COST_THRESHOLD = 0.35; // 35%
const SALES_DROP_THRESHOLD = 0.15; // 15% below last week
const LOW_MARGIN_THRESHOLD = 0.20; // 20% margin
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
async function createAlertIfNew(input) {
    // Avoid duplicating alerts of the same type for today
    const today = startOfDay(new Date());
    const existing = await client_1.default.alert.findFirst({
        where: {
            locationId: input.locationId,
            type: input.type,
            createdAt: { gte: today },
            acknowledgedAt: null,
        },
    });
    if (existing)
        return;
    await client_1.default.alert.create({
        data: {
            locationId: input.locationId,
            type: input.type,
            severity: input.severity,
            title: input.title,
            message: input.message,
            data: JSON.stringify(input.data),
        },
    });
    logger_1.logger.info('Alerts', `Created ${input.type} alert for location ${input.locationId}: ${input.title}`);
}
/**
 * Check if labor cost exceeds 35% for the day.
 * Labor data isn't tracked yet, so this is a placeholder that checks
 * if a laborCostPct was set on today's DailySummary.
 */
async function checkLaborCostAlert(locationId) {
    const today = startOfDay(new Date()).toISOString().split('T')[0];
    const summary = await client_1.default.dailySummary.findUnique({
        where: { locationId_date: { locationId, date: today } },
    });
    if (summary?.laborCostPct && summary.laborCostPct > LABOR_COST_THRESHOLD * 100) {
        await createAlertIfNew({
            locationId,
            type: 'labor_cost',
            severity: 'warning',
            title: 'High Labor Cost',
            message: `Labor cost is ${summary.laborCostPct.toFixed(1)}% today, exceeding the ${LABOR_COST_THRESHOLD * 100}% threshold.`,
            data: { laborCostPct: summary.laborCostPct, threshold: LABOR_COST_THRESHOLD * 100 },
        });
    }
}
/**
 * Check if daily sales are >15% below same day last week.
 */
async function checkSalesAnomalyAlert(locationId) {
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    const todayOrders = await client_1.default.order.findMany({
        where: { locationId, timestamp: { gte: dayStart, lte: dayEnd } },
    });
    const todaySales = todayOrders.reduce((sum, o) => sum + o.total, 0);
    // Same day last week
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lwStart = startOfDay(lastWeek);
    const lwEnd = endOfDay(lastWeek);
    const lastWeekOrders = await client_1.default.order.findMany({
        where: { locationId, timestamp: { gte: lwStart, lte: lwEnd } },
    });
    const lastWeekSales = lastWeekOrders.reduce((sum, o) => sum + o.total, 0);
    if (lastWeekSales > 0) {
        const dropPercent = (lastWeekSales - todaySales) / lastWeekSales;
        if (dropPercent > SALES_DROP_THRESHOLD) {
            await createAlertIfNew({
                locationId,
                type: 'sales_anomaly',
                severity: 'critical',
                title: 'Sales Below Expected',
                message: `Today's sales ($${todaySales.toFixed(2)}) are ${(dropPercent * 100).toFixed(1)}% below last ${getDayName(lastWeek)} ($${lastWeekSales.toFixed(2)}).`,
                data: { todaySales, lastWeekSales, dropPercent: Math.round(dropPercent * 1000) / 10 },
            });
        }
    }
}
function getDayName(date) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
}
/**
 * Flag menu items with estimated margin below 20%.
 * Since we don't have COGS data, we approximate by checking items whose
 * average order amount is very close to or below a rough cost estimate.
 * For now, this flags items priced below $3.00 as potentially low-margin.
 */
async function checkLowMarginItemsAlert(locationId) {
    const lowPriceItems = await client_1.default.menuItem.findMany({
        where: {
            locationId,
            active: true,
            price: { lt: 3.0 },
        },
    });
    for (const item of lowPriceItems) {
        // Check if item had sales today
        const today = startOfDay(new Date());
        const orderItems = await client_1.default.orderItem.findMany({
            where: {
                menuItemId: item.id,
                order: { timestamp: { gte: today } },
            },
        });
        if (orderItems.length > 0) {
            await createAlertIfNew({
                locationId,
                type: 'low_margin_item',
                severity: 'info',
                title: `Low-Margin Item: ${item.name}`,
                message: `${item.name} is priced at $${item.price.toFixed(2)} and sold ${orderItems.length} times today. Consider reviewing its margin.`,
                data: { menuItemId: item.id, itemName: item.name, price: item.price, todaySales: orderItems.length },
            });
        }
    }
}
/**
 * Predict if tomorrow will be a slow day based on weather forecast + historical patterns.
 * Uses weather data and compares to historical sales on similar weather days.
 */
async function checkSlowDayPrediction(locationId) {
    // Get latest weather snapshot for conditions
    const latestWeather = await client_1.default.weatherSnapshot.findFirst({
        where: { locationId },
        orderBy: { timestamp: 'desc' },
    });
    if (!latestWeather)
        return;
    // Check if conditions suggest a slow day (rain, snow, extreme temps)
    const badConditions = ['rain', 'snow', 'thunderstorm', 'sleet', 'freezing'];
    const isBadWeather = badConditions.some(c => latestWeather.conditions.toLowerCase().includes(c));
    const isExtremeTemp = latestWeather.temperature < 20 || latestWeather.temperature > 100;
    if (!isBadWeather && !isExtremeTemp)
        return;
    // Check historical: what did sales look like on similar weather days?
    const similarWeatherSnapshots = await client_1.default.weatherSnapshot.findMany({
        where: {
            locationId,
            conditions: latestWeather.conditions,
        },
        orderBy: { timestamp: 'desc' },
        take: 30,
    });
    if (similarWeatherSnapshots.length < 3)
        return;
    // Get average sales on those days vs overall average
    const weatherDates = [...new Set(similarWeatherSnapshots.map(s => startOfDay(s.timestamp).toISOString()))].slice(0, 14);
    let weatherDaySales = 0;
    let weatherDayCount = 0;
    for (const dateStr of weatherDates) {
        const dayStart = new Date(dateStr);
        const dayEnd = endOfDay(dayStart);
        const orders = await client_1.default.order.findMany({
            where: { locationId, timestamp: { gte: dayStart, lte: dayEnd } },
        });
        if (orders.length > 0) {
            weatherDaySales += orders.reduce((sum, o) => sum + o.total, 0);
            weatherDayCount++;
        }
    }
    if (weatherDayCount === 0)
        return;
    // Get overall daily average from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentOrders = await client_1.default.order.findMany({
        where: { locationId, timestamp: { gte: thirtyDaysAgo } },
    });
    const totalRecentSales = recentOrders.reduce((sum, o) => sum + o.total, 0);
    // Rough estimate of days with sales
    const uniqueDays = new Set(recentOrders.map(o => startOfDay(o.timestamp).toISOString())).size;
    if (uniqueDays === 0)
        return;
    const avgDailySales = totalRecentSales / uniqueDays;
    const avgWeatherDaySales = weatherDaySales / weatherDayCount;
    if (avgDailySales > 0 && avgWeatherDaySales < avgDailySales * 0.85) {
        const expectedDrop = ((avgDailySales - avgWeatherDaySales) / avgDailySales) * 100;
        await createAlertIfNew({
            locationId,
            type: 'slow_day_prediction',
            severity: 'warning',
            title: 'Slow Day Predicted Tomorrow',
            message: `Weather forecast (${latestWeather.conditions}, ${Math.round(latestWeather.temperature)}°F) historically correlates with ${expectedDrop.toFixed(0)}% lower sales. Consider adjusting staffing.`,
            data: {
                conditions: latestWeather.conditions,
                temperature: latestWeather.temperature,
                avgDailySales: Math.round(avgDailySales * 100) / 100,
                avgWeatherDaySales: Math.round(avgWeatherDaySales * 100) / 100,
                expectedDropPercent: Math.round(expectedDrop * 10) / 10,
            },
        });
    }
}
/**
 * Run all alert checks for a location.
 */
async function evaluateAlerts(locationId) {
    logger_1.logger.info('Alerts', `Evaluating alerts for location ${locationId}`);
    try {
        await checkLaborCostAlert(locationId);
        await checkSalesAnomalyAlert(locationId);
        await checkLowMarginItemsAlert(locationId);
        await checkSlowDayPrediction(locationId);
    }
    catch (err) {
        logger_1.logger.error('Alerts', `Alert evaluation failed for ${locationId}`, err);
    }
}
/**
 * Run alert checks for all active locations.
 */
async function evaluateAllAlerts() {
    const locations = await client_1.default.location.findMany();
    logger_1.logger.info('Alerts', `Evaluating alerts for ${locations.length} locations`);
    for (const location of locations) {
        await evaluateAlerts(location.id);
    }
    logger_1.logger.info('Alerts', 'All alert evaluations complete');
}
/**
 * Get active (unacknowledged) alerts for a location.
 */
async function getActiveAlerts(locationId) {
    return client_1.default.alert.findMany({
        where: {
            locationId,
            acknowledgedAt: null,
        },
        orderBy: { createdAt: 'desc' },
    });
}
/**
 * Acknowledge (dismiss) an alert.
 */
async function acknowledgeAlert(alertId) {
    return client_1.default.alert.update({
        where: { id: alertId },
        data: { acknowledgedAt: new Date() },
    });
}
//# sourceMappingURL=alerts.js.map