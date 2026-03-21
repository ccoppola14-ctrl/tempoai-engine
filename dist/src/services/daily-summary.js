"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDailySummary = generateDailySummary;
exports.generateAllDailySummaries = generateAllDailySummaries;
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
async function generateDailySummary(locationId, date = new Date()) {
    const location = await client_1.default.location.findUniqueOrThrow({ where: { id: locationId } });
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);
    // Get today's orders
    const orders = await client_1.default.order.findMany({
        where: {
            locationId,
            timestamp: { gte: dayStart, lte: dayEnd },
        },
        include: { orderItems: { include: { menuItem: true } } },
    });
    const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
    const orderCount = orders.length;
    // Top 3 selling items by quantity
    const itemMap = new Map();
    for (const order of orders) {
        for (const item of order.orderItems) {
            const existing = itemMap.get(item.menuItemId);
            if (existing) {
                existing.quantity += item.quantity;
                existing.revenue += item.amount;
            }
            else {
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
    const lastWeekOrders = await client_1.default.order.findMany({
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
    const weatherSnapshot = await client_1.default.weatherSnapshot.findFirst({
        where: {
            locationId,
            timestamp: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { timestamp: 'desc' },
    });
    let weatherNote = null;
    if (weatherSnapshot) {
        weatherNote = `${weatherSnapshot.conditions}, ${Math.round(weatherSnapshot.temperature)}°F, ${weatherSnapshot.precipitation > 0 ? `${weatherSnapshot.precipitation}mm precip` : 'no precipitation'}`;
    }
    const dateStr = dayStart.toISOString().split('T')[0];
    const summaryData = {
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
    const lines = [
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
    await client_1.default.dailySummary.upsert({
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
    logger_1.logger.info('DailySummary', `Generated summary for ${location.name} on ${dateStr}`);
    logger_1.logger.info('DailySummary', summary);
    return summaryData;
}
async function generateAllDailySummaries(date = new Date()) {
    const locations = await client_1.default.location.findMany();
    logger_1.logger.info('DailySummary', `Generating daily summaries for ${locations.length} locations`);
    for (const location of locations) {
        try {
            await generateDailySummary(location.id, date);
        }
        catch (err) {
            logger_1.logger.error('DailySummary', `Failed to generate summary for ${location.name}`, err);
        }
    }
    logger_1.logger.info('DailySummary', 'All daily summaries complete');
}
//# sourceMappingURL=daily-summary.js.map