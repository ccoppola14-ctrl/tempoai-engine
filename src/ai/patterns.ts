import { getDaypart, getDaypartLabel, getDayName } from '../utils/dayparts';
import type { OrderWithWeather, PatternResult, ComboPattern } from './types';

const MIN_DATA_POINTS = 5;
const MIN_LIFT_PERCENT = 20;

/**
 * Detect temperature-correlated patterns.
 * Buckets: <60, 60-75, 75-85, 85+
 */
export function detectTemperaturePatterns(orders: OrderWithWeather[]): PatternResult[] {
  const results: PatternResult[] = [];
  const tempBuckets = [
    { label: 'temp < 60', test: (t: number) => t < 60 },
    { label: 'temp 60-75', test: (t: number) => t >= 60 && t < 75 },
    { label: 'temp 75-85', test: (t: number) => t >= 75 && t < 85 },
    { label: 'temp > 85', test: (t: number) => t >= 85 },
  ];

  // Group orders by item
  const itemGroups = groupByItem(orders);

  for (const [menuItemId, itemOrders] of itemGroups) {
    const menuItemName = itemOrders[0].menuItemName;
    const ordersWithTemp = itemOrders.filter((o) => o.temperature !== null);
    if (ordersWithTemp.length < MIN_DATA_POINTS) continue;

    // Calculate baseline: average quantity per day across all temps
    const totalDays = getUniqueDays(ordersWithTemp);
    const baselineDaily = ordersWithTemp.reduce((sum, o) => sum + o.quantity, 0) / Math.max(totalDays, 1);

    for (const bucket of tempBuckets) {
      const bucketOrders = ordersWithTemp.filter((o) => bucket.test(o.temperature!));
      if (bucketOrders.length < MIN_DATA_POINTS) continue;

      const bucketDays = getUniqueDays(bucketOrders);
      const bucketDaily = bucketOrders.reduce((sum, o) => sum + o.quantity, 0) / Math.max(bucketDays, 1);

      const lift = baselineDaily > 0 ? ((bucketDaily - baselineDaily) / baselineDaily) * 100 : 0;

      if (Math.abs(lift) >= MIN_LIFT_PERCENT) {
        results.push({
          menuItemId,
          menuItemName,
          patternType: 'temperature',
          triggerCondition: bucket.label,
          baselineSales: round(baselineDaily),
          conditionSales: round(bucketDaily),
          liftPercent: round(lift),
          confidence: calculateConfidence(bucketOrders.length, totalDays),
          dataPoints: bucketOrders.length,
        });
      }
    }
  }

  return results;
}

/**
 * Detect weather-condition patterns (rain, snow, clear, etc.)
 */
export function detectWeatherPatterns(orders: OrderWithWeather[]): PatternResult[] {
  const results: PatternResult[] = [];
  const conditions = ['clear', 'partly_cloudy', 'rain', 'drizzle', 'snow', 'thunderstorm', 'foggy'];

  const itemGroups = groupByItem(orders);

  for (const [menuItemId, itemOrders] of itemGroups) {
    const menuItemName = itemOrders[0].menuItemName;
    const ordersWithConditions = itemOrders.filter((o) => o.conditions !== null);
    if (ordersWithConditions.length < MIN_DATA_POINTS) continue;

    const totalDays = getUniqueDays(ordersWithConditions);
    const baselineDaily =
      ordersWithConditions.reduce((sum, o) => sum + o.quantity, 0) / Math.max(totalDays, 1);

    for (const condition of conditions) {
      const condOrders = ordersWithConditions.filter((o) => o.conditions === condition);
      if (condOrders.length < MIN_DATA_POINTS) continue;

      const condDays = getUniqueDays(condOrders);
      const condDaily = condOrders.reduce((sum, o) => sum + o.quantity, 0) / Math.max(condDays, 1);

      const lift = baselineDaily > 0 ? ((condDaily - baselineDaily) / baselineDaily) * 100 : 0;

      if (Math.abs(lift) >= MIN_LIFT_PERCENT) {
        results.push({
          menuItemId,
          menuItemName,
          patternType: 'weather',
          triggerCondition: condition,
          baselineSales: round(baselineDaily),
          conditionSales: round(condDaily),
          liftPercent: round(lift),
          confidence: calculateConfidence(condOrders.length, totalDays),
          dataPoints: condOrders.length,
        });
      }
    }
  }

  return results;
}

/**
 * Detect daypart patterns (breakfast rush, lunch spike, etc.)
 */
