import { type SummaryData } from "./daily-summary";
export interface DigestResult {
    userId: string;
    userName: string;
    email: string | null;
    phone: string | null;
    locations: number;
    emailsSent: number;
    emailsFailed: number;
    smsSent: number;
    smsFailed: number;
}
/**
 * Run daily digest for all users who are opted in.
 * For each user, generate summary for each of their accessible locations
 * and send via their preferred channels (email/SMS).
 */
export declare function runDailyDigest(): Promise<DigestResult[]>;
/**
 * Send a test digest to a specific email/phone for a given location.
 * Useful for demos and verifying the flow works.
 */
export declare function sendTestDigest(locationId: string, options: {
    email?: string;
    phone?: string;
}): Promise<{
    summary: SummaryData;
    smsText: string;
    emailSent: boolean;
    smsSent: boolean;
    errors: string[];
}>;
//# sourceMappingURL=digest.d.ts.map