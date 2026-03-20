"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeLocation = analyzeLocation;
exports.analyzeAllLocations = analyzeAllLocations;
const client_1 = __importDefault(require("../db/client"));
const logger_1 = require("../utils/logger");
const dayparts_1 = require("../utils/dayparts");
const patterns_1 = require("./patterns");
const recommendations_1 = require("./recommendations");
/**
 * Main AI analysis entry point.
 * Queries orders + weather, detects patterns, generates recommendations.
 */
async function analyzeLocation(locationId) {
    logger_1.logger.info('AIEngine', `Starting analysis for location ${locationId}`);
    // 1. Fetch enriched order data
    const orders = await fetchOrdersWithWeather(locationId);
    logger_1.logger.info('AIEngine', `Loaded ${orders.length} order-item records with weather data`);
    if (orders.length === 0) {
        logger_1.logger.warn('AIEngine', 'No order data available for analysis');
        return { patternsFound: 0, recommendationsGenerated: 0 };
    }
    // 2. Detect all pattern types
    const allPatterns = [];
    const tempPatterns = (0, patterns_1.detectTemperaturePatterns)(orders);
    logger_1.logger.info('AIEngine', `Found ${tempPatterns.length} temperature patterns`);
    allPatterns.push(...tempPatterns);
    const weatherPatterns = (0, patterns_1.detectWeatherPatterns)(orders);
    logger_1.logger.info('AIEngine', `Found ${weatherPatterns.length} weather condition patterns`);
    allPatterns.push(...weatherPatterns);
    const daypartPatterns = (0, patterns_1.detectDaypartPatterns)(orders);
    logger_1.logger.info('AIEngine', `Found ${daypartPatterns.length} daypart patterns`);
    allPatterns.push(...daypartPatterns);
    const dowPatterns = (0, patterns_1.detectDayOfWeekPatterns)(orders);
    logger_1.logger.info('AIEngine', `Found ${dowPatterns.length} day-of-week patterns`);
    allPatterns.push(...dowPatterns);
    const trendPatterns = (0, patterns_1.detectTrends)(orders);
    logger_1.logger.info('AIEngine', `Found ${trendPatterns.length} trend patterns`);
    allPatterns.push(...trendPatterns);
    // 3. Detect combo patterns
    const orderItemsByOrder = buildOrderItemMap(orders);
    const combos = (0, patterns_1.detectCombos)(orderItemsByOrder);
    logger_1.logger.info('AIEngine', `Found ${combos.length} combo patterns`);
    // 4. Get current conditions for active-trigger detection
    const currentConditions = await getCurrentConditions(locationId);
    // 5. Generate recommendations
    const recommendations = (0, recommendations_1.generateRecommendations)(locationId, allPatterns, currentConditions);
    const comboRecs = (0, recommendations_1.generateComboRecommendations)(locationId, combos);
    const allRecs = [...recommendations, ...comboRecs];
    // 6. Persist patterns to DB
    await persistPatterns(locationId, allPatterns);
    // 7. Persist recommendations to DB
    await persistRecommendations(locationId, allRecs);
    logger_1.logger.info('AIEngine', `Analysis complete: ${allPatterns.length} patterns, ${allRecs.length} recommendations`);
    return {
        patternsFound: allPatterns.length,
        recommendationsGenerated: allRecs.length,
    };
}
/**
 * Run analysis for all locations
 */
async function analyzeAllLocations() {
    const locations = await client_1.default.location.findMany();
    for (const location of locations) {
        try {
            await analyzeLocation(location.id);
        }
        catch (err) {
            logger_1.logger.error('AIEngine', `Failed to analyze location ${location.id}`, err);
        }
    }
}
/**
 * Fetch all order items for a location, joined with the nearest weather snapshot.
 */
