import prisma from '../db/client';
import { logger } from '../utils/logger';
import { getBeforeAfterSnippet } from './analytics';
import { getUpcomingEvents } from '../integrations/events';
import { getDaypart, getDayName } from '../utils/dayparts';

export interface TopItem {
  name: string;
  quantity: number;
  revenue: number;
}

export interface PromoRecommendation {
  itemName: string;
  message: string;
  expectedLift: number;
  triggerType: string;
  triggerCondition: string;
  promoSuggestion: string;
}

export interface UpsellTip {
  baseItem: string;
  suggestItem: string;
  reason: string;
}

export interface StaffingNote {
  message: string;
  action: string;
}

export interface SummaryData {
  locationId: string;
  locationName: string;
  date: string;
  totalSales: number;
  orderCount: number;
  topItems: TopItem[];
  laborCostPct: number | null;
  prevWeekSales: number | null;
  prevWeekOrders: number | null;
  changePercent: number | null;
  weatherNote: string | null;
  weatherImpactNote: string | null;
  topRecommendation: string | null;
  beforeAfterSnippet: string | null;
  upcomingEvents: string | null;
  // New digest fields
  promoRecommendations: PromoRecommendation[];
  upsellTip: UpsellTip | null;
  staffingNote: StaffingNote | null;
  underperformers: Array<{ name: string; soldYesterday: number; avgSold: number }>;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function generatePromoSuggestion(itemName: string, triggerType: string, triggerCondition: string): string {
  const cond = triggerCondition.toLowerCase();
  switch (triggerType) {
    case 'weather':
      if (cond.includes('rain') || cond.includes('drizzle') || cond.includes('snow'))
        return `Comfort food promo: Feature ${itemName} prominently — "Warm up with our ${itemName}"`;
      if (cond.includes('clear') || cond.includes('sunny'))
        return `Good weather play: Pair ${itemName} with a cold drink combo`;
      return `Push ${itemName} today — conditions favor it`;
    case 'temperature':
      if (cond.includes('< 60') || cond.includes('cold'))
        return `Cold day comfort: Promote ${itemName} as a warming treat`;
      if (cond.includes('> 85') || cond.includes('hot'))
        return `Beat the heat: Feature ${itemName} with iced drinks`;
      return `Good conditions for ${itemName} — give it prime menu placement`;
    case 'daypart':
      return `Feature ${itemName} during ${cond} — it historically outperforms`;
    case 'day_of_week':
      return `${cond} special: ${itemName} does well today — consider a bundle deal`;
    case 'trend':
      if (cond.includes('up'))
        return `${itemName} is trending up — ride the momentum with extra visibility`;
      return `${itemName} needs a push — consider a limited-time offer`;
    default:
      return `Feature ${itemName} today — AI sees an opportunity`;
  }
}

export async function generateDailySummary(locationId: string, date: Date = new Date()): Promise<SummaryData> {
  const location = await prisma.location.findUnique({ where: { id: locationId } });

  if (!location) {
    throw new Error(`Location ${locationId} not found`);
  }

  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  // Get today's orders
  const orders = await prisma.order.findMany({
    where: {
      locationId,
      timestamp: { gte: dayStart, lte: dayEnd },
    },
    include: { orderItems: { include: { menuItem: true } } },
  });

  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  const orderCount = orders.length;

  // Top 3 selling items by quantity
  const itemMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const order of orders) {
    for (const item of order.orderItems) {
      const existing = itemMap.get(item.menuItemId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue += item.amount;
      } else {
        itemMap.set(item.menuItemId, {
          name: item.menuItem.name,
          quantity: item.quantity,
          revenue: item.amount,
        });
      }
    }
  }
  const topItems = Array.from(itemMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 3);

  // Same day last week comparison
  const lastWeekDate = new Date(date);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeekStart = startOfDay(lastWeekDate);
  const lastWeekEnd = endOfDay(lastWeekDate);

  const lastWeekOrders = await prisma.order.findMany({
    where: {
      locationId,
      timestamp: { gte: lastWeekStart, lte: lastWeekEnd },
    },
  });

