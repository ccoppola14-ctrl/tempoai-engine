import { type SummaryData } from './daily-summary';
export declare function formatSMS(summary: SummaryData, forecastSales?: number, forecastNote?: string): string;
export interface EmailSummary {
    subject: string;
    summary: SummaryData;
    forecast: {
        today_predicted_sales: number;
        today_predicted_orders: number;
        today_confidence: number;
        weather_impact: string | null;
        week_outlook: Array<{
            date: string;
            predicted_sales: number;
            predicted_orders: number;
        }>;
    } | null;
    charts_data: {
        daily_revenue_7d: Array<{
            date: string;
            revenue: number;
        }>;
        top_items: Array<{
            name: string;
            quantity: number;
            revenue: number;
        }>;
    };
}
export declare function formatEmail(summary: SummaryData, locationId: string): Promise<EmailSummary>;
export interface NotificationResult {
    sms: string;
    email: EmailSummary;
    summary: SummaryData;
}
export declare function generateNotification(locationId: string, date?: Date): Promise<NotificationResult>;
//# sourceMappingURL=notifications.d.ts.map