export function detectDaypartPatterns(orders: OrderWithWeather[]): PatternResult[] {
  const results: PatternResult[] = [];
  const dayparts = ['early_morning', 'breakfast', 'lunch', 'afternoon', 'dinner', 'late_night'] as const;

  const itemGroups = groupByItem(orders);

  for (const [menuItemId, itemOrders] of itemGroups) {
    const menuItemName = itemOrders[0].menuItemName;
    if (itemOrders.length < MIN_DATA_POINTS) continue;

    const totalDays = getUniqueDays(itemOrders);
    const baselineDaily =
      itemOrders.reduce((sum, o) => sum + o.quantity, 0) / Math.max(totalDays, 1);

    for (const daypart of dayparts) {
      const dpOrders = itemOrders.filter((o) => getDaypart(o.hourOfDay) === daypart);
      if (dpOrders.length < MIN_DATA_POINTS) continue;

      const dpDays = getUniqueDays(dpOrders);
      const dpDaily = dpOrders.reduce((sum, o) => sum + o.quantity, 0) / Math.max(dpDays, 1);

      const lift = baselineDaily > 0 ? ((dpDaily - baselineDaily) / baselineDaily) * 100 : 0;

      if (Math.abs(lift) >= MIN_LIFT_PERCENT) {
        results.push({
          menuItemId,
          menuItemName,
          patternType: 'daypart',
          triggerCondition: daypart,
          baselineSales: round(baselineDaily),
          conditionSales: round(dpDaily),
          liftPercent: round(lift),
          confidence: calculateConfidence(dpOrders.length, totalDays),
          dataPoints: dpOrders.length,
        });
      }
    }
  }

  return results;
}

/**
 * Detect day-of-week patterns
 */
export function detectDayOfWeekPatterns(orders: OrderWithWeather[]): PatternResult[] {
  const results: PatternResult[] = [];

  const itemGroups = groupByItem(orders);

  for (const [menuItemId, itemOrders] of itemGroups) {
    const menuItemName = itemOrders[0].menuItemName;
    if (itemOrders.length < MIN_DATA_POINTS) continue;

    const totalDays = getUniqueDays(itemOrders);
    const baselineDaily =
      itemOrders.reduce((sum, o) => sum + o.quantity, 0) / Math.max(totalDays, 1);

    for (let dow = 0; dow < 7; dow++) {
      const dowOrders = itemOrders.filter((o) => o.dayOfWeek === dow);
      if (dowOrders.length < MIN_DATA_POINTS) continue;

      const dowDays = getUniqueDays(dowOrders);
      const dowDaily = dowOrders.reduce((sum, o) => sum + o.quantity, 0) / Math.max(dowDays, 1);

      const lift = baselineDaily > 0 ? ((dowDaily - baselineDaily) / baselineDaily) * 100 : 0;

      if (Math.abs(lift) >= MIN_LIFT_PERCENT) {
        results.push({
          menuItemId,
          menuItemName,
          patternType: 'day_of_week',
          triggerCondition: getDayName(dow),
          baselineSales: round(baselineDaily),
          conditionSales: round(dowDaily),
          liftPercent: round(lift),
          confidence: calculateConfidence(dowOrders.length, totalDays),
          dataPoints: dowOrders.length,
        });
      }
    }
  }

  return results;
}

/**
 * Detect trending items (up or down over the last 30 days vs previous period)
 */
export function detectTrends(orders: OrderWithWeather[]): PatternResult[] {
  const results: PatternResult[] = [];
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const itemGroups = groupByItem(orders);

  for (const [menuItemId, itemOrders] of itemGroups) {
    const menuItemName = itemOrders[0].menuItemName;

    const recentOrders = itemOrders.filter((o) => o.timestamp >= thirtyDaysAgo);
    const priorOrders = itemOrders.filter(
      (o) => o.timestamp >= sixtyDaysAgo && o.timestamp < thirtyDaysAgo
    );

    if (recentOrders.length < MIN_DATA_POINTS || priorOrders.length < MIN_DATA_POINTS) continue;

    const recentDays = Math.max(getUniqueDays(recentOrders), 1);
    const priorDays = Math.max(getUniqueDays(priorOrders), 1);

    const recentDaily = recentOrders.reduce((sum, o) => sum + o.quantity, 0) / recentDays;
    const priorDaily = priorOrders.reduce((sum, o) => sum + o.quantity, 0) / priorDays;

    const lift = priorDaily > 0 ? ((recentDaily - priorDaily) / priorDaily) * 100 : 0;

    if (Math.abs(lift) >= MIN_LIFT_PERCENT) {
      results.push({
        menuItemId,
        menuItemName,
        patternType: 'trend',
        triggerCondition: lift > 0 ? 'trending_up' : 'trending_down',
        baselineSales: round(priorDaily),
        conditionSales: round(recentDaily),
        liftPercent: round(lift),
        confidence: calculateConfidence(recentOrders.length + priorOrders.length, recentDays + priorDays),
        dataPoints: recentOrders.length + priorOrders.length,
      });
    }
  }

  return results;
}

