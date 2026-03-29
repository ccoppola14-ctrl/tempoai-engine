"use strict";
/**
 * US federal holidays and major events that impact restaurant traffic.
 * Each event has a fixed or computed date and an impact multiplier category.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_TYPE_RANGES = void 0;
exports.getUpcomingEvents = getUpcomingEvents;
exports.getEventImpactForDate = getEventImpactForDate;
/**
 * Get the Nth weekday of a month.
 * n=1 → first, n=-1 → last
 */
function nthWeekday(year, month, weekday, n) {
    if (n > 0) {
        const first = new Date(year, month, 1);
        const diff = (weekday - first.getDay() + 7) % 7;
        const day = 1 + diff + (n - 1) * 7;
        return new Date(year, month, day);
    }
    else {
        // Last occurrence
        const last = new Date(year, month + 1, 0); // last day of month
        const diff = (last.getDay() - weekday + 7) % 7;
        return new Date(year, month, last.getDate() - diff);
    }
}
function fmt(d) {
    return d.toISOString().split('T')[0];
}
/**
 * Generate all known events for a given year.
 */
function getEventsForYear(year) {
    const events = [];
    // ── US Federal Holidays ──
    events.push({
        name: "New Year's Day",
        date: `${year}-01-01`,
        type: 'major_holiday',
        impact_multiplier: 0.70, // Many restaurants closed or slow
        description: 'New Year\'s Day — lower traffic, many closures',
    });
    events.push({
        name: 'Martin Luther King Jr. Day',
        date: fmt(nthWeekday(year, 0, 1, 3)), // 3rd Monday Jan
        type: 'minor_holiday',
        impact_multiplier: 1.10,
        description: 'MLK Day — slight traffic boost (day off)',
    });
    events.push({
        name: "Presidents' Day",
        date: fmt(nthWeekday(year, 1, 1, 3)), // 3rd Monday Feb
        type: 'minor_holiday',
        impact_multiplier: 1.10,
        description: 'Presidents\' Day — slight traffic boost (day off)',
    });
    events.push({
        name: 'Memorial Day',
        date: fmt(nthWeekday(year, 4, 1, -1)), // Last Monday May
        type: 'major_holiday',
        impact_multiplier: 1.35,
        description: 'Memorial Day weekend — strong restaurant traffic',
    });
    events.push({
        name: 'Independence Day',
        date: `${year}-07-04`,
        type: 'major_holiday',
        impact_multiplier: 1.40,
        description: 'July 4th — peak summer dining and takeout',
    });
    events.push({
        name: 'Labor Day',
        date: fmt(nthWeekday(year, 8, 1, 1)), // 1st Monday Sep
        type: 'major_holiday',
        impact_multiplier: 1.35,
        description: 'Labor Day weekend — strong restaurant traffic',
    });
    events.push({
        name: 'Columbus Day',
        date: fmt(nthWeekday(year, 9, 1, 2)), // 2nd Monday Oct
        type: 'minor_holiday',
        impact_multiplier: 1.10,
        description: 'Columbus Day — slight traffic boost',
    });
    events.push({
        name: 'Veterans Day',
        date: `${year}-11-11`,
        type: 'minor_holiday',
        impact_multiplier: 1.10,
        description: 'Veterans Day — slight boost, many promos',
    });
    events.push({
        name: 'Thanksgiving',
        date: fmt(nthWeekday(year, 10, 4, 4)), // 4th Thursday Nov
        type: 'major_holiday',
        impact_multiplier: 0.60, // Most dine at home
        description: 'Thanksgiving — most restaurants closed or very slow',
    });
    // Day after Thanksgiving — big restaurant day
    const thanksgiving = nthWeekday(year, 10, 4, 4);
    const blackFriday = new Date(thanksgiving);
    blackFriday.setDate(blackFriday.getDate() + 1);
    events.push({
        name: 'Black Friday',
        date: fmt(blackFriday),
        type: 'major_holiday',
        impact_multiplier: 1.30,
        description: 'Black Friday — shoppers drive high restaurant traffic',
    });
    events.push({
        name: 'Christmas Eve',
        date: `${year}-12-24`,
        type: 'major_holiday',
        impact_multiplier: 1.25,
        description: 'Christmas Eve — strong dinner traffic',
    });
    events.push({
        name: 'Christmas Day',
        date: `${year}-12-25`,
        type: 'major_holiday',
        impact_multiplier: 0.50, // Most closed
        description: 'Christmas Day — most restaurants closed',
    });
    events.push({
        name: "New Year's Eve",
        date: `${year}-12-31`,
        type: 'major_holiday',
        impact_multiplier: 1.50,
        description: 'New Year\'s Eve — peak dinner & celebration traffic',
    });
    // ── Major Cultural / Sports Events ──
    // Super Bowl (typically first Sunday of February)
    const superBowlSunday = nthWeekday(year, 1, 0, 1); // 1st Sunday Feb
    events.push({
        name: 'Super Bowl Sunday',
        date: fmt(superBowlSunday),
        type: 'local_sports',
        impact_multiplier: 1.25,
        description: 'Super Bowl — huge takeout/delivery spike, wings & pizza',
    });
    // Valentine's Day
    events.push({
        name: "Valentine's Day",
        date: `${year}-02-14`,
        type: 'major_holiday',
        impact_multiplier: 1.45,
        description: 'Valentine\'s Day — top restaurant day, reservations maxed',
    });
    // St. Patrick's Day
    events.push({
        name: "St. Patrick's Day",
        date: `${year}-03-17`,
        type: 'minor_holiday',
        impact_multiplier: 1.20,
        description: 'St. Patrick\'s Day — bar and pub food spike',
    });
    // March Madness (mid-March to early April — we mark key weekends)
    events.push({
        name: 'March Madness (First Round)',
        date: fmt(nthWeekday(year, 2, 4, 3)), // 3rd Thursday Mar
        type: 'local_sports',
        impact_multiplier: 1.15,
        description: 'March Madness first round — sports bar traffic boost',
    });
    events.push({
        name: 'March Madness (Final Four)',
        date: fmt(nthWeekday(year, 3, 6, 1)), // 1st Saturday Apr
        type: 'local_sports',
        impact_multiplier: 1.20,
        description: 'Final Four weekend — strong sports bar & restaurant traffic',
    });
    // Easter (approximate — use algorithm)
    const easter = computeEaster(year);
    events.push({
        name: 'Easter Sunday',
        date: fmt(easter),
        type: 'major_holiday',
        impact_multiplier: 1.35,
        description: 'Easter — strong brunch and family dining',
    });
    // Cinco de Mayo
    events.push({
        name: 'Cinco de Mayo',
        date: `${year}-05-05`,
        type: 'minor_holiday',
        impact_multiplier: 1.20,
        description: 'Cinco de Mayo — Mexican restaurant & bar surge',
    });
    // Mother's Day (2nd Sunday May)
    events.push({
        name: "Mother's Day",
        date: fmt(nthWeekday(year, 4, 0, 2)),
        type: 'major_holiday',
        impact_multiplier: 1.50,
        description: 'Mother\'s Day — #1 restaurant day of the year',
    });
    // Father's Day (3rd Sunday June)
    events.push({
        name: "Father's Day",
        date: fmt(nthWeekday(year, 5, 0, 3)),
        type: 'major_holiday',
        impact_multiplier: 1.35,
        description: 'Father\'s Day — strong family dining traffic',
    });
    // Halloween
    events.push({
        name: 'Halloween',
        date: `${year}-10-31`,
        type: 'minor_holiday',
        impact_multiplier: 1.15,
        description: 'Halloween — early dinner rush, then family trick-or-treating',
    });
    // Back to School (late August)
    events.push({
        name: 'Back to School Week',
        date: `${year}-08-25`,
        type: 'school_event',
        impact_multiplier: 1.08,
        description: 'Back to school — family dining spike',
    });
    // Prom Season (late April/early May)
    events.push({
        name: 'Prom Season',
        date: `${year}-04-26`,
        type: 'school_event',
        impact_multiplier: 1.10,
        description: 'Prom season — upscale dining reservations spike',
    });
    // Graduation Season (late May)
    events.push({
        name: 'Graduation Season',
        date: `${year}-05-24`,
        type: 'school_event',
        impact_multiplier: 1.10,
        description: 'Graduation celebrations — family dining boost',
    });
    return events;
}
/**
 * Compute Easter date using the Anonymous Gregorian algorithm.
 */
