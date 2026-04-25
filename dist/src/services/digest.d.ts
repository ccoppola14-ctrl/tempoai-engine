import type { SummaryData } from "./daily-summary";
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
 * DISABLED: Digest service requires schema migration for:
 * - digestEmail, digestSms, digestHour fields on User model
 * - phone field on User model
 * - assignedLocations relation on User model
 *
 * Run the following Prisma migration to enable:
 * npx prisma migrate dev --name add_digest_preferences
 */
export declare function runDailyDigest(): Promise<DigestResult[]>;
export declare function sendTestDigest(_locationId: string, _options: {
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