import prisma from '../db/client';
import { logger } from '../utils/logger';
import { getDaypart, getDaypartLabel, DAYPARTS, type Daypart } from '../utils/dayparts';
import { generateForecast } from './forecasting';
import { getEventImpactForDate } from '../integrations/events';

// Dayparts relevant for labor analysis (skip early_morning and afternoon as they're
// typically low-traffic and roll into adjacent service periods)
const LABOR_DAYPARTS = ['breakfast', 'lunch', 'dinner', 'late_night'] as const;

// Industry benchmark defaults (used when no LaborTarget exists)
const DEFAULT_TARGETS: Record<string, { laborPct: number; minStaff: number; maxStaff: number; revenuePerHour: number }> = {
  breakfast:  { laborPct: 25, minStaff: 2, maxStaff: 6,  revenuePerHour: 65 },
  lunch:      { laborPct: 28, minStaff: 3, maxStaff: 10, revenuePerHour: 75 },
  dinner:     { laborPct: 30, minStaff: 4, maxStaff: 12, revenuePerHour: 85 },
  late_night: { laborPct: 25, minStaff: 2, maxStaff: 5,  revenuePerHour: 55 },
};

function getDaypartHours(daypart: string): number {
  const dp = DAYPARTS.find(d => d.name === daypart);
  if (!dp) return 3;
  if (dp.endHour > dp.startHour) return dp.endHour - dp.startHour;
  return (24 - dp.startHour) + dp.endHour; // wraps midnight
}

function classifyOrderDaypart(timestamp: Date): string {
  const hour = timestamp.getHours();
  const dp = getDaypart(hour);
  // Consolidate early_morning → breakfast, afternoon → lunch for labor analysis
  if (dp === 'early_morning') return 'breakfast';
  if (dp === 'afternoon') return 'lunch';
  return dp;
}

interface DaypartAnalysis {
  daypart: string;
  label: string;
  staffCount: number;
  laborHours: number;
  laborCost: number;
  revenue: number;
  laborPct: number;
  revenuePerLaborHour: number;
  overstaffed: boolean;
  understaffed: boolean;
  wastedHours: number;
  wastedCost: number;
  missedRevenue: number;
}

interface LaborAnalysis {
  locationId: string;
  periodDays: number;
  totalRevenue: number;
  totalLaborCost: number;
  totalLaborPct: number;
  totalWastedCost: number;
  totalMissedRevenue: number;
  avgDailyLaborCost: number;
  avgDailyWaste: number;
  bestDay: { date: string; laborPct: number } | null;
  worstDay: { date: string; laborPct: number } | null;
  byDaypart: DaypartAnalysis[];
  dailyBreakdown: Array<{
    date: string;
    dayOfWeek: string;
    revenue: number;
    laborCost: number;
    laborPct: number;
    wastedCost: number;
    dayparts: DaypartAnalysis[];
  }>;
}

/**
 * Analyze labor efficiency over a period.
 */