function computeEaster(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
}
/**
 * Get upcoming events within `days` from now.
 * lat/lng are accepted for future PredictHQ integration but not used for the built-in calendar.
 */
function getUpcomingEvents(_lat, _lng, days = 14) {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + days);
    const todayStr = now.toISOString().split('T')[0];
    const cutoffStr = cutoff.toISOString().split('T')[0];
    // Gather events from current year and next year (in case we're near year boundary)
    const currentYear = now.getFullYear();
    const allEvents = [
        ...getEventsForYear(currentYear),
        ...getEventsForYear(currentYear + 1),
    ];
    return allEvents
        .filter(e => e.date >= todayStr && e.date <= cutoffStr)
        .sort((a, b) => a.date.localeCompare(b.date));
}
/**
 * Get the event impact multiplier for a specific date.
 * Returns the most impactful event's multiplier, or 1.0 (no impact).
 */
function getEventImpactForDate(date) {
    const year = parseInt(date.split('-')[0], 10);
    const events = [
        ...getEventsForYear(year),
        ...getEventsForYear(year - 1), // in case of year boundary
    ].filter(e => e.date === date);
    if (events.length === 0)
        return { multiplier: 1.0, event: null };
    // Return the event with the highest absolute impact
    const mostImpactful = events.reduce((best, e) => Math.abs(e.impact_multiplier - 1) > Math.abs(best.impact_multiplier - 1) ? e : best);
    return { multiplier: mostImpactful.impact_multiplier, event: mostImpactful };
}
/**
 * Impact multiplier range by event type — used for display/docs.
 */
exports.EVENT_TYPE_RANGES = {
    major_holiday: { min: 0.50, max: 1.50, label: 'Major Holiday' },
    local_sports: { min: 1.15, max: 1.25, label: 'Local Sports Event' },
    concert_nearby: { min: 1.10, max: 1.20, label: 'Concert / Large Event' },
    school_event: { min: 1.05, max: 1.10, label: 'School Event' },
    minor_holiday: { min: 1.10, max: 1.20, label: 'Minor Holiday' },
    negative_impact: { min: 0.80, max: 0.90, label: 'Negative Impact Event' },
};
//# sourceMappingURL=holidays.js.map