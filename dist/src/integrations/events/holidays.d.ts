/**
 * US federal holidays and major events that impact restaurant traffic.
 * Each event has a fixed or computed date and an impact multiplier category.
 */
export type EventImpactType = 'major_holiday' | 'local_sports' | 'concert_nearby' | 'school_event' | 'minor_holiday' | 'negative_impact';
export interface CalendarEvent {
    name: string;
    date: string;
    type: EventImpactType;
    impact_multiplier: number;
    description: string;
}
/**
 * Get upcoming events within `days` from now.
 * lat/lng are accepted for future PredictHQ integration but not used for the built-in calendar.
 */
export declare function getUpcomingEvents(_lat: number, _lng: number, days?: number): CalendarEvent[];
/**
 * Get the event impact multiplier for a specific date.
 * Returns the most impactful event's multiplier, or 1.0 (no impact).
 */
export declare function getEventImpactForDate(date: string): {
    multiplier: number;
    event: CalendarEvent | null;
};
/**
 * Impact multiplier range by event type — used for display/docs.
 */
export declare const EVENT_TYPE_RANGES: Record<EventImpactType, {
    min: number;
    max: number;
    label: string;
}>;
//# sourceMappingURL=holidays.d.ts.map