  const prevWeekSales = lastWeekOrders.reduce((sum, o) => sum + o.total, 0);
  const prevWeekOrders = lastWeekOrders.length;
  const changePercent = prevWeekSales > 0
    ? ((totalSales - prevWeekSales) / prevWeekSales) * 100
    : null;

  // Weather note from latest snapshot
  const weatherSnapshot = await prisma.weatherSnapshot.findFirst({
    where: {
      locationId,
      timestamp: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { timestamp: 'desc' },
  });

  // If no snapshot today, get the most recent one (for forecasting purposes)
  const latestWeather = weatherSnapshot ?? await prisma.weatherSnapshot.findFirst({
    where: { locationId },
    orderBy: { timestamp: 'desc' },
  });

  let weatherNote: string | null = null;
  let weatherImpactNote: string | null = null;
  if (latestWeather) {
    weatherNote = `${latestWeather.conditions}, ${Math.round(latestWeather.temperature)}°F, ${latestWeather.precipitation > 0 ? `${latestWeather.precipitation}mm precip` : 'no precipitation'}`;

    const cond = latestWeather.conditions.toLowerCase();
    const temp = latestWeather.temperature;
    const impacts: string[] = [];
    if (cond.includes('rain') || cond.includes('drizzle')) impacts.push('rain reducing foot traffic (~-10%)');
    if (cond.includes('snow') || cond.includes('blizzard')) impacts.push('snow significantly reducing traffic (~-20%)');
    if (cond.includes('thunder') || cond.includes('storm')) impacts.push('storms keeping customers home (~-15%)');
    if (cond.includes('sunny') || cond.includes('clear')) impacts.push('clear skies boosting patio/walk-in traffic (~+5%)');
    if (temp < 25) impacts.push('extreme cold suppressing dine-in (~-15%)');
    else if (temp > 95) impacts.push('extreme heat shifting orders to delivery (~-10%)');
    if (cond.includes('rain') || cond.includes('snow') || cond.includes('storm')) {
      impacts.push('comfort food promos recommended');
    }
    weatherImpactNote = impacts.length > 0 ? impacts.join('; ') : 'Normal weather — no significant impact expected';
  }

  // ─── PROMO RECOMMENDATIONS (top 3 active for today's conditions) ───
  const promoRecommendations: PromoRecommendation[] = [];
  try {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeekNum = now.getDay();
    const currentDaypart = getDaypart(hour);
    const currentDayName = getDayName(dayOfWeekNum);
    const temperature = latestWeather?.temperature ?? null;
    const weatherCondition = latestWeather?.conditions ?? null;

    const activeRecs = await prisma.recommendation.findMany({
      where: { locationId, status: 'active' },
      include: { menuItem: true },
      orderBy: { expectedLift: 'desc' },
    });

    // Filter to ones matching current conditions
    for (const rec of activeRecs) {
      if (promoRecommendations.length >= 3) break;
      let matches = false;
      switch (rec.triggerType) {
        case 'temperature':
          if (temperature !== null) {
            if (rec.triggerCondition === 'temp < 60') matches = temperature < 60;
            else if (rec.triggerCondition === 'temp 60-75') matches = temperature >= 60 && temperature < 75;
            else if (rec.triggerCondition === 'temp 75-85') matches = temperature >= 75 && temperature < 85;
            else if (rec.triggerCondition === 'temp > 85') matches = temperature >= 85;
          }
          break;
        case 'weather':
          matches = weatherCondition?.toLowerCase() === rec.triggerCondition.toLowerCase();
          break;
        case 'daypart':
          matches = currentDaypart === rec.triggerCondition;
          break;
        case 'day_of_week':
          matches = currentDayName === rec.triggerCondition;
          break;
        case 'trend':
          matches = true; // Always relevant
          break;
      }
      if (matches) {
        promoRecommendations.push({
          itemName: rec.menuItem.name,
          message: rec.message,
          expectedLift: rec.expectedLift,
          triggerType: rec.triggerType,
          triggerCondition: rec.triggerCondition,
          promoSuggestion: generatePromoSuggestion(rec.menuItem.name, rec.triggerType, rec.triggerCondition),
        });
      }
    }

    // If no condition-matched promos, grab top 2 by expected lift anyway
    if (promoRecommendations.length === 0 && activeRecs.length > 0) {
      for (const rec of activeRecs.slice(0, 2)) {
        promoRecommendations.push({
          itemName: rec.menuItem.name,
          message: rec.message,
          expectedLift: rec.expectedLift,
          triggerType: rec.triggerType,
          triggerCondition: rec.triggerCondition,
          promoSuggestion: generatePromoSuggestion(rec.menuItem.name, rec.triggerType, rec.triggerCondition),
        });
      }
    }
  } catch (err) {
    logger.warn('DailySummary', `Failed to get promo recommendations for ${location.name}`, err);
  }

  // ─── UPSELL TIP (from AI patterns — item correlations) ───
  let upsellTip: UpsellTip | null = null;
  try {
    // Find the highest-lift pairing pattern
    const pairPattern = await prisma.aIPattern.findFirst({
      where: { locationId, patternType: { in: ['item_pair', 'upsell', 'cross_sell', 'combo'] } },
      orderBy: { liftPercent: 'desc' },
      include: { menuItem: true },
    });

    if (pairPattern) {
      // The trigger condition often contains the paired item name
      upsellTip = {
        baseItem: pairPattern.menuItem.name,
        suggestItem: pairPattern.triggerCondition,
        reason: `Historically ${pairPattern.liftPercent.toFixed(0)}% lift when paired (${pairPattern.dataPoints} data points)`,
      };
    }

    // Fallback: find top seller and suggest highest-margin add-on
    if (!upsellTip && topItems.length > 0) {
      // Get all items sorted by margin potential (price as proxy)
      const allItems = await prisma.menuItem.findMany({
        where: { locationId, active: true },
        orderBy: { price: 'desc' },
        take: 20,
      });

      // Find a different-category item to suggest with the top seller
      const topCategory = topItems[0].name;
      const addon = allItems.find(i =>
        i.name !== topItems[0].name &&
        i.price >= 2 && i.price <= 8 // Good add-on price range
      );
      if (addon) {
        upsellTip = {
          baseItem: topItems[0].name,
          suggestItem: addon.name,
          reason: `Suggest "${addon.name}" ($${addon.price.toFixed(2)}) with every "${topItems[0].name}" order — easy ticket bump`,
        };
      }
    }
  } catch (err) {
    logger.warn('DailySummary', `Failed to get upsell tip for ${location.name}`, err);
  }

  // ─── STAFFING NOTE (weather + forecast impact on traffic) ───
  let staffingNote: StaffingNote | null = null;
  try {
    if (latestWeather) {
      const cond = latestWeather.conditions.toLowerCase();
      const temp = latestWeather.temperature;

      if (cond.includes('rain') || cond.includes('drizzle')) {
        staffingNote = {
          message: 'Rain forecast — expect 10-15% lower foot traffic than normal',
          action: 'Consider sending one person home after the lunch rush if it stays slow',
        };
      } else if (cond.includes('snow') || cond.includes('blizzard')) {
        staffingNote = {
          message: 'Snow/storm expected — foot traffic could drop 20-30%',
          action: 'Run a skeleton crew after morning rush. Focus on delivery/pickup promos',
        };
      } else if (cond.includes('sunny') || cond.includes('clear')) {
        if (temp >= 70 && temp <= 85) {
          staffingNote = {
            message: 'Beautiful weather — expect higher than normal foot traffic',
            action: 'Make sure you\'re fully staffed through the afternoon. Patio/outdoor seating will be busy',
          };
        } else if (temp > 85) {
          staffingNote = {
            message: 'Hot day ahead — dine-in may dip but cold drinks/delivery will spike',
            action: 'Staff up the drink station. Consider running a cold drink special',
          };
        } else {
          staffingNote = {
            message: 'Clear skies but cool — steady, normal traffic expected',
            action: 'Standard staffing should be fine today',
          };
        }
      } else if (temp < 25) {
        staffingNote = {
          message: 'Extreme cold — dine-in will be significantly down',
          action: 'Minimal staff for dine-in. Push delivery and warm comfort items',
        };
      }

      // Day-of-week adjustment
      const dow = date.getDay();
      if (dow === 0 || dow === 6) {
        if (!staffingNote) {
          staffingNote = {
            message: 'Weekend — typically higher traffic than weekdays',
            action: 'Ensure full team is scheduled, especially around brunch hours',
          };
        } else {
          staffingNote.message += ' (weekend — typically busier)';
        }
      } else if (dow === 1) {
        if (!staffingNote) {
          staffingNote = {
            message: 'Monday — typically the slowest day of the week',
            action: 'Lean staffing is fine. Good day for training or deep cleaning',
          };
        }
      }
    }

    if (!staffingNote) {
      staffingNote = {
        message: 'Normal conditions expected',
        action: 'Standard staffing should be fine today',
      };
    }
  } catch (err) {
    logger.warn('DailySummary', `Failed to get staffing note for ${location.name}`, err);
  }

  // ─── UNDERPERFORMERS (items that sold way below their average) ───
  const underperformers: Array<{ name: string; soldYesterday: number; avgSold: number }> = [];
  try {
    if (orderCount > 0) {
      // Get 30-day average for each item
      const thirtyDaysAgo = new Date(date);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentItems = await prisma.orderItem.groupBy({
        by: ['menuItemId'],
        where: {
          order: {
            locationId,
            timestamp: { gte: thirtyDaysAgo, lte: dayEnd },
          },
        },
        _sum: { quantity: true },
      });

      const avgDays = 30;
      for (const ri of recentItems) {
        const avgDaily = (ri._sum.quantity ?? 0) / avgDays;
        if (avgDaily < 2) continue; // Skip items with very low volume

        const todayQty = itemMap.get(ri.menuItemId)?.quantity ?? 0;

        // Flag if yesterday was less than 30% of the average
        if (todayQty < avgDaily * 0.3 && avgDaily >= 3) {
          const menuItem = await prisma.menuItem.findUnique({ where: { id: ri.menuItemId } });
          if (menuItem) {
            underperformers.push({
              name: menuItem.name,
              soldYesterday: todayQty,
              avgSold: Math.round(avgDaily),
            });
          }
        }
      }

      // Sort by biggest gap, take top 3
      underperformers.sort((a, b) => (b.avgSold - b.soldYesterday) - (a.avgSold - a.soldYesterday));
      underperformers.splice(3);
    }
  } catch (err) {
    logger.warn('DailySummary', `Failed to get underperformers for ${location.name}`, err);
  }

  // Top AI recommendation (legacy field — keep for backward compat)
  let topRecommendation: string | null = null;
  if (promoRecommendations.length > 0) {
    const top = promoRecommendations[0];
    topRecommendation = `${top.triggerType.toUpperCase()}: ${top.itemName} — ${top.message} (expected +${top.expectedLift.toFixed(0)}%)`;
  } else {
    try {
      const topRec = await prisma.recommendation.findFirst({
        where: { locationId, currentlyActive: true },
        orderBy: { expectedLift: 'desc' },
        include: { menuItem: true },
      });
      if (topRec) {
        topRecommendation = `${topRec.type.toUpperCase()}: ${topRec.menuItem.name} — ${topRec.message} (expected +${topRec.expectedLift.toFixed(0)}%)`;
      }
    } catch {
      // Non-critical
    }
  }

  // Before/after comparison snippet
  const beforeAfterSnippet = await getBeforeAfterSnippet(locationId);

  // Upcoming events
  let upcomingEvents: string | null = null;
  try {
    const events = getUpcomingEvents(location.lat, location.lng, 7);
    if (events.length > 0) {
      upcomingEvents = events.map(e => `${e.date}: ${e.name} (${e.impact_multiplier > 1 ? '+' : ''}${Math.round((e.impact_multiplier - 1) * 100)}%)`).join(', ');
    }
  } catch {
    // Non-critical
  }

  const dateStr = dayStart.toISOString().split('T')[0];

  const summaryData: SummaryData = {
    locationId,
    locationName: location.name,
    date: dateStr,
    totalSales: Math.round(totalSales * 100) / 100,
    orderCount,
    topItems,
    laborCostPct: null,
    prevWeekSales: prevWeekSales > 0 ? Math.round(prevWeekSales * 100) / 100 : null,
    prevWeekOrders: prevWeekOrders > 0 ? prevWeekOrders : null,
    changePercent: changePercent !== null ? Math.round(changePercent * 10) / 10 : null,
    weatherNote,
    weatherImpactNote,
    topRecommendation,
    beforeAfterSnippet,
    upcomingEvents,
    promoRecommendations,
    upsellTip,
    staffingNote,
    underperformers,
  };

  // Build human-readable summary
  const lines: string[] = [
    `Daily Summary for ${location.name} — ${dateStr}`,
    `Total Sales: $${summaryData.totalSales.toFixed(2)} | Orders: ${orderCount}`,
  ];
  if (topItems.length > 0) {
    lines.push(`Top Items: ${topItems.map(i => `${i.name} (${i.quantity})`).join(', ')}`);
  }
  if (changePercent !== null) {
    const direction = changePercent >= 0 ? 'up' : 'down';
    lines.push(`vs Last Week: ${direction} ${Math.abs(changePercent).toFixed(1)}% ($${prevWeekSales.toFixed(2)})`);
  }
  if (weatherNote) lines.push(`Weather: ${weatherNote}`);
  if (weatherImpactNote) lines.push(`Weather Impact: ${weatherImpactNote}`);
  if (promoRecommendations.length > 0) {
    lines.push(`Today's Promo: ${promoRecommendations[0].promoSuggestion}`);
  }
  if (upsellTip) {
    lines.push(`Upsell Tip: ${upsellTip.reason}`);
  }
  if (staffingNote) {
    lines.push(`Staffing: ${staffingNote.message} — ${staffingNote.action}`);
  }
  if (underperformers.length > 0) {
    lines.push(`Underperformers: ${underperformers.map(u => `${u.name} (${u.soldYesterday} vs ${u.avgSold} avg)`).join(', ')}`);
  }
  if (topRecommendation) lines.push(`Top AI Rec: ${topRecommendation}`);
  if (beforeAfterSnippet) lines.push(beforeAfterSnippet);
  if (upcomingEvents) lines.push(`Upcoming Events: ${upcomingEvents}`);
  const summary = lines.join('\n');

  // Persist to DB
  await prisma.dailySummary.upsert({
    where: { locationId_date: { locationId, date: dateStr } },
    create: {
      locationId,
      date: dateStr,
      totalSales: summaryData.totalSales,
      orderCount,
      topItems: JSON.stringify(topItems),
      laborCostPct: null,
      prevWeekSales: summaryData.prevWeekSales,
      prevWeekOrders: summaryData.prevWeekOrders,
      changePercent: summaryData.changePercent,
      weatherNote,
      summary,
    },
    update: {
      totalSales: summaryData.totalSales,
      orderCount,
      topItems: JSON.stringify(topItems),
      prevWeekSales: summaryData.prevWeekSales,
      prevWeekOrders: summaryData.prevWeekOrders,
      changePercent: summaryData.changePercent,
      weatherNote,
      summary,
    },
  });

  logger.info('DailySummary', `Generated summary for ${location.name} on ${dateStr}`);
  logger.info('DailySummary', summary);

  return summaryData;
}

export async function generateAllDailySummaries(date: Date = new Date()): Promise<void> {
  const locations = await prisma.location.findMany();
  logger.info('DailySummary', `Generating daily summaries for ${locations.length} locations`);

  for (const location of locations) {
    try {
      await generateDailySummary(location.id, date);
    } catch (err) {
      logger.error('DailySummary', `Failed to generate summary for ${location.name}`, err);
    }
  }

  logger.info('DailySummary', 'All daily summaries complete');
}
