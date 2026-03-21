"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateForecast = generateForecast;
const client_1 = __importDefault(require("../db/client"));
const logger_1 = require("../utils/logger");
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/**
 * Fetch 7-day weather forecast from wttr.in for a city.
 */
async function fetchWeatherForecast(city) {
    try {
        const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
        const resp = await fetch(url);
        if (!resp.ok)
            return [];
        const data = (await resp.json());
        if (!data.weather)
            return [];
        return data.weather.map((day) => ({
            date: day.date ?? '',
            condition: day.hourly?.[4]?.weatherDesc?.[0]?.value ?? 'Unknown',
            temperature: parseFloat(day.avgtempF ?? '70'),
        }));
    }
    catch (err) {
        logger_1.logger.warn('Forecast', `Weather fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
    }
}
/**
 * Estimate weather impact on sales based on historical weather-sales correlation.
 */
function estimateWeatherImpact(condition, temperature) {
    const lowerCond = condition.toLowerCase();
    let impact = 0;
    // Bad weather reduces sales
    if (lowerCond.includes('rain') || lowerCond.includes('drizzle'))
        impact -= 0.10;
    if (lowerCond.includes('snow') || lowerCond.includes('blizzard'))
        impact -= 0.20;
    if (lowerCond.includes('thunder') || lowerCond.includes('storm'))
        impact -= 0.15;
    // Good weather boosts sales
    if (lowerCond.includes('sunny') || lowerCond.includes('clear'))
        impact += 0.05;
    // Extreme temperatures reduce sales
    if (temperature < 25)
        impact -= 0.15;
    else if (temperature < 40)
        impact -= 0.05;
    else if (temperature > 95)
        impact -= 0.10;
    return impact;
}
/**
 * Calculate staffing recommendation based on predicted sales.
 */
function getStaffingRecommendation(predictedSales, dayName) {
    // Base: 1 staff per $300 in sales, minimum 2
    const base = Math.max(2, Math.ceil(predictedSales / 300));
    const isWeekend = dayName === 'Friday' || dayName === 'Saturday' || dayName === 'Sunday';
    const recommended = isWeekend ? base + 1 : base;
    let reason = `Based on $${Math.round(predictedSales)} predicted sales`;
    if (isWeekend)
        reason += ` (weekend +1 staff)`;
    if (predictedSales < 500)
        reason += '. Light day — consider reduced hours.';
    else if (predictedSales > 2000)
        reason += '. Heavy day — consider extra prep staff.';
    return { recommended, reason };
}
/**
 * Generate a 7-day sales forecast for a location.
 */
async function generateForecast(locationId) {
    logger_1.logger.info('Forecast', `Generating forecast for location ${locationId}`);
    // Gather historical data (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const orders = await client_1.default.order.findMany({
        where: { locationId, timestamp: { gte: ninetyDaysAgo } },
        orderBy: { timestamp: 'asc' },
    });
    // Group orders by day-of-week
    const dayOfWeekStats = {};
    for (let d = 0; d < 7; d++) {
        dayOfWeekStats[d] = { totalSales: 0, totalOrders: 0, count: 0 };
    }
    // Also track daily totals for trend calculation
    const dailyTotals = {};
    for (const order of orders) {
        const date = new Date(order.timestamp);
        const dow = date.getDay();
        dayOfWeekStats[dow].totalSales += order.total;
        dayOfWeekStats[dow].totalOrders += 1;
        dayOfWeekStats[dow].count += 1;
        const dateKey = date.toISOString().split('T')[0];
        if (!dailyTotals[dateKey])
            dailyTotals[dateKey] = { sales: 0, orders: 0 };
        dailyTotals[dateKey].sales += order.total;
        dailyTotals[dateKey].orders += 1;
    }
    // Calculate trend: compare last 2 weeks vs previous 2 weeks
    const sortedDates = Object.keys(dailyTotals).sort();
    let recentAvg = 0;
    let olderAvg = 0;
    if (sortedDates.length >= 14) {
        const recent14 = sortedDates.slice(-14);
        const older14 = sortedDates.slice(-28, -14);
        recentAvg = recent14.reduce((sum, d) => sum + dailyTotals[d].sales, 0) / recent14.length;
        olderAvg = older14.length > 0
            ? older14.reduce((sum, d) => sum + dailyTotals[d].sales, 0) / older14.length
            : recentAvg;
    }
    else if (sortedDates.length > 0) {
        const half = Math.floor(sortedDates.length / 2);
        const recentHalf = sortedDates.slice(half);
        const olderHalf = sortedDates.slice(0, half);
        recentAvg = recentHalf.reduce((sum, d) => sum + dailyTotals[d].sales, 0) / recentHalf.length;
        olderAvg = olderHalf.length > 0
            ? olderHalf.reduce((sum, d) => sum + dailyTotals[d].sales, 0) / olderHalf.length
            : recentAvg;
    }
    const trendPercent = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
    const trendMultiplier = 1 + (trendPercent / 100) * 0.5; // Dampen the trend effect
    // Fetch weather forecast
    const location = await client_1.default.location.findUnique({ where: { id: locationId } });
    const city = location?.address?.split(',')[0]?.trim() ?? '';
    const weatherForecast = city ? await fetchWeatherForecast(city) : [];
    // Generate predictions for next 7 days
    const forecasts = [];
    const today = new Date();
    for (let i = 1; i <= 7; i++) {
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + i);
        const dow = targetDate.getDay();
        const dateStr = targetDate.toISOString().split('T')[0];
        const dayName = DAY_NAMES[dow];
        const stats = dayOfWeekStats[dow];
        const hasData = stats.count > 0;
        // Base prediction from day-of-week average
        let baseSales = hasData ? stats.totalSales / stats.count : 0;
        let baseOrders = hasData ? stats.totalOrders / stats.count : 0;
        // Apply trend
        let predictedSales = baseSales * trendMultiplier;
        let predictedOrders = Math.round(baseOrders * trendMultiplier);
        // Apply weather impact
        const weatherDay = weatherForecast.find((w) => w.date === dateStr);
        let weatherImpact = 0;
        if (weatherDay) {
            weatherImpact = estimateWeatherImpact(weatherDay.condition, weatherDay.temperature);
            predictedSales *= (1 + weatherImpact);
            predictedOrders = Math.round(predictedOrders * (1 + weatherImpact));
        }
        // Ensure non-negative
        predictedSales = Math.max(0, Math.round(predictedSales * 100) / 100);
        predictedOrders = Math.max(0, predictedOrders);
        // Confidence based on data quality
        let confidence = 0.5;
        if (stats.count >= 12)
            confidence = 0.9;
        else if (stats.count >= 8)
            confidence = 0.8;
        else if (stats.count >= 4)
            confidence = 0.7;
        else if (stats.count >= 1)
            confidence = 0.6;
        if (!weatherDay)
            confidence -= 0.05;
        const factors = {
            dayOfWeek: {
                name: dayName,
                avgSales: hasData ? Math.round((stats.totalSales / stats.count) * 100) / 100 : 0,
                avgOrders: hasData ? Math.round(stats.totalOrders / stats.count) : 0,
            },
            weather: weatherDay
                ? { condition: weatherDay.condition, temperature: weatherDay.temperature, impact: Math.round(weatherImpact * 100) }
                : null,
            trend: {
                direction: trendPercent > 2 ? 'up' : trendPercent < -2 ? 'down' : 'stable',
                percentChange: Math.round(trendPercent * 10) / 10,
            },
        };
        const staffing = getStaffingRecommendation(predictedSales, dayName);
        forecasts.push({
            date: dateStr,
            predictedSales,
            predictedOrders,
            confidence,
            factors,
            staffing,
        });
        // Persist forecast
        try {
            await client_1.default.forecast.create({
                data: {
                    locationId,
                    date: dateStr,
                    predictedSales,
                    predictedOrders,
                    confidence,
                    factors: JSON.stringify(factors),
                },
            });
        }
        catch {
            // Ignore duplicate or write errors
        }
    }
    logger_1.logger.info('Forecast', `Generated 7-day forecast for ${locationId}`);
    return forecasts;
}
//# sourceMappingURL=forecasting.js.map