export async function analyzeLaborEfficiency(locationId: string, days = 30): Promise<LaborAnalysis> {
  logger.info('Labor', `Analyzing labor efficiency for ${locationId} (${days} days)`);

  const since = new Date();
  since.setDate(since.getDate() - days);

  const [shifts, orders, targets] = await Promise.all([
    prisma.staffShift.findMany({
      where: { locationId, startTime: { gte: since } },
      orderBy: { startTime: 'asc' },
    }),
    prisma.order.findMany({
      where: { locationId, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
    }),
    prisma.laborTarget.findMany({ where: { locationId } }),
  ]);

  // Build target lookup: key = "dayOfWeek-daypart"
  const targetMap = new Map<string, typeof targets[0]>();
  for (const t of targets) {
    targetMap.set(`${t.dayOfWeek}-${t.daypart}`, t);
  }

  // Group orders by date+daypart
  const revenueByDateDaypart = new Map<string, number>();
  const revenueByDate = new Map<string, number>();
  for (const order of orders) {
    const date = order.timestamp.toISOString().split('T')[0];
    const dp = classifyOrderDaypart(order.timestamp);
    const key = `${date}-${dp}`;
    revenueByDateDaypart.set(key, (revenueByDateDaypart.get(key) || 0) + order.total);
    revenueByDate.set(date, (revenueByDate.get(date) || 0) + order.total);
  }

  // Group shifts by date+daypart
  const shiftsByDateDaypart = new Map<string, typeof shifts>();
  for (const shift of shifts) {
    const date = shift.startTime.toISOString().split('T')[0];
    const dp = classifyOrderDaypart(shift.startTime);
    const key = `${date}-${dp}`;
    if (!shiftsByDateDaypart.has(key)) shiftsByDateDaypart.set(key, []);
    shiftsByDateDaypart.get(key)!.push(shift);
  }

  // Collect all unique dates
  const allDates = new Set<string>();
  for (const order of orders) allDates.add(order.timestamp.toISOString().split('T')[0]);
  for (const shift of shifts) allDates.add(shift.startTime.toISOString().split('T')[0]);
  const sortedDates = [...allDates].sort();

  let totalRevenue = 0;
  let totalLaborCost = 0;
  let totalWastedCost = 0;
  let totalMissedRevenue = 0;

  const daypartAggregates: Record<string, { staffCount: number; laborHours: number; laborCost: number; revenue: number; wastedHours: number; wastedCost: number; missedRevenue: number; count: number }> = {};
  for (const dp of LABOR_DAYPARTS) {
    daypartAggregates[dp] = { staffCount: 0, laborHours: 0, laborCost: 0, revenue: 0, wastedHours: 0, wastedCost: 0, missedRevenue: 0, count: 0 };
  }

  const dailyBreakdown: LaborAnalysis['dailyBreakdown'] = [];
  let bestDay: { date: string; laborPct: number } | null = null;
  let worstDay: { date: string; laborPct: number } | null = null;

  for (const date of sortedDates) {
    const dow = new Date(date + 'T12:00:00Z').getDay();
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];
    let dayRevenue = 0;
    let dayLaborCost = 0;
    let dayWastedCost = 0;
    const dayDayparts: DaypartAnalysis[] = [];

    for (const dp of LABOR_DAYPARTS) {
      const key = `${date}-${dp}`;
      const dpShifts = shiftsByDateDaypart.get(key) || [];
      const dpRevenue = revenueByDateDaypart.get(key) || 0;

      const staffCount = dpShifts.length;
      const laborHours = dpShifts.reduce((sum, s) => sum + s.totalHours, 0);
      const avgRate = dpShifts.length > 0
        ? dpShifts.reduce((sum, s) => sum + (s.hourlyRate || 15), 0) / dpShifts.length
        : 15;
      const laborCost = dpShifts.reduce((sum, s) => sum + (s.totalCost || s.totalHours * 15), 0);

      const target = targetMap.get(`${dow}-${dp}`);
      const targetLaborPct = target?.targetLaborPct ?? DEFAULT_TARGETS[dp]?.laborPct ?? 28;
      const revenuePerHour = target?.revenuePerStaffHour ?? DEFAULT_TARGETS[dp]?.revenuePerHour ?? 75;

      const laborPct = dpRevenue > 0 ? (laborCost / dpRevenue) * 100 : 0;
      const revenuePerLaborHour = laborHours > 0 ? dpRevenue / laborHours : 0;

      // Calculate optimal staff count for this daypart
      const dpHours = getDaypartHours(dp);
      const optimalStaff = dpRevenue > 0
        ? Math.max(
            target?.minStaff ?? DEFAULT_TARGETS[dp]?.minStaff ?? 2,
            Math.min(
              target?.maxStaff ?? DEFAULT_TARGETS[dp]?.maxStaff ?? 10,
              Math.ceil(dpRevenue / (revenuePerHour * dpHours))
            )
          )
        : target?.minStaff ?? DEFAULT_TARGETS[dp]?.minStaff ?? 2;

      const overstaffed = staffCount > optimalStaff;
      const understaffed = staffCount > 0 && staffCount < optimalStaff;

      const wastedHours = overstaffed ? (staffCount - optimalStaff) * dpHours : 0;
      const wastedCost = wastedHours * avgRate;
      const missedRevenue = understaffed ? (optimalStaff - staffCount) * revenuePerHour * dpHours : 0;

      const analysis: DaypartAnalysis = {
        daypart: dp,
        label: getDaypartLabel(dp as Daypart),
        staffCount,
        laborHours,
        laborCost,
        revenue: dpRevenue,
        laborPct: Math.round(laborPct * 10) / 10,
        revenuePerLaborHour: Math.round(revenuePerLaborHour * 100) / 100,
        overstaffed,
        understaffed,
        wastedHours,
        wastedCost: Math.round(wastedCost * 100) / 100,
        missedRevenue: Math.round(missedRevenue * 100) / 100,
      };

      dayDayparts.push(analysis);
      dayRevenue += dpRevenue;
      dayLaborCost += laborCost;
      dayWastedCost += wastedCost;

      // Aggregate by daypart
      if (dpShifts.length > 0 || dpRevenue > 0) {
        daypartAggregates[dp].staffCount += staffCount;
        daypartAggregates[dp].laborHours += laborHours;
        daypartAggregates[dp].laborCost += laborCost;
        daypartAggregates[dp].revenue += dpRevenue;
        daypartAggregates[dp].wastedHours += wastedHours;
        daypartAggregates[dp].wastedCost += wastedCost;
        daypartAggregates[dp].missedRevenue += missedRevenue;
        daypartAggregates[dp].count += 1;
      }
    }

    const dayLaborPct = dayRevenue > 0 ? (dayLaborCost / dayRevenue) * 100 : 0;

    dailyBreakdown.push({
      date,
      dayOfWeek: dayName,
      revenue: Math.round(dayRevenue * 100) / 100,
      laborCost: Math.round(dayLaborCost * 100) / 100,
      laborPct: Math.round(dayLaborPct * 10) / 10,
      wastedCost: Math.round(dayWastedCost * 100) / 100,
      dayparts: dayDayparts,
    });

    totalRevenue += dayRevenue;
    totalLaborCost += dayLaborCost;
    totalWastedCost += dayWastedCost;
    totalMissedRevenue += dayDayparts.reduce((sum, d) => sum + d.missedRevenue, 0);

    if (dayRevenue > 0 && dayLaborCost > 0) {
      if (!bestDay || dayLaborPct < bestDay.laborPct) bestDay = { date, laborPct: Math.round(dayLaborPct * 10) / 10 };
      if (!worstDay || dayLaborPct > worstDay.laborPct) worstDay = { date, laborPct: Math.round(dayLaborPct * 10) / 10 };
    }
  }

  const totalLaborPct = totalRevenue > 0 ? (totalLaborCost / totalRevenue) * 100 : 0;
  const daysWithData = sortedDates.length || 1;

  const byDaypart: DaypartAnalysis[] = LABOR_DAYPARTS.map(dp => {
    const agg = daypartAggregates[dp];
    const count = agg.count || 1;
    return {
      daypart: dp,
      label: getDaypartLabel(dp as Daypart),
      staffCount: Math.round(agg.staffCount / count),
      laborHours: Math.round(agg.laborHours * 10) / 10,
      laborCost: Math.round(agg.laborCost * 100) / 100,
      revenue: Math.round(agg.revenue * 100) / 100,
      laborPct: agg.revenue > 0 ? Math.round((agg.laborCost / agg.revenue) * 1000) / 10 : 0,
      revenuePerLaborHour: agg.laborHours > 0 ? Math.round((agg.revenue / agg.laborHours) * 100) / 100 : 0,
      overstaffed: agg.wastedCost > agg.missedRevenue,
      understaffed: agg.missedRevenue > agg.wastedCost,
      wastedHours: Math.round(agg.wastedHours * 10) / 10,
      wastedCost: Math.round(agg.wastedCost * 100) / 100,
      missedRevenue: Math.round(agg.missedRevenue * 100) / 100,
    };
  });

  return {
    locationId,
    periodDays: days,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalLaborCost: Math.round(totalLaborCost * 100) / 100,
    totalLaborPct: Math.round(totalLaborPct * 10) / 10,
    totalWastedCost: Math.round(totalWastedCost * 100) / 100,
    totalMissedRevenue: Math.round(totalMissedRevenue * 100) / 100,
    avgDailyLaborCost: Math.round((totalLaborCost / daysWithData) * 100) / 100,
    avgDailyWaste: Math.round((totalWastedCost / daysWithData) * 100) / 100,
    bestDay,
    worstDay,
    byDaypart,
    dailyBreakdown,
  };
}

