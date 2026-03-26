import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from './client';
import type { DemoBrandConfig } from './demo-brands';
import { getBrandConfig } from './demo-brands';

// ─── Deterministic RNG for reproducible demo data ─────────
let _seed = 2024;
function seededRandom(): number {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed - 1) / 2147483646;
}
function randomBetween(min: number, max: number): number {
  return min + seededRandom() * (max - min);
}
function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)];
}
function gaussianRandom(mean: number, stddev: number): number {
  // Box-Muller transform using seeded random
  const u1 = seededRandom();
  const u2 = seededRandom();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stddev;
}

// ─── Constants ────────────────────────────────────────────
const DEMO_ORG_ID = 'demo-org-lees-donuts';
const DEMO_USER_EMAIL = 'demo@usetempoai.com';
const DAYS_OF_DATA = 30;

// ─── Vancouver coastal-mild weather generation ────────────
interface WeatherHour {
  temperature: number;
  conditions: string;
  precipitation: number;
  humidity: number;
  windSpeed: number;
}

function generateVancouverWeather(date: Date): WeatherHour[] {
  const month = date.getMonth(); // 0-11
  const hours: WeatherHour[] = [];

  // Vancouver monthly avg temps (°F) and rain probability
  const monthProfiles: Array<{ avgHigh: number; avgLow: number; rainPct: number }> = [
    { avgHigh: 43, avgLow: 34, rainPct: 0.65 }, // Jan
    { avgHigh: 46, avgLow: 35, rainPct: 0.55 }, // Feb
    { avgHigh: 50, avgLow: 37, rainPct: 0.50 }, // Mar
    { avgHigh: 55, avgLow: 41, rainPct: 0.40 }, // Apr
    { avgHigh: 61, avgLow: 47, rainPct: 0.30 }, // May
    { avgHigh: 66, avgLow: 52, rainPct: 0.25 }, // Jun
    { avgHigh: 72, avgLow: 56, rainPct: 0.15 }, // Jul
    { avgHigh: 72, avgLow: 56, rainPct: 0.15 }, // Aug
    { avgHigh: 65, avgLow: 51, rainPct: 0.25 }, // Sep
    { avgHigh: 54, avgLow: 44, rainPct: 0.50 }, // Oct
    { avgHigh: 46, avgLow: 37, rainPct: 0.65 }, // Nov
    { avgHigh: 42, avgLow: 33, rainPct: 0.70 }, // Dec
  ];

  const profile = monthProfiles[month];
  // Decide if today is a rainy day
  const isRainyDay = seededRandom() < profile.rainPct;
  // Some variation day-to-day
  const dayTempOffset = gaussianRandom(0, 3);

  for (let hour = 5; hour <= 22; hour++) {
    // Temperature follows sinusoidal curve peaking at 2-3pm
    const hourFactor = Math.sin(((hour - 6) / 16) * Math.PI);
    const temp = profile.avgLow + dayTempOffset + (profile.avgHigh - profile.avgLow + dayTempOffset) * Math.max(0, hourFactor);
    const clampedTemp = Math.max(profile.avgLow - 5, Math.min(profile.avgHigh + 8, temp));

    let conditions: string;
    let precipitation = 0;
    if (isRainyDay) {
      // Rain pattern: heavier in morning/evening, lighter midday
      const rainIntensity = seededRandom();
      if (rainIntensity < 0.3) {
        conditions = 'drizzle';
        precipitation = randomBetween(0.01, 0.05);
      } else if (rainIntensity < 0.7) {
        conditions = 'rain';
        precipitation = randomBetween(0.05, 0.2);
      } else if (rainIntensity < 0.85) {
        conditions = 'overcast';
        precipitation = 0;
      } else {
        conditions = 'partly_cloudy';
        precipitation = 0;
      }
    } else {
      const skyRoll = seededRandom();
      if (skyRoll < 0.25) {
        conditions = 'clear';
      } else if (skyRoll < 0.6) {
        conditions = 'partly_cloudy';
      } else {
        conditions = 'overcast';
      }
    }

    hours.push({
      temperature: Math.round(clampedTemp * 10) / 10,
      conditions,
      precipitation: Math.round(precipitation * 100) / 100,
      humidity: Math.round(isRainyDay ? randomBetween(75, 95) : randomBetween(55, 80)),
      windSpeed: Math.round(randomBetween(3, 18) * 10) / 10,
    });
  }
  return hours;
}

