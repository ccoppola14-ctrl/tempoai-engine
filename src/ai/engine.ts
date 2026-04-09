import prisma from '../db/client';
import { logger } from '../utils/logger';
import { getDaypart } from '../utils/dayparts';
import type { OrderWithWeather, PatternResult } from './types';
import {
  detectTemperaturePatterns,
  detectWeatherPatterns,
  detectDaypartPatterns,
  detectDayOfWeekPatterns,
  detectTrends,
  detectCombos,
} from './patterns';
import {
  generateRecommendations,
  generateComboRecommendations,
} from './recommendations';

/**
 * Main AI analysis entry point.
 * Queries orders + weather, detects patterns, generates recommendations.
 */
export async function analyzeLocation(locationId: string): Promise<{
  patternsFound: number;
  recommendationsGenerated: number;
}> {
  logger.info('AIEngine', `Starting analysis for location ${locationId}`);

  // 1. Fetch enriched order data
  const orders = await fetchOrdersWithWeather(locationId);
  logger.info('AIEngine', `Loaded ${orders.length} order-item records with weather data`);

  if (orders.length === 0) {
    logger.warn('AIEngine', 'No order data available for analysis');
    return { patternsFound: 0, recommendationsGenerated: 0 };
  }

  // 2. Detect all pattern types
  const allPatterns: PatternResult[] = [];

  const tempPatterns = detectTemperaturePatterns(orders);
  logger.info('AIEngine', `Found ${tempPatterns.length} temperature patterns`);
  allPatterns.push(...tempPatterns);

  const weatherPatterns = detectWeatherPatterns(orders);
  logger.info('AIEngine', `Found ${weatherPatterns.length} weather condition patterns`);
  allPatterns.push(...weatherPatterns);

  const daypartPatterns = detectDaypartPatterns(orders);
  logger.info('AIEngine', `Found ${daypartPatterns.length} daypart patterns`);
  allPatterns.push(...daypartPatterns);

  const dowPatterns = detectDayOfWeekPatterns(orders);
  logger.info('AIEngine', `Found ${dowPatterns.length} day-of-week patterns`);
  allPatterns.push(...dowPatterns);

  const trendPatterns = detectTrends(orders);
  logger.info('AIEngine', `Found ${trendPatterns.length} trend patterns`);
  allPatterns.push(...trendPatterns);

  // 3. Detect combo patterns
  const orderItemsByOrder = buildOrderItemMap(orders);
  const combos = detectCombos(orderItemsByOrder);
  logger.info('AIEngine', `Found ${combos.length} combo patterns`);

  // 4. Get current conditions for active-trigger detection
  const currentConditions = await getCurrentConditions(locationId);

  // 5. Generate recommendations
  const recommendations = generateRecommendations(locationId, allPatterns, currentConditions);
  const comboRecs = generateComboRecommendations(locationId, combos);
  const allRecs = [...recommendations, ...comboRecs];

  // 6. Persist patterns to DB
  await persistPatterns(locationId, allPatterns);

  // 7. Persist recommendations to DB
  await persistRecommendations(locationId, allRecs);

  logger.info(
    'AIEngine',
    `Analysis complete: ${allPatterns.length} patterns, ${allRecs.length} recommendations`
  );

  return {
    patternsFound: allPatterns.length,
    recommendationsGenerated: allRecs.length,
  };
}

/**
 * Run analysis for all locations
 */
export async function analyzeAllLocations(): Promise<void> {
  const locations = await prisma.location.findMany({
    where: {
      OR: [
        { squareMerchantId: { not: null } },
        { cloverMerchantId: { not: null } },
      ],
    },
  });

  for (const location of locations) {
    try {
      await analyzeLocation(location.id);
    } catch (err) {
      logger.error('AIEngine', `Failed to analyze location ${location.id}`, err);
    }
  }
}

/**
 * Fetch all order items for a location, joined with the nearest weather snapshot.
 */
async function fetchOrdersWithWeather(locationId: string): Promise<OrderWithWeather[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Fetch orders with items
  const orders = await prisma.order.findMany({
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
  const weatherSnapshots = await prisma.weatherSnapshot.findMany({
    where: {
      locationId,
      timestamp: { gte: ninetyDaysAgo },
    },
    orderBy: { timestamp: 'asc' },
  });

  // Build enriched records
  const result: OrderWithWeather[] = [];

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

function findNearestWeather(
  timestamp: Date,
  snapshots: Array<{
    timestamp: Date;
    temperature: number;
    conditions: string;
    precipitation: number;
    humidity: number;
    windSpeed: number;
  }>
): (typeof snapshots)[number] | null {
  if (snapshots.length === 0) return null;

  let nearest = snapshots[0];
  let minDiff = Math.abs(timestamp.getTime() - nearest.timestamp.getTime());

  for (let i = 1; i < snapshots.length; i++) {
    const diff = Math.abs(timestamp.getTime() - snapshots[i].timestamp.getTime());
    if (diff < minDiff) {
      minDiff = diff;
      nearest = snapshots[i];
    } else if (diff > minDiff) {
      // Snapshots are sorted, so once diff starts increasing we can stop
      break;
    }
  }

  // Only match if within 2 hours
  if (minDiff > 2 * 60 * 60 * 1000) return null;

  return nearest;
}

function buildOrderItemMap(
  orders: OrderWithWeather[]
): Map<string, { menuItemId: string; menuItemName: string }[]> {
  const map = new Map<string, { menuItemId: string; menuItemName: string }[]>();

  for (const order of orders) {
    const existing = map.get(order.orderId);
    const item = { menuItemId: order.menuItemId, menuItemName: order.menuItemName };
    if (existing) {
      existing.push(item);
    } else {
      map.set(order.orderId, [item]);
    }
  }

  return map;
}

async function getCurrentConditions(
  locationId: string
): Promise<{ temperature?: number; weather?: string; daypart?: string; dayOfWeek?: number } | undefined> {
  const latestWeather = await prisma.weatherSnapshot.findFirst({
    where: { locationId },
    orderBy: { timestamp: 'desc' },
  });

  if (!latestWeather) return undefined;

  const now = new Date();
  return {
    temperature: latestWeather.temperature,
    weather: latestWeather.conditions,
    daypart: getDaypart(now.getHours()),
    dayOfWeek: now.getDay(),
  };
}

async function persistPatterns(
  locationId: string,
  patterns: PatternResult[]
): Promise<void> {
  // Clear existing patterns for this location
  await prisma.aIPattern.deleteMany({ where: { locationId } });

  // Insert new patterns
  for (const pattern of patterns) {
    await prisma.aIPattern.create({
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

async function persistRecommendations(
  locationId: string,
  recommendations: Array<{
    id: string;
    locationId: string;
    type: string;
    itemId: string;
    itemName: string;
    trigger: { type: string; condition: string; currentlyActive: boolean };
    impact: { expectedLift: number; confidence: number; historicalDataPoints: number };
    message: string;
    channels: string[];
    createdAt: Date;
  }>
): Promise<void> {
  // Clear existing active recommendations for this location
  await prisma.recommendation.deleteMany({
    where: { locationId, status: 'active' },
  });

  for (const rec of recommendations) {
    await prisma.recommendation.create({
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