interface DaypartRecommendation {
  daypart: string;
  label: string;
  predictedRevenue: number;
  recommendedStaff: number;
  currentScheduled: number | null;
  delta: number | null;
  estimatedSavings: number;
  reasoning: string;
}

interface StaffingRecommendation {
  date: string;
  dayOfWeek: string;
  totalPredictedRevenue: number;
  totalRecommendedStaff: number;
  dayparts: DaypartRecommendation[];
}

/**
 * Generate staffing recommendation for a specific date.
 */
export async function generateStaffingRecommendation(locationId: string, targetDate: string): Promise<StaffingRecommendation> {
  logger.info('Labor', `Generating staffing recommendation for ${locationId} on ${targetDate}`);

  const targetDateObj = new Date(targetDate + 'T12:00:00Z');
  const dow = targetDateObj.getDay();
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];

  // Get labor targets
  const targets = await prisma.laborTarget.findMany({
    where: { locationId, dayOfWeek: dow },
  });
  const targetMap = new Map<string, typeof targets[0]>();
  for (const t of targets) targetMap.set(t.daypart, t);

  // Get forecast — generateForecast returns 7 days from tomorrow
  const forecasts = await generateForecast(locationId);
  const dayForecast = forecasts.find(f => f.date === targetDate);
  const predictedDailySales = dayForecast?.predictedSales ?? 0;

  // Get event impact
  const eventImpact = getEventImpactForDate(targetDate);

  // Get historical same-day patterns for daypart revenue distribution
  const historicalSince = new Date();
  historicalSince.setDate(historicalSince.getDate() - 90);
  const historicalOrders = await prisma.order.findMany({
    where: {
      locationId,
      timestamp: { gte: historicalSince },
    },
  });

  // Calculate daypart revenue distribution from history
  const dpRevenue: Record<string, number> = {};
  let totalHistoricalRevenue = 0;
  const sameDayOrders = historicalOrders.filter(o => o.timestamp.getDay() === dow);
  for (const order of sameDayOrders) {
    const dp = classifyOrderDaypart(order.timestamp);
    dpRevenue[dp] = (dpRevenue[dp] || 0) + order.total;
    totalHistoricalRevenue += order.total;
  }

  // Default distribution if no history
  const defaultDistribution: Record<string, number> = {
    breakfast: 0.15,
    lunch: 0.35,
    dinner: 0.40,
    late_night: 0.10,
  };

  // Check if we have existing shifts scheduled for this date
  const dateStart = new Date(targetDate + 'T00:00:00Z');
  const dateEnd = new Date(targetDate + 'T23:59:59Z');
  const existingShifts = await prisma.staffShift.findMany({
    where: { locationId, startTime: { gte: dateStart, lte: dateEnd } },
  });

  const dayparts: DaypartRecommendation[] = [];
  let totalRecommendedStaff = 0;

  for (const dp of LABOR_DAYPARTS) {
    const target = targetMap.get(dp);
    const defaults = DEFAULT_TARGETS[dp] || DEFAULT_TARGETS.lunch;
    const revenuePerHour = target?.revenuePerStaffHour ?? defaults.revenuePerHour;
    const minStaff = target?.minStaff ?? defaults.minStaff;
    const maxStaff = target?.maxStaff ?? defaults.maxStaff;

    // Estimate daypart revenue from total daily prediction
    const dpShare = totalHistoricalRevenue > 0
      ? (dpRevenue[dp] || 0) / totalHistoricalRevenue
      : defaultDistribution[dp] || 0.25;
    const predictedDpRevenue = predictedDailySales * dpShare;

    // Calculate recommended staff
    const dpHours = getDaypartHours(dp);
    const rawStaff = predictedDpRevenue > 0
      ? Math.ceil(predictedDpRevenue / (revenuePerHour * dpHours))
      : minStaff;
    const recommendedStaff = Math.max(minStaff, Math.min(maxStaff, rawStaff));

    // Check current scheduled staff for this daypart
    const dpDef = DAYPARTS.find(d => d.name === dp);
    const dpShifts = dpDef ? existingShifts.filter(s => {
      const hour = s.startTime.getHours();
      return classifyOrderDaypart(s.startTime) === dp;
    }) : [];
    const currentScheduled = dpShifts.length > 0 ? dpShifts.length : null;

    const delta = currentScheduled !== null ? recommendedStaff - currentScheduled : null;

    // Estimate savings (if overstaffed) or cost of understaffing
    let estimatedSavings = 0;
    if (delta !== null && delta < 0) {
      // Currently overstaffed: savings from reducing
      estimatedSavings = Math.abs(delta) * dpHours * 15; // assume $15/hr avg
    }

    // Build reasoning
    const reasons: string[] = [];
    reasons.push(`Predicted ${getDaypartLabel(dp as Daypart).toLowerCase()} revenue: $${Math.round(predictedDpRevenue)}`);
    reasons.push(`At $${revenuePerHour}/staff-hour over ${dpHours}hrs → ${recommendedStaff} staff needed`);
    if (eventImpact.event) {
      reasons.push(`Event: ${eventImpact.event.name} (${Math.round((eventImpact.multiplier - 1) * 100)}% impact)`);
    }
    if (currentScheduled !== null && delta !== null) {
      if (delta > 0) reasons.push(`Currently ${Math.abs(delta)} staff short`);
      else if (delta < 0) reasons.push(`Currently ${Math.abs(delta)} staff over — save ~$${Math.round(estimatedSavings)}`);
      else reasons.push('Staffing looks optimal');
    }

    dayparts.push({
      daypart: dp,
      label: getDaypartLabel(dp as Daypart),
      predictedRevenue: Math.round(predictedDpRevenue * 100) / 100,
      recommendedStaff,
      currentScheduled,
      delta,
      estimatedSavings: Math.round(estimatedSavings * 100) / 100,
      reasoning: reasons.join('. ') + '.',
    });

    totalRecommendedStaff += recommendedStaff;
  }

  return {
    date: targetDate,
    dayOfWeek: dayName,
    totalPredictedRevenue: Math.round(predictedDailySales * 100) / 100,
    totalRecommendedStaff,
    dayparts,
  };
}