// ─── Order generation ─────────────────────────────────────
interface MenuItemWithId {
  id: string;
  name: string;
  category: string;
  price: number;
}

// Donut shop hourly traffic multipliers (proportion of daily orders per hour)
// Donut shops peak 6-10am, moderate lunch, quiet afternoon, small evening bump
const HOURLY_WEIGHTS: Record<number, number> = {
  5: 0.02, 6: 0.06, 7: 0.12, 8: 0.14, 9: 0.12, 10: 0.09,
  11: 0.07, 12: 0.08, 13: 0.06, 14: 0.04, 15: 0.04, 16: 0.04,
  17: 0.03, 18: 0.03, 19: 0.02, 20: 0.02, 21: 0.01, 22: 0.01,
};

// Day-of-week multipliers (0=Sun): weekends higher for donut shops
const DAY_WEIGHTS: Record<number, number> = {
  0: 1.25, // Sun — brunch crowds
  1: 0.85, // Mon
  2: 0.90, // Tue
  3: 0.95, // Wed
  4: 1.00, // Thu
  5: 1.05, // Fri
  6: 1.30, // Sat — highest
};

// Category popularity weights for item selection
const CATEGORY_WEIGHTS: Record<string, number> = {
  'Classic Donuts': 3.0,
  'Fritters & Bars': 1.5,
  'Filled Donuts': 2.0,
  'Specialty Donuts': 1.8,
  'Beverages': 2.5,
};

function generateOrdersForDay(
  date: Date,
  locationId: string,
  menuItems: MenuItemWithId[],
  weather: WeatherHour[],
  config: DemoBrandConfig,
  locationIndex: number,
): Array<{
  order: { id: string; locationId: string; timestamp: Date; total: number; itemCount: number };
  items: Array<{ id: string; orderId: string; menuItemId: string; quantity: number; amount: number }>;
}> {
  const results: Array<{
    order: { id: string; locationId: string; timestamp: Date; total: number; itemCount: number };
    items: Array<{ id: string; orderId: string; menuItemId: string; quantity: number; amount: number }>;
  }> = [];

  const dayOfWeek = date.getDay();
  const dayMult = DAY_WEIGHTS[dayOfWeek] ?? 1.0;

  // Location-level variation (±15% from avg)
  const locationMult = 0.85 + (locationIndex * 0.03);
  // Target daily order count from revenue / avg order value
  const targetDailyOrders = Math.round(
    (config.avgDailyRevenue / config.avgOrderValue) * dayMult * locationMult
  );

  for (let hour = 5; hour <= 22; hour++) {
    const hourWeight = HOURLY_WEIGHTS[hour] ?? 0.02;
    const weatherIdx = hour - 5;
    const wx = weather[weatherIdx] ?? weather[0];

    // Weather impact: rain reduces foot traffic by 10-20%, cold mornings boost hot beverage demand
    let weatherTrafficMult = 1.0;
    if (wx.conditions === 'rain' || wx.conditions === 'drizzle') {
      weatherTrafficMult = randomBetween(0.80, 0.92);
    }

    const hourOrders = Math.round(targetDailyOrders * hourWeight * weatherTrafficMult);

    for (let i = 0; i < hourOrders; i++) {
      const minuteOffset = randomInt(0, 59);
      const orderTime = new Date(date);
      orderTime.setHours(hour, minuteOffset, randomInt(0, 59), 0);

      const orderId = crypto.randomUUID();

      // Each order: 1-4 items, weighted toward 2-3
      const itemCount = pick([1, 2, 2, 2, 3, 3, 3, 4]);
      const orderItems: Array<{ id: string; orderId: string; menuItemId: string; quantity: number; amount: number }> = [];
      let orderTotal = 0;

      // Always likely to include a donut; ~60% chance of adding a beverage
      const selectedItems: MenuItemWithId[] = [];
      for (let j = 0; j < itemCount; j++) {
        const item = pickWeightedItem(menuItems, wx, hour, j === 0);
        selectedItems.push(item);
      }

      for (const item of selectedItems) {
        const qty = item.category === 'Beverages' ? 1 : pick([1, 1, 1, 2, 2, 3]);
        const amount = Math.round(item.price * qty * 100) / 100;
        orderTotal += amount;
        orderItems.push({
          id: crypto.randomUUID(),
          orderId,
          menuItemId: item.id,
          quantity: qty,
          amount,
        });
      }

      results.push({
        order: {
          id: orderId,
          locationId,
          timestamp: orderTime,
          total: Math.round(orderTotal * 100) / 100,
          itemCount: orderItems.reduce((sum, oi) => sum + oi.quantity, 0),
        },
        items: orderItems,
      });
    }
  }

  return results;
}

