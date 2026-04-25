import { logger } from "../utils/logger";
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
export async function runDailyDigest(): Promise<DigestResult[]> {
  logger.warn("Digest", "Digest service disabled - schema migration required");
  return [];
}

export async function sendTestDigest(
  _locationId: string,
  _options: { email?: string; phone?: string }
): Promise<{
  summary: SummaryData;
  smsText: string;
  emailSent: boolean;
  smsSent: boolean;
  errors: string[];
}> {
  logger.warn("Digest", "Test digest disabled - schema migration required");
  return {
    summary: {} as SummaryData,
    smsText: "",
    emailSent: false,
    smsSent: false,
    errors: ["Digest service temporarily disabled"],
  };
}