async function fetchOrdersWithWeather(locationId) {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    // Fetch orders with items
    const orders = await client_1.default.order.findMany({
        where: {
            locationId,
            timestamp: { gte: ninetyDaysAgo },
        },
        include: {
            orderItems: {
                include: { menuItem: true },
            },
        },
        orderBy: { timestamp: 'asc' },
    });
    // Fetch all weather snapshots for the period
    const weatherSnapshots = await client_1.default.weatherSnapshot.findMany({
        where: {
            locationId,
            timestamp: { gte: ninetyDaysAgo },
        },
        orderBy: { timestamp: 'asc' },
    });
    // Build enriched records
    const result = [];
    for (const order of orders) {
        // Find nearest weather snapshot
        const weather = findNearestWeather(order.timestamp, weatherSnapshots);
        for (const item of order.orderItems) {
            result.push({
                orderId: order.id,
                timestamp: order.timestamp,
                menuItemId: item.menuItemId,
                menuItemName: item.menuItem.name,
                quantity: item.quantity,
                amount: item.amount,
                temperature: weather?.temperature ?? null,
                conditions: weather?.conditions ?? null,
                precipitation: weather?.precipitation ?? null,
                humidity: weather?.humidity ?? null,
                windSpeed: weather?.windSpeed ?? null,
                hourOfDay: order.timestamp.getHours(),
                dayOfWeek: order.timestamp.getDay(),
            });
        }
    }
    return result;
}
function findNearestWeather(timestamp, snapshots) {
    if (snapshots.length === 0)
        return null;
    let nearest = snapshots[0];
    let minDiff = Math.abs(timestamp.getTime() - nearest.timestamp.getTime());
    for (let i = 1; i < snapshots.length; i++) {
        const diff = Math.abs(timestamp.getTime() - snapshots[i].timestamp.getTime());
        if (diff < minDiff) {
            minDiff = diff;
            nearest = snapshots[i];
        }
        else if (diff > minDiff) {
            // Snapshots are sorted, so once diff starts increasing we can stop
            break;
        }
    }
    // Only match if within 2 hours
    if (minDiff > 2 * 60 * 60 * 1000)
        return null;
    return nearest;
}
function buildOrderItemMap(orders) {
    const map = new Map();
    for (const order of orders) {
        const existing = map.get(order.orderId);
        const item = { menuItemId: order.menuItemId, menuItemName: order.menuItemName };
        if (existing) {
            existing.push(item);
        }
        else {
            map.set(order.orderId, [item]);
        }
    }
    return map;
}
async function getCurrentConditions(locationId) {
    const latestWeather = await client_1.default.weatherSnapshot.findFirst({
        where: { locationId },
        orderBy: { timestamp: 'desc' },
    });
    if (!latestWeather)
        return undefined;
    const now = new Date();
    return {
        temperature: latestWeather.temperature,
        weather: latestWeather.conditions,
        daypart: (0, dayparts_1.getDaypart)(now.getHours()),
        dayOfWeek: now.getDay(),
    };
}
async function persistPatterns(locationId, patterns) {
    // Clear existing patterns for this location
    await client_1.default.aIPattern.deleteMany({ where: { locationId } });
    // Insert new patterns
    for (const pattern of patterns) {
        await client_1.default.aIPattern.create({
            data: {
                locationId,
                menuItemId: pattern.menuItemId,
                patternType: pattern.patternType,
                triggerCondition: pattern.triggerCondition,
                baselineSales: pattern.baselineSales,
                conditionSales: pattern.conditionSales,
                liftPercent: pattern.liftPercent,
                confidence: pattern.confidence,
                dataPoints: pattern.dataPoints,
            },
        });
    }
}
async function persistRecommendations(locationId, recommendations) {
    // Clear existing active recommendations for this location
    await client_1.default.recommendation.deleteMany({
        where: { locationId, status: 'active' },
    });
    for (const rec of recommendations) {
        await client_1.default.recommendation.create({
            data: {
                locationId,
                menuItemId: rec.itemId,
                type: rec.type,
                triggerType: rec.trigger.type,
                triggerCondition: rec.trigger.condition,
                currentlyActive: rec.trigger.currentlyActive,
                expectedLift: rec.impact.expectedLift,
                confidence: rec.impact.confidence,
                dataPoints: rec.impact.historicalDataPoints,
                message: rec.message,
                channels: JSON.stringify(rec.channels),
                status: 'active',
            },
        });
    }
}
//# sourceMappingURL=engine.js.map