function pickWeightedItem(
  items: MenuItemWithId[],
  weather: WeatherHour,
  hour: number,
  firstItem: boolean,
): MenuItemWithId {
  const weights = items.map((item) => {
    let w = CATEGORY_WEIGHTS[item.category] ?? 1.0;

    // Morning hours (5-10): boost classic donuts & beverages
    if (hour >= 5 && hour <= 10) {
      if (item.category === 'Classic Donuts') w *= 1.5;
      if (item.category === 'Beverages') w *= 1.8;
      if (item.name === 'Drip Coffee') w *= 2.0;
    }

    // Afternoon: specialty donuts get a bump
    if (hour >= 13 && hour <= 17) {
      if (item.category === 'Specialty Donuts') w *= 1.6;
    }

    // Cold/rainy: hot beverages up, iced coffee down
    if (weather.temperature < 50 || weather.conditions === 'rain' || weather.conditions === 'drizzle') {
      if (item.name === 'Hot Chocolate' || item.name === 'Latte' || item.name === 'Americano') w *= 1.8;
      if (item.name === 'Iced Coffee') w *= 0.3;
      // Comfort food donuts
      if (item.name === 'Apple Fritter' || item.name === 'Honey Dip' || item.name === 'Boston Cream') w *= 1.3;
    }

    // Warmer days: iced coffee up
    if (weather.temperature > 60) {
      if (item.name === 'Iced Coffee') w *= 2.0;
    }

    // First item in order: heavily weight donuts (this is a donut shop!)
    if (firstItem && item.category !== 'Beverages') {
      w *= 2.0;
    }

    return w;
  });

  // Weighted random selection
  const total = weights.reduce((a, b) => a + b, 0);
  let r = seededRandom() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ─── AI Pattern generation ────────────────────────────────
function generateAIPatterns(
  locationId: string,
  menuItems: MenuItemWithId[],
): Array<{
  id: string;
  locationId: string;
  menuItemId: string;
  patternType: string;
  triggerCondition: string;
  baselineSales: number;
  conditionSales: number;
  liftPercent: number;
  confidence: number;
  dataPoints: number;
}> {
  const patterns: Array<{
    id: string;
    locationId: string;
    menuItemId: string;
    patternType: string;
    triggerCondition: string;
    baselineSales: number;
    conditionSales: number;
    liftPercent: number;
    confidence: number;
    dataPoints: number;
  }> = [];

  // Weather patterns
  const weatherPatterns: Array<{ item: string; trigger: string; lift: number }> = [
    { item: 'Hot Chocolate', trigger: 'temperature < 45', lift: 42 },
    { item: 'Latte', trigger: 'rainy', lift: 28 },
    { item: 'Americano', trigger: 'rainy', lift: 22 },
    { item: 'Iced Coffee', trigger: 'temperature > 65', lift: 55 },
    { item: 'Apple Fritter', trigger: 'temperature < 50', lift: 18 },
    { item: 'Drip Coffee', trigger: 'temperature < 45', lift: 35 },
    { item: 'Honey Dip', trigger: 'clear skies', lift: 12 },
    { item: 'Boston Cream', trigger: 'rainy', lift: 15 },
  ];

  for (const wp of weatherPatterns) {
    const item = menuItems.find((m) => m.name === wp.item);
    if (!item) continue;
    const baseline = randomBetween(15, 40);
    patterns.push({
      id: crypto.randomUUID(),
      locationId,
      menuItemId: item.id,
      patternType: 'weather',
      triggerCondition: wp.trigger,
      baselineSales: Math.round(baseline * 10) / 10,
      conditionSales: Math.round(baseline * (1 + wp.lift / 100) * 10) / 10,
      liftPercent: wp.lift,
      confidence: Math.round(randomBetween(0.72, 0.95) * 100) / 100,
      dataPoints: randomInt(80, 250),
    });
  }

  // Daypart patterns
  const daypartPatterns: Array<{ item: string; trigger: string; lift: number }> = [
    { item: 'Drip Coffee', trigger: 'breakfast (6-10am)', lift: 65 },
    { item: 'Honey Dip', trigger: 'breakfast (6-10am)', lift: 48 },
    { item: 'Old Fashioned Glazed', trigger: 'breakfast (6-10am)', lift: 38 },
    { item: 'Salted Caramel Crunch', trigger: 'afternoon (2-5pm)', lift: 32 },
    { item: 'Matcha Glazed', trigger: 'afternoon (2-5pm)', lift: 25 },
    { item: "S'mores Donut", trigger: 'evening (6-9pm)', lift: 20 },
  ];

  for (const dp of daypartPatterns) {
    const item = menuItems.find((m) => m.name === dp.item);
    if (!item) continue;
    const baseline = randomBetween(12, 35);
    patterns.push({
      id: crypto.randomUUID(),
      locationId,
      menuItemId: item.id,
      patternType: 'daypart',
      triggerCondition: dp.trigger,
      baselineSales: Math.round(baseline * 10) / 10,
      conditionSales: Math.round(baseline * (1 + dp.lift / 100) * 10) / 10,
      liftPercent: dp.lift,
      confidence: Math.round(randomBetween(0.78, 0.96) * 100) / 100,
      dataPoints: randomInt(120, 300),
    });
  }

  // Day-of-week patterns
  const dowPatterns: Array<{ item: string; trigger: string; lift: number }> = [
    { item: 'Apple Fritter', trigger: 'weekend (Sat-Sun)', lift: 35 },
    { item: 'Maple Bacon', trigger: 'weekend (Sat-Sun)', lift: 42 },
    { item: 'Bavarian Cream', trigger: 'Friday', lift: 18 },
  ];

  for (const dw of dowPatterns) {
    const item = menuItems.find((m) => m.name === dw.item);
    if (!item) continue;
    const baseline = randomBetween(10, 30);
    patterns.push({
      id: crypto.randomUUID(),
      locationId,
      menuItemId: item.id,
      patternType: 'day_of_week',
      triggerCondition: dw.trigger,
      baselineSales: Math.round(baseline * 10) / 10,
      conditionSales: Math.round(baseline * (1 + dw.lift / 100) * 10) / 10,
      liftPercent: dw.lift,
      confidence: Math.round(randomBetween(0.70, 0.92) * 100) / 100,
      dataPoints: randomInt(60, 180),
    });
  }

  return patterns;
}

// ─── Recommendation generation ────────────────────────────
function generateRecommendations(
  locationId: string,
  menuItems: MenuItemWithId[],
): Array<{
  id: string;
  locationId: string;
  menuItemId: string;
  type: string;
  triggerType: string;
  triggerCondition: string;
  currentlyActive: boolean;
  expectedLift: number;
  confidence: number;
  dataPoints: number;
  message: string;
  channels: string;
  status: string;
}> {
  const recs: Array<{
    id: string;
    locationId: string;
    menuItemId: string;
    type: string;
    triggerType: string;
    triggerCondition: string;
    currentlyActive: boolean;
    expectedLift: number;
    confidence: number;
    dataPoints: number;
    message: string;
    channels: string;
    status: string;
  }> = [];

  const templates: Array<{
    itemName: string;
    type: string;
    triggerType: string;
    triggerCondition: string;
    active: boolean;
    lift: number;
    message: string;
  }> = [
    {
      itemName: 'Hot Chocolate',
      type: 'promote',
      triggerType: 'weather',
      triggerCondition: 'temperature < 45',
      active: true,
      lift: 42,
      message: 'Hot Chocolate sales jump 42% when temps drop below 45°F. Feature it on your signage today — rain is in the forecast.',
    },
    {
      itemName: 'Iced Coffee',
      type: 'promote',
      triggerType: 'temperature',
      triggerCondition: 'temperature > 65',
      active: false,
      lift: 55,
      message: 'Iced Coffee demand spikes 55% on warm days. Pre-batch cold brew when forecast shows 65°F+.',
    },
    {
      itemName: 'Apple Fritter',
      type: 'upsell',
      triggerType: 'weather',
      triggerCondition: 'rainy + cold',
      active: true,
      lift: 18,
      message: 'Apple Fritters pair well with hot drinks on cold rainy days. Train cashiers to suggest the combo — $1.20 avg ticket lift.',
    },
    {
      itemName: 'Drip Coffee',
      type: 'timing',
      triggerType: 'daypart',
      triggerCondition: 'breakfast (6-10am)',
      active: true,
      lift: 65,
      message: 'Drip Coffee dominates mornings with 65% higher sales 6-10am. Ensure full pots are ready by 5:45am to capture early commuters.',
    },
    {
      itemName: 'Salted Caramel Crunch',
      type: 'promote',
      triggerType: 'daypart',
      triggerCondition: 'afternoon (2-5pm)',
      active: false,
      lift: 32,
      message: 'Salted Caramel Crunch sees a 32% lift during afternoon hours. Position near register for impulse buys during the 2-5pm window.',
    },
    {
      itemName: 'Maple Bacon',
      type: 'promote',
      triggerType: 'day_of_week',
      triggerCondition: 'weekend (Sat-Sun)',
      active: true,
      lift: 42,
      message: 'Maple Bacon donut sales are 42% higher on weekends. Increase prep by 50% on Saturdays to avoid sell-outs by noon.',
    },
    {
      itemName: 'Boston Cream',
      type: 'upsell',
      triggerType: 'weather',
      triggerCondition: 'rainy',
      active: true,
      lift: 15,
      message: 'Boston Cream is a comfort pick on rainy days (+15%). Have cashiers offer it as an add-on with coffee orders.',
    },
    {
      itemName: 'Matcha Glazed',
      type: 'promote',
      triggerType: 'trend',
      triggerCondition: 'rising 14-day trend',
      active: true,
      lift: 25,
      message: 'Matcha Glazed is trending up 25% over 14 days. Consider a social media post highlighting it — momentum is building.',
    },
  ];

  for (const tmpl of templates) {
    const item = menuItems.find((m) => m.name === tmpl.itemName);
    if (!item) continue;
    recs.push({
      id: crypto.randomUUID(),
      locationId,
      menuItemId: item.id,
      type: tmpl.type,
      triggerType: tmpl.triggerType,
      triggerCondition: tmpl.triggerCondition,
      currentlyActive: tmpl.active,
      expectedLift: tmpl.lift,
      confidence: Math.round(randomBetween(0.75, 0.94) * 100) / 100,
      dataPoints: randomInt(90, 280),
      message: tmpl.message,
      channels: 'pos,email',
      status: 'active',
    });
  }

  return recs;
}

// ─── Daily summary generation ─────────────────────────────
function generateDailySummary(
  locationId: string,
  date: Date,
  dayOrders: Array<{ order: { total: number; itemCount: number } }>,
  topMenuItems: MenuItemWithId[],
  weather: WeatherHour[],
): {
  locationId: string;
  date: string;
  totalSales: number;
  orderCount: number;
  topItems: string;
  laborCostPct: number;
  prevWeekSales: number;
  prevWeekOrders: number;
  changePercent: number;
  weatherNote: string;
  summary: string;
} {
  const dateStr = date.toISOString().slice(0, 10);
  const totalSales = Math.round(dayOrders.reduce((s, o) => s + o.order.total, 0) * 100) / 100;
  const orderCount = dayOrders.length;

  // Simulate prev week being ~5-15% different
  const changeDir = seededRandom() > 0.4 ? 1 : -1;
  const changeMag = randomBetween(3, 14);
  const prevWeekSales = Math.round(totalSales / (1 + changeDir * changeMag / 100) * 100) / 100;
  const prevWeekOrders = Math.round(orderCount / (1 + changeDir * changeMag / 100));

  // Top items by frequency
  const topItemNames = topMenuItems.slice(0, 5).map((m) => m.name);

  // Weather summary
  const avgTemp = Math.round(weather.reduce((s, w) => s + w.temperature, 0) / weather.length);
  const hadRain = weather.some((w) => w.conditions === 'rain' || w.conditions === 'drizzle');
  const weatherNote = hadRain
    ? `Rain throughout the day, avg ${avgTemp}°F. Hot beverage sales elevated.`
    : `Mostly dry, avg ${avgTemp}°F. Standard traffic patterns observed.`;

  const changePercent = Math.round(changeDir * changeMag * 10) / 10;
  const upDown = changePercent > 0 ? 'up' : 'down';
  const summary = `${date.toLocaleDateString('en-US', { weekday: 'long' })}: $${totalSales.toLocaleString()} in sales across ${orderCount} orders (${upDown} ${Math.abs(changePercent)}% vs last week). Top sellers: ${topItemNames.join(', ')}. ${weatherNote}`;

  return {
    locationId,
    date: dateStr,
    totalSales,
    orderCount,
    topItems: JSON.stringify(topItemNames),
    laborCostPct: Math.round(randomBetween(22, 32) * 10) / 10,
    prevWeekSales,
    prevWeekOrders,
    changePercent,
    weatherNote,
    summary,
  };
}

// ─── Alert generation ─────────────────────────────────────
function generateAlerts(
  locationId: string,
  locationName: string,
): Array<{
  id: string;
  locationId: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  data: string;
  createdAt: Date;
}> {
  const now = new Date();
  return [
    {
      id: crypto.randomUUID(),
      locationId,
      type: 'opportunity',
      severity: 'info',
      title: 'Weather Opportunity: Hot Beverages',
      message: `Rain forecasted for ${locationName} today. Historical data shows 28-42% lift in hot beverage sales during rain. Consider featuring Hot Chocolate and Lattes on signage.`,
      data: JSON.stringify({ trigger: 'weather_forecast', items: ['Hot Chocolate', 'Latte', 'Americano'] }),
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
    },
    {
      id: crypto.randomUUID(),
      locationId,
      type: 'anomaly',
      severity: 'warning',
      title: 'Apple Fritter Stock Warning',
      message: `${locationName} sold through Apple Fritters 45 min earlier than usual today. Weekend demand is 35% above weekday average. Consider increasing weekend prep batch by 50%.`,
      data: JSON.stringify({ item: 'Apple Fritter', sellOutTime: '11:15 AM', avgSellOutTime: '12:00 PM' }),
      createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000), // 5 hours ago
    },
    {
      id: crypto.randomUUID(),
      locationId,
      type: 'opportunity',
      severity: 'info',
      title: 'Matcha Glazed Trending Up',
      message: `Matcha Glazed donut sales at ${locationName} have increased 25% over the past 14 days. This emerging trend could be amplified with social media promotion.`,
      data: JSON.stringify({ item: 'Matcha Glazed', trendDirection: 'up', trendPeriod: '14d', trendMagnitude: 25 }),
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 1 day ago
    },
  ];
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

export async function seedDemoOrganization(brandConfig: DemoBrandConfig): Promise<{
  organizationId: string;
  locationCount: number;
  menuItemCount: number;
  orderCount: number;
  demoUserEmail: string;
  demoUserPassword: string;
}> {
  // Reset RNG for reproducibility
  _seed = 2024;

  // 1. Clear any existing demo data first
  await clearDemoData();

  // 2. Create demo organization
  const org = await prisma.organization.create({
    data: {
      id: DEMO_ORG_ID,
      name: brandConfig.brandName,
      isDemo: true,
    },
  });

  // 3. Create demo user
  const tempPassword = `demo-${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await prisma.user.create({
    data: {
      id: `demo-user-${DEMO_ORG_ID}`,
      email: DEMO_USER_EMAIL,
      passwordHash,
      name: 'Demo User',
      role: 'OWNER',
      organizationId: org.id,
      emailVerified: true,
    },
  });

  // 4. Create locations
  const locationRecords = [];
  for (let i = 0; i < brandConfig.locations.length; i++) {
    const loc = brandConfig.locations[i];
    const locationId = `demo-loc-${i.toString().padStart(2, '0')}`;
    const record = await prisma.location.create({
      data: {
        id: locationId,
        organizationId: org.id,
        name: loc.name,
        address: loc.address,
        lat: loc.lat,
        lng: loc.lng,
        timezone: loc.timezone,
      },
    });
    locationRecords.push(record);
  }

  // 5. Create menu items per location (batched)
  const allMenuItems: Map<string, MenuItemWithId[]> = new Map();
  for (const location of locationRecords) {
    const items: MenuItemWithId[] = [];
    const menuItemData = brandConfig.menuItems.map((mi, i) => {
      const menuItemId = `demo-mi-${location.id}-${i.toString().padStart(2, '0')}`;
      items.push({ id: menuItemId, name: mi.name, category: mi.category, price: mi.price });
      return {
        id: menuItemId,
        locationId: location.id,
        name: mi.name,
        category: mi.category,
        price: mi.price,
        active: true,
      };
    });
    await prisma.menuItem.createMany({ data: menuItemData });
    allMenuItems.set(location.id, items);
  }

  // 6. Generate 30 days of data per location
  let totalOrders = 0;
  const now = new Date();

  for (let locIdx = 0; locIdx < locationRecords.length; locIdx++) {
    const location = locationRecords[locIdx];
    const menuItems = allMenuItems.get(location.id)!;
    console.log(`  Seeding location ${locIdx + 1}/${locationRecords.length}: ${location.name}`);

    for (let daysAgo = DAYS_OF_DATA; daysAgo >= 0; daysAgo--) {
      const date = new Date(now);
      date.setDate(date.getDate() - daysAgo);
      date.setHours(0, 0, 0, 0);

      // Generate weather for this day
      const weatherHours = generateVancouverWeather(date);

      // Insert weather snapshots
      const weatherData = weatherHours.map((wx, hourIdx) => {
        const ts = new Date(date);
        ts.setHours(5 + hourIdx, 0, 0, 0);
        return {
          id: crypto.randomUUID(),
          locationId: location.id,
          timestamp: ts,
          temperature: wx.temperature,
          conditions: wx.conditions,
          precipitation: wx.precipitation,
          humidity: wx.humidity,
          windSpeed: wx.windSpeed,
        };
      });

      // Batch insert weather
      await prisma.weatherSnapshot.createMany({ data: weatherData });

      // Generate orders
      const dayOrders = generateOrdersForDay(date, location.id, menuItems, weatherHours, brandConfig, locIdx);
      totalOrders += dayOrders.length;

      // Batch insert orders and order items
      if (dayOrders.length > 0) {
        await prisma.order.createMany({ data: dayOrders.map(d => d.order) });
        const allItems = dayOrders.flatMap(d => d.items);
        // Insert order items in chunks of 500 to avoid query size limits
        for (let chunk = 0; chunk < allItems.length; chunk += 500) {
          await prisma.orderItem.createMany({ data: allItems.slice(chunk, chunk + 500) });
        }
      }

      // Generate daily summary
      const summaryData = generateDailySummary(location.id, date, dayOrders, menuItems, weatherHours);
      await prisma.dailySummary.create({ data: summaryData });
    }

    // 7. Generate AI patterns for this location
    const patterns = generateAIPatterns(location.id, menuItems);
    if (patterns.length > 0) {
      await prisma.aIPattern.createMany({ data: patterns });
    }

    // 8. Generate recommendations for this location
    const recs = generateRecommendations(location.id, menuItems);
    if (recs.length > 0) {
      await prisma.recommendation.createMany({ data: recs });
    }

    // 9. Generate alerts (only for first 3 locations to keep it realistic)
    if (locIdx < 3) {
      const alerts = generateAlerts(location.id, location.name);
      if (alerts.length > 0) {
        await prisma.alert.createMany({ data: alerts });
      }
    }
  }

  return {
    organizationId: org.id,
    locationCount: locationRecords.length,
    menuItemCount: brandConfig.menuItems.length * locationRecords.length,
    orderCount: totalOrders,
    demoUserEmail: DEMO_USER_EMAIL,
    demoUserPassword: tempPassword,
  };
}

export async function clearDemoData(): Promise<{ deleted: boolean }> {
  // Find all demo organizations
  const demoOrgs = await prisma.organization.findMany({
    where: { isDemo: true },
    select: { id: true },
  });

  if (demoOrgs.length === 0) {
    return { deleted: false };
  }

  const orgIds = demoOrgs.map((o) => o.id);

  // Find all locations belonging to demo orgs
  const demoLocations = await prisma.location.findMany({
    where: { organizationId: { in: orgIds } },
    select: { id: true },
  });
  const locationIds = demoLocations.map((l) => l.id);

  if (locationIds.length > 0) {
    // Find all menu items for these locations
    const demoMenuItems = await prisma.menuItem.findMany({
      where: { locationId: { in: locationIds } },
      select: { id: true },
    });
    const menuItemIds = demoMenuItems.map((m) => m.id);

    // Find all orders for these locations
    const demoOrders = await prisma.order.findMany({
      where: { locationId: { in: locationIds } },
      select: { id: true },
    });
    const orderIds = demoOrders.map((o) => o.id);

    // Delete in correct order (deepest relations first)
    if (orderIds.length > 0) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    }
    if (menuItemIds.length > 0) {
      await prisma.recommendation.deleteMany({ where: { menuItemId: { in: menuItemIds } } });
      await prisma.aIPattern.deleteMany({ where: { menuItemId: { in: menuItemIds } } });
    }
    await prisma.order.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.weatherSnapshot.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.dailySummary.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.alert.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.syncLog.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.staffShift.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.laborRecommendation.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.laborTarget.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.menuItem.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.location.deleteMany({ where: { organizationId: { in: orgIds } } });
  }

  // Delete demo users and orgs
  await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });

  return { deleted: true };
}

export async function swapDemoBrand(brandSlug: string): Promise<{
  organizationId: string;
  locationCount: number;
  menuItemCount: number;
  orderCount: number;
  demoUserEmail: string;
  demoUserPassword: string;
}> {
  const config = getBrandConfig(brandSlug);
  if (!config) {
    throw new Error(`Unknown brand: ${brandSlug}. Available: ${Object.keys(getBrandConfig).length > 0 ? 'check registry' : 'none'}`);
  }
  return seedDemoOrganization(config);
}

export async function getDemoStatus(): Promise<{
  active: boolean;
  organization?: { id: string; name: string; createdAt: Date };
  locationCount: number;
  menuItemCount: number;
  orderCount: number;
  userEmail?: string;
}> {
  const demoOrg = await prisma.organization.findFirst({
    where: { isDemo: true },
    include: {
      locations: {
        select: { id: true },
      },
      users: {
        select: { email: true },
      },
    },
  });

  if (!demoOrg) {
    return { active: false, locationCount: 0, menuItemCount: 0, orderCount: 0 };
  }

  const locationIds = demoOrg.locations.map((l) => l.id);
  const menuItemCount = locationIds.length > 0
    ? await prisma.menuItem.count({ where: { locationId: { in: locationIds } } })
    : 0;
  const orderCount = locationIds.length > 0
    ? await prisma.order.count({ where: { locationId: { in: locationIds } } })
    : 0;

  return {
    active: true,
    organization: {
      id: demoOrg.id,
      name: demoOrg.name,
      createdAt: demoOrg.createdAt,
    },
    locationCount: demoOrg.locations.length,
    menuItemCount,
    orderCount,
    userEmail: demoOrg.users[0]?.email,
  };
}