/**
 * Generate a full week staffing plan.
 */
export async function generateWeeklyLaborPlan(locationId: string, startDate: string): Promise<{
  locationId: string;
  startDate: string;
  endDate: string;
  days: StaffingRecommendation[];
  summary: {
    totalRecommendedHours: number;
    estimatedLaborCost: number;
    targetLaborPct: number;
    totalPredictedRevenue: number;
    potentialSavings: number;
  };
}> {
  logger.info('Labor', `Generating weekly labor plan for ${locationId} starting ${startDate}`);

  const days: StaffingRecommendation[] = [];
  let totalRecommendedHours = 0;
  let totalPredictedRevenue = 0;
  let totalSavings = 0;

  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate + 'T12:00:00Z');
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];

    const recommendation = await generateStaffingRecommendation(locationId, dateStr);
    days.push(recommendation);

    totalPredictedRevenue += recommendation.totalPredictedRevenue;
    for (const dp of recommendation.dayparts) {
      totalRecommendedHours += dp.recommendedStaff * getDaypartHours(dp.daypart);
      totalSavings += dp.estimatedSavings;
    }
  }

  const estimatedLaborCost = totalRecommendedHours * 15; // avg $15/hr
  const targetLaborPct = totalPredictedRevenue > 0
    ? Math.round((estimatedLaborCost / totalPredictedRevenue) * 1000) / 10
    : 0;

  const endDate = new Date(startDate + 'T12:00:00Z');
  endDate.setDate(endDate.getDate() + 6);

  return {
    locationId,
    startDate,
    endDate: endDate.toISOString().split('T')[0],
    days,
    summary: {
      totalRecommendedHours: Math.round(totalRecommendedHours * 10) / 10,
      estimatedLaborCost: Math.round(estimatedLaborCost * 100) / 100,
      targetLaborPct,
      totalPredictedRevenue: Math.round(totalPredictedRevenue * 100) / 100,
      potentialSavings: Math.round(totalSavings * 100) / 100,
    },
  };
}

