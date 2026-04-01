import twilio from "twilio";
import { logger } from "../utils/logger";

let client: twilio.Twilio | null = null;

function getTwilioClient(): twilio.Twilio | null {
  if (client) return client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    logger.warn("SMS", "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — SMS disabled");
    return null;
  }
  client = twilio(sid, token);
  return client;
}

function getFromNumber(): string {
  return process.env.TWILIO_FROM_NUMBER || "";
}

export async function sendSMS(
  to: string,
  body: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  const tw = getTwilioClient();
  const from = getFromNumber();

  if (!tw || !from) {
    logger.warn("SMS", `SMS not configured — would have sent to ${to}: ${body.slice(0, 80)}...`);
    return { success: false, error: "Twilio not configured" };
  }

  // Normalize phone — ensure E.164
  let normalized = to.replace(/[^+\d]/g, "");
  if (!normalized.startsWith("+")) {
    normalized = "+1" + normalized; // Default to US
  }

  try {
    const message = await tw.messages.create({
      body,
      from,
      to: normalized,
    });
    logger.info("SMS", `Sent to ${normalized} (sid: ${message.sid})`);
    return { success: true, sid: message.sid };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("SMS", `Failed to send to ${normalized}: ${msg}`);
    return { success: false, error: msg };
  }
}
