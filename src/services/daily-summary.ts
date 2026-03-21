import prisma from '../db/client';
import { logger } from '../utils/logger';

export interface TopItem {
  name: string;
  quantity: number;
  revenue: number;
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

export async function generateDailySummary(locationId: string, date: Date = new Date()): Promise<SummaryData> {
  const location = await prisma.location.findUniqueOrThrow({ where: { id: locationId } });

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

  // Weather note from latest snapshot today
  const weatherSnapshot = await prisma.weatherSnapshot.findFirst({
    where: {
      locationId,
      timestamp: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { timestamp: 'desc' },
  });

  let weatherNote: string | null = null;
  if (weatherSnapshot) {
    weatherNote = `${weatherSnapshot.conditions}, ${Math.round(weatherSnapshot.temperature)}°F, ${weatherSnapshot.precipitation > 0 ? `${weatherSnapshot.precipitation}mm precip` : 'no precipitation'}`;
  }

  const dateStr = dayStart.toISOString().split('T')[0];

  const summaryData: SummaryData = {
    locationId,
    locationName: location.name,
    date: dateStr,
    totalSales: Math.round(totalSales * 100) / 100,
    orderCount,
    topItems,
    laborCostPct: null, // Labor data not yet available
    prevWeekSales: prevWeekSales > 0 ? Math.round(prevWeekSales * 100) / 100 : null,
    prevWeekOrders: prevWeekOrders > 0 ? prevWeekOrders : null,
    changePercent: changePercent !== null ? Math.round(changePercent * 10) / 10 : null,
    weatherNote,
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
  if (weatherNote) {
    lines.push(`Weather: ${weatherNote}`);
  }
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