/**
 * Calculate labor waste — the money shot.
 * Shows how much was wasted on overstaffing in the last N days.
 */
export async function calculateLaborWaste(locationId: string, days = 30): Promise<{
  locationId: string;
  periodDays: number;
  totalWastedHours: number;
  totalWastedDollars: number;
  avgDailyWaste: number;
  totalMissedRevenue: number;
  byDaypart: Array<{
    daypart: string;
    label: string;
    wastedHours: number;
    wastedDollars: number;
    missedRevenue: number;
    trend: string;
  }>;
  worstDays: Array<{
    date: string;
    dayOfWeek: string;
    wastedDollars: number;
    reason: string;
  }>;
  recommendation: string;
}> {
  logger.info('Labor', `Calculating labor waste for ${locationId} (${days} days)`);

  const analysis = await analyzeLaborEfficiency(locationId, days);

  // Find the 5 worst days by waste
  const worstDays = analysis.dailyBreakdown
    .filter(d => d.wastedCost > 0)
    .sort((a, b) => b.wastedCost - a.wastedCost)
    .slice(0, 5)
    .map(d => {
      const worstDp = d.dayparts
        .filter(dp => dp.wastedCost > 0)
        .sort((a, b) => b.wastedCost - a.wastedCost)[0];
      return {
        date: d.date,
        dayOfWeek: d.dayOfWeek,
        wastedDollars: d.wastedCost,
        reason: worstDp
          ? `${worstDp.label} overstaffed by ${worstDp.staffCount - Math.round(worstDp.revenue / (worstDp.revenuePerLaborHour || 75))} staff`
          : 'General overstaffing',
      };
    });

  const byDaypart = analysis.byDaypart.map(dp => ({
    daypart: dp.daypart,
    label: dp.label,
    wastedHours: dp.wastedHours,
    wastedDollars: dp.wastedCost,
    missedRevenue: dp.missedRevenue,
    trend: dp.overstaffed ? 'overstaffed' : dp.understaffed ? 'understaffed' : 'balanced',
  }));

  // Build recommendation message
  const monthlyWaste = Math.round(analysis.totalWastedCost * (30 / (days || 1)));
  const annualWaste = monthlyWaste * 12;
  let recommendation = `You wasted an estimated $${Math.round(analysis.totalWastedCost)} on overstaffing in the last ${days} days.`;
  if (monthlyWaste > 500) {
    recommendation += ` That's ~$${monthlyWaste}/month or ~$${annualWaste}/year in preventable labor costs.`;
  }
  if (analysis.totalMissedRevenue > 0) {
    recommendation += ` You also missed an estimated $${Math.round(analysis.totalMissedRevenue)} in revenue from understaffing.`;
  }
  const worstDaypart = byDaypart.sort((a, b) => b.wastedDollars - a.wastedDollars)[0];
  if (worstDaypart && worstDaypart.wastedDollars > 0) {
    recommendation += ` Your biggest opportunity: optimize ${worstDaypart.label.toLowerCase()} staffing.`;
  }

  // Persist recommendations
  for (const day of analysis.dailyBreakdown) {
    for (const dp of day.dayparts) {
      if (dp.wastedCost > 0 || dp.missedRevenue > 0) {
        try {
          await prisma.laborRecommendation.create({
            data: {
              locationId,
              date: day.date,
              daypart: dp.daypart,
              currentStaff: dp.staffCount,
              recommendedStaff: dp.overstaffed
                ? dp.staffCount - Math.round(dp.wastedHours / getDaypartHours(dp.daypart))
                : dp.staffCount + Math.round(dp.missedRevenue / ((dp.revenuePerLaborHour || 75) * getDaypartHours(dp.daypart))),
              overstaffed: dp.overstaffed,
              wastedHours: dp.wastedHours,
              wastedCost: dp.wastedCost,
              missedRevenue: dp.missedRevenue > 0 ? dp.missedRevenue : null,
              confidence: 0.7,
              reasoning: dp.overstaffed
                ? `Overstaffed by ${Math.round(dp.wastedHours / getDaypartHours(dp.daypart))} during ${dp.label.toLowerCase()}. Wasted $${Math.round(dp.wastedCost)}.`
                : `Understaffed — missed ~$${Math.round(dp.missedRevenue)} in potential revenue during ${dp.label.toLowerCase()}.`,
            },
          });
        } catch {
          // Ignore duplicates
        }
      }
    }
  }

  return {
    locationId,
    periodDays: days,
    totalWastedHours: Math.round(analysis.byDaypart.reduce((sum, dp) => sum + dp.wastedHours, 0) * 10) / 10,
    totalWastedDollars: Math.round(analysis.totalWastedCost * 100) / 100,
    avgDailyWaste: analysis.avgDailyWaste,
    totalMissedRevenue: Math.round(analysis.totalMissedRevenue * 100) / 100,
    byDaypart,
    worstDays,
    recommendation,
  };
}

/**
 * Seed default labor targets for a location.
 */
export async function seedDefaultLaborTargets(locationId: string): Promise<number> {
  logger.info('Labor', `Seeding default labor targets for ${locationId}`);
  let count = 0;

  for (let dow = 0; dow < 7; dow++) {
    for (const [dp, defaults] of Object.entries(DEFAULT_TARGETS)) {
      try {
        await prisma.laborTarget.upsert({
          where: {
            locationId_dayOfWeek_daypart: { locationId, dayOfWeek: dow, daypart: dp },
          },
          create: {
            locationId,
            dayOfWeek: dow,
            daypart: dp,
            targetLaborPct: defaults.laborPct,
            minStaff: defaults.minStaff,
            maxStaff: defaults.maxStaff,
            revenuePerStaffHour: defaults.revenuePerHour,
          },
          update: {},
        });
        count++;
      } catch {
        // Ignore
      }
    }
  }

  logger.info('Labor', `Seeded ${count} labor targets for ${locationId}`);
  return count;
}
