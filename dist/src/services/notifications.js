"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatSMS = formatSMS;
exports.formatEmail = formatEmail;
exports.generateNotification = generateNotification;
const daily_summary_1 = require("./daily-summary");
const forecasting_1 = require("./forecasting");
const logger_1 = require("../utils/logger");
// ─── SMS Format (< 300 chars, punchy) ────────────────────────────
function getDayName(dateStr) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date(dateStr + 'T12:00:00');
    return days[d.getDay()];
}
function formatSMS(summary, forecastSales, forecastNote) {
    const parts = [];
    // Yesterday's numbers
    const dayName = getDayName(summary.date);
    let mainLine = `Yesterday: $${Math.round(summary.totalSales).toLocaleString()}`;
    if (summary.changePercent !== null) {
        const sign = summary.changePercent >= 0 ? '+' : '';
        mainLine += ` (${sign}${summary.changePercent.toFixed(0)}% vs last ${dayName})`;
    }
    parts.push(mainLine);
    // Top seller
    if (summary.topItems.length > 0) {
        const top = summary.topItems[0];
        let topLine = `Top seller: ${top.name}`;
        if (summary.topItems.length > 1) {
            const pctOfTotal = summary.totalSales > 0
                ? Math.round((top.revenue / summary.totalSales) * 100)
                : 0;
            topLine += ` (${pctOfTotal}% of sales)`;
        }
        parts.push(topLine);
    }
    // Today's forecast
    if (forecastSales) {
        let fLine = `Today forecast: $${Math.round(forecastSales).toLocaleString()}`;
        if (forecastNote)
            fLine += ` (${forecastNote})`;
        parts.push(fLine);
    }
    // Weather impact shorthand
    if (summary.weatherImpactNote && !summary.weatherImpactNote.includes('no significant impact')) {
        const short = summary.weatherImpactNote.split(';')[0].trim();
        if (!parts.some(p => p.includes(short.slice(0, 10)))) {
            // Only add if not redundant with forecast note
        }
    }
    parts.push('-TempoAi');
    let sms = parts.join('. ');
    // Truncate to 300 chars if needed
    if (sms.length > 300) {
        sms = sms.slice(0, 297) + '...';
    }
    return sms;
}
async function formatEmail(summary, locationId) {
    // Get forecast for the week ahead
    let forecast = null;
    try {
        const forecasts = await (0, forecasting_1.generateForecast)(locationId);
        if (forecasts.length > 0) {
            const today = forecasts[0];
            forecast = {
                today_predicted_sales: today.predictedSales,
                today_predicted_orders: today.predictedOrders,
                today_confidence: today.confidence,
                weather_impact: today.factors.weather
                    ? `${today.factors.weather.condition}, ${today.factors.weather.temperature}°F (${today.factors.weather.impact > 0 ? '+' : ''}${today.factors.weather.impact}% impact)`
                    : null,
                week_outlook: forecasts.map(f => ({
                    date: f.date,
                    predicted_sales: f.predictedSales,
                    predicted_orders: f.predictedOrders,
                })),
            };
        }
    }
    catch (err) {
        logger_1.logger.warn('Notifications', `Forecast unavailable for email: ${err instanceof Error ? err.message : String(err)}`);
    }
    const subject = `TempoAi Daily: $${Math.round(summary.totalSales).toLocaleString()} — ${summary.locationName} — ${summary.date}`;
    return {
        subject,
        summary,
        forecast,
        charts_data: {
            daily_revenue_7d: [], // Populated by frontend from API
            top_items: summary.topItems,
        },
    };
}
async function generateNotification(locationId, date) {
    const summary = await (0, daily_summary_1.generateDailySummary)(locationId, date);
    // Get tomorrow's forecast for the SMS
    let forecastSales;
    let forecastNote;
    try {
        const forecasts = await (0, forecasting_1.generateForecast)(locationId);
        if (forecasts.length > 0) {
            forecastSales = forecasts[0].predictedSales;
            if (forecasts[0].factors.weather) {
                const w = forecasts[0].factors.weather;
                forecastNote = `${w.condition.toLowerCase()}`;
                if (summary.topRecommendation) {
                    forecastNote += ' → AI promos active';
                }
            }
        }
    }
    catch {
        // Forecast is optional for SMS
    }
    const sms = formatSMS(summary, forecastSales, forecastNote);
    const email = await formatEmail(summary, locationId);
    logger_1.logger.info('Notifications', `Generated notification for ${summary.locationName}: SMS ${sms.length} chars`);
    return { sms, email, summary };
}
//# sourceMappingURL=notifications.js.map