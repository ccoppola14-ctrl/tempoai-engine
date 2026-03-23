import type { SummaryData } from './daily-summary';
export declare function sendDailySummary(to: string, summary: SummaryData, locationName: string): Promise<{
    success: boolean;
    id?: string;
    error?: string;
}>;
export declare function sendWelcomeEmail(to: string, name: string, tempPassword: string, verificationToken: string): Promise<{
    success: boolean;
    id?: string;
    error?: string;
}>;
export declare function sendNewLeadNotification(lead: {
    name: string;
    email: string;
    phone: string;
    restaurant: string;
    locations: string;
    pos: string;
    notes: string;
}): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function sendPasswordResetEmail(to: string, name: string, resetToken: string): Promise<{
    success: boolean;
    id?: string;
    error?: string;
}>;
export declare function sendVerificationEmail(to: string, name: string, verificationToken: string): Promise<{
    success: boolean;
    id?: string;
    error?: string;
}>;
export declare function buildMockSummary(): SummaryData;
//# sourceMappingURL=email.d.ts.map