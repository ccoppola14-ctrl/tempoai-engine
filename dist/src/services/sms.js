"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSMS = sendSMS;
const twilio_1 = __importDefault(require("twilio"));
const logger_1 = require("../utils/logger");
let client = null;
function getTwilioClient() {
    if (client)
        return client;
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
        logger_1.logger.warn("SMS", "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — SMS disabled");
        return null;
    }
    client = (0, twilio_1.default)(sid, token);
    return client;
}
function getFromNumber() {
    return process.env.TWILIO_FROM_NUMBER || "";
}
async function sendSMS(to, body) {
    const tw = getTwilioClient();
    const from = getFromNumber();
    if (!tw || !from) {
        logger_1.logger.warn("SMS", `SMS not configured — would have sent to ${to}: ${body.slice(0, 80)}...`);
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
        logger_1.logger.info("SMS", `Sent to ${normalized} (sid: ${message.sid})`);
        return { success: true, sid: message.sid };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger_1.logger.error("SMS", `Failed to send to ${normalized}: ${msg}`);
        return { success: false, error: msg };
    }
}
//# sourceMappingURL=sms.js.map