/**
 * Detect combo patterns — items frequently ordered together
 */
export function detectCombos(
  orderItemsByOrder: Map<string, { menuItemId: string; menuItemName: string }[]>
): ComboPattern[] {
  const results: ComboPattern[] = [];
  const pairCounts = new Map<string, number>();
  const itemOrderCounts = new Map<string, number>();
  const itemNames = new Map<string, string>();

  for (const [, items] of orderItemsByOrder) {
    const uniqueItems = [...new Map(items.map((i) => [i.menuItemId, i])).values()];

    for (const item of uniqueItems) {
      itemOrderCounts.set(item.menuItemId, (itemOrderCounts.get(item.menuItemId) ?? 0) + 1);
      itemNames.set(item.menuItemId, item.menuItemName);
    }

    for (let i = 0; i < uniqueItems.length; i++) {
      for (let j = i + 1; j < uniqueItems.length; j++) {
        const key = [uniqueItems[i].menuItemId, uniqueItems[j].menuItemId].sort().join('|');
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const totalOrders = orderItemsByOrder.size;

  for (const [pairKey, count] of pairCounts) {
    if (count < MIN_DATA_POINTS) continue;

    const [idA, idB] = pairKey.split('|');
    const ordersWithA = itemOrderCounts.get(idA) ?? 0;
    const ordersWithB = itemOrderCounts.get(idB) ?? 0;

    const support = totalOrders > 0 ? (count / totalOrders) * 100 : 0;
    const confAtoB = ordersWithA > 0 ? (count / ordersWithA) * 100 : 0;
    const confBtoA = ordersWithB > 0 ? (count / ordersWithB) * 100 : 0;

    if (confAtoB >= 20 || confBtoA >= 20) {
      results.push({
        itemA: idA,
        itemAName: itemNames.get(idA) ?? 'Unknown',
        itemB: idB,
        itemBName: itemNames.get(idB) ?? 'Unknown',
        coOccurrenceCount: count,
        totalOrdersWithA: ordersWithA,
        totalOrdersWithB: ordersWithB,
        supportPercent: round(support),
        confidenceAtoB: round(confAtoB),
        confidenceBtoA: round(confBtoA),
      });
    }
  }

  return results.sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount);
}

// --- Helpers ---

function groupByItem(orders: OrderWithWeather[]): Map<string, OrderWithWeather[]> {
  const groups = new Map<string, OrderWithWeather[]>();
  for (const order of orders) {
    const existing = groups.get(order.menuItemId);
    if (existing) {
      existing.push(order);
    } else {
      groups.set(order.menuItemId, [order]);
    }
  }
  return groups;
}

function getUniqueDays(orders: OrderWithWeather[]): number {
  const days = new Set(
    orders.map((o) => {
      const d = o.timestamp;
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    })
  );
  return days.size;
}

function calculateConfidence(sampleSize: number, totalDays: number): number {
  // Simple confidence score based on data volume
  const sampleScore = Math.min(sampleSize / 50, 1); // max out at 50 data points
  const daysScore = Math.min(totalDays / 30, 1); // max out at 30 days
  return round(sampleScore * 0.6 + daysScore * 0.4);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function generatePatternMessage(pattern: PatternResult): string {
  const direction = pattern.liftPercent > 0 ? 'increase' : 'decrease';
  const absLift = Math.abs(pattern.liftPercent);

  switch (pattern.patternType) {
    case 'temperature':
      return `${pattern.menuItemName} sales ${direction} ${absLift}% when ${pattern.triggerCondition}`;
    case 'weather':
      return `${pattern.menuItemName} sales ${direction} ${absLift}% during ${pattern.triggerCondition} weather`;
    case 'daypart':
      return `${pattern.menuItemName} sells best during ${getDaypartLabel(pattern.triggerCondition as Parameters<typeof getDaypartLabel>[0])}`;
    case 'day_of_week':
      return `${pattern.menuItemName} sales ${direction} ${absLift}% on ${pattern.triggerCondition}s`;
    case 'trend':
      return `${pattern.menuItemName} is ${pattern.triggerCondition === 'trending_up' ? 'trending up' : 'trending down'} ${absLift}% over the last 30 days`;
    default:
      return `${pattern.menuItemName}: ${direction} ${absLift}% under ${pattern.triggerCondition}`;
  }
}
