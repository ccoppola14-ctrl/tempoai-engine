import prisma from "../db/client";
import { generateDailySummary, type SummaryData } from "./daily-summary";
import { sendDailySummary } from "./email";
import { sendSMS } from "./sms";
import { formatSMS } from "./notifications";
import { generateForecast } from "./forecasting";
import { logger } from "../utils/logger";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


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
export async function runDailyDigest(): Promise<DigestResult[]> {
  const results: DigestResult[] = [];

  // Get all users who want at least one type of digest
  const users = await prisma.user.findMany({
    where: {
      OR: [{ digestEmail: true }, { digestSms: true }],
    },
    include: {
      organization: {
        include: {
          locations: true,
        },
      },
      assignedLocations: {
        include: { location: true },
      },
    },
  });

  logger.info("Digest", `Running daily digest for ${users.length} opted-in users`);

  for (const user of users) {
    const result: DigestResult = {
      userId: user.id,
      userName: user.name,
      email: user.digestEmail ? user.email : null,
      phone: user.digestSms ? user.phone : null,
      locations: 0,
      emailsSent: 0,
      emailsFailed: 0,
      smsSent: 0,
      smsFailed: 0,
    };

    // Determine which locations this user gets digests for
    let locations: { id: string; name: string }[];
    if (user.role === "MANAGER") {
      locations = user.assignedLocations.map((ul) => ul.location);
    } else if (user.role === "ADMIN") {
      // Admin gets all locations
      const allLocs = await prisma.location.findMany({ select: { id: true, name: true } });
      locations = allLocs;
    } else {
      // OWNER gets org locations
      locations = user.organization?.locations ?? [];
    }

    result.locations = locations.length;

    if (locations.length === 0) {
      logger.info("Digest", `Skipping ${user.name} — no locations`);
      results.push(result);
      continue;
    }

    // Generate summaries for yesterday (the day we are reporting on)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    for (const loc of locations) {
      try {
        const summary = await generateDailySummary(loc.id, yesterday);

        // Send email digest
        if (user.digestEmail && user.email) {
          try {
            const emailResult = await sendDailySummary(user.email, summary, loc.name);
            if (emailResult.success) {
              result.emailsSent++;
              logger.info("Digest", `Email sent to ${user.email} for ${loc.name}`);
              await delay(250); // Rate limit: Resend allows 5/sec
            } else {
              result.emailsFailed++;
              logger.error("Digest", `Email failed for ${user.email}/${loc.name}: ${emailResult.error}`);
            }
          } catch (err) {
            result.emailsFailed++;
            logger.error("Digest", `Email error for ${user.email}/${loc.name}`, err);
          }
        }

        // Send SMS digest
        if (user.digestSms && user.phone) {
          try {
            // Get forecast for SMS
            let forecastSales: number | undefined;
            let forecastNote: string | undefined;
            try {
              const forecasts = await generateForecast(loc.id);
              if (forecasts.length > 0) {
                forecastSales = forecasts[0].predictedSales;
                if (forecasts[0].factors.weather) {
                  const w = (forecasts[0].factors as any).weather;
                  forecastNote = w?.condition?.toLowerCase() ?? undefined;
                }
              }
            } catch {
              // Forecast optional
            }

            const smsBody = formatSMS(summary, forecastSales, forecastNote);
            const smsResult = await sendSMS(user.phone, smsBody);
            if (smsResult.success) {
              result.smsSent++;
              logger.info("Digest", `SMS sent to ${user.phone} for ${loc.name}`);
              await delay(250);
            } else {
              result.smsFailed++;
              logger.error("Digest", `SMS failed for ${user.phone}/${loc.name}: ${smsResult.error}`);
            }
          } catch (err) {
            result.smsFailed++;
            logger.error("Digest", `SMS error for ${user.phone}/${loc.name}`, err);
          }
        }
      } catch (err) {
        logger.error("Digest", `Failed to generate summary for ${loc.name}`, err);
      }
    }

    results.push(result);
  }

  const totalEmails = results.reduce((s, r) => s + r.emailsSent, 0);
  const totalSms = results.reduce((s, r) => s + r.smsSent, 0);
  logger.info("Digest", `Daily digest complete: ${totalEmails} emails, ${totalSms} SMS sent to ${results.length} users`);

  return results;
}

/**
 * Send a test digest to a specific email/phone for a given location.
 * Useful for demos and verifying the flow works.
 */
export async function sendTestDigest(
  locationId: string,
  options: { email?: string; phone?: string }
): Promise<{
  summary: SummaryData;
  smsText: string;
  emailSent: boolean;
  smsSent: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const summary = await generateDailySummary(locationId, yesterday);

  // Build SMS text
  let forecastSales: number | undefined;
  let forecastNote: string | undefined;
  try {
    const forecasts = await generateForecast(locationId);
    if (forecasts.length > 0) {
      forecastSales = forecasts[0].predictedSales;
    }
  } catch {
    // optional
  }

  const smsText = formatSMS(summary, forecastSales, forecastNote);

  let emailSent = false;
  let smsSent = false;

  if (options.email) {
    const result = await sendDailySummary(options.email, summary, summary.locationName);
    emailSent = result.success;
    if (!result.success) errors.push(`Email failed: ${result.error}`);
  }

  if (options.phone) {
    const result = await sendSMS(options.phone, smsText);
    smsSent = result.success;
    if (!result.success) errors.push(`SMS failed: ${result.error}`);
  }

  return { summary, smsText, emailSent, smsSent, errors };
}
