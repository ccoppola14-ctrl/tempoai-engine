"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDailyDigest = runDailyDigest;
exports.sendTestDigest = sendTestDigest;
const client_1 = __importDefault(require("../db/client"));
const daily_summary_1 = require("./daily-summary");
const email_1 = require("./email");
const sms_1 = require("./sms");
const notifications_1 = require("./notifications");
const forecasting_1 = require("./forecasting");
const logger_1 = require("../utils/logger");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Run daily digest for all users who are opted in.
 * For each user, generate summary for each of their accessible locations
 * and send via their preferred channels (email/SMS).
 */
async function runDailyDigest() {
    const results = [];
    // Get all users who want at least one type of digest
    const users = await client_1.default.user.findMany({
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
    logger_1.logger.info("Digest", `Running daily digest for ${users.length} opted-in users`);
    for (const user of users) {
        const result = {
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
        let locations;
        if (user.role === "MANAGER") {
            locations = user.assignedLocations.map((ul) => ul.location);
        }
        else if (user.role === "ADMIN") {
            // Admin gets all locations
            const allLocs = await client_1.default.location.findMany({ select: { id: true, name: true } });
            locations = allLocs;
        }
        else {
            // OWNER gets org locations
            locations = user.organization?.locations ?? [];
        }
        result.locations = locations.length;
        if (locations.length === 0) {
            logger_1.logger.info("Digest", `Skipping ${user.name} — no locations`);
            results.push(result);
            continue;
        }
        // Generate summaries for yesterday (the day we are reporting on)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        for (const loc of locations) {
            try {
                const summary = await (0, daily_summary_1.generateDailySummary)(loc.id, yesterday);
                // Send email digest
                if (user.digestEmail && user.email) {
                    try {
                        const emailResult = await (0, email_1.sendDailySummary)(user.email, summary, loc.name);
                        if (emailResult.success) {
                            result.emailsSent++;
                            logger_1.logger.info("Digest", `Email sent to ${user.email} for ${loc.name}`);
                            await delay(250); // Rate limit: Resend allows 5/sec
                        }
                        else {
                            result.emailsFailed++;
                            logger_1.logger.error("Digest", `Email failed for ${user.email}/${loc.name}: ${emailResult.error}`);
                        }
                    }
                    catch (err) {
                        result.emailsFailed++;
                        logger_1.logger.error("Digest", `Email error for ${user.email}/${loc.name}`, err);
                    }
                }
                // Send SMS digest
                if (user.digestSms && user.phone) {
                    try {
                        // Get forecast for SMS
                        let forecastSales;
                        let forecastNote;
                        try {
                            const forecasts = await (0, forecasting_1.generateForecast)(loc.id);
                            if (forecasts.length > 0) {
                                forecastSales = forecasts[0].predictedSales;
                                if (forecasts[0].factors.weather) {
                                    const w = forecasts[0].factors.weather;
                                    forecastNote = w?.condition?.toLowerCase() ?? undefined;
                                }
                            }
                        }
                        catch {
                            // Forecast optional
                        }
                        const smsBody = (0, notifications_1.formatSMS)(summary, forecastSales, forecastNote);
                        const smsResult = await (0, sms_1.sendSMS)(user.phone, smsBody);
                        if (smsResult.success) {
                            result.smsSent++;
                            logger_1.logger.info("Digest", `SMS sent to ${user.phone} for ${loc.name}`);
                            await delay(250);
                        }
                        else {
                            result.smsFailed++;
                            logger_1.logger.error("Digest", `SMS failed for ${user.phone}/${loc.name}: ${smsResult.error}`);
                        }
                    }
                    catch (err) {
                        result.smsFailed++;
                        logger_1.logger.error("Digest", `SMS error for ${user.phone}/${loc.name}`, err);
                    }
                }
            }
            catch (err) {
                logger_1.logger.error("Digest", `Failed to generate summary for ${loc.name}`, err);
            }
        }
        results.push(result);
    }
    const totalEmails = results.reduce((s, r) => s + r.emailsSent, 0);
    const totalSms = results.reduce((s, r) => s + r.smsSent, 0);
    logger_1.logger.info("Digest", `Daily digest complete: ${totalEmails} emails, ${totalSms} SMS sent to ${results.length} users`);
    return results;
}
/**
 * Send a test digest to a specific email/phone for a given location.
 * Useful for demos and verifying the flow works.
 */
async function sendTestDigest(locationId, options) {
    const errors = [];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const summary = await (0, daily_summary_1.generateDailySummary)(locationId, yesterday);
    // Build SMS text
    let forecastSales;
    let forecastNote;
    try {
        const forecasts = await (0, forecasting_1.generateForecast)(locationId);
        if (forecasts.length > 0) {
            forecastSales = forecasts[0].predictedSales;
        }
    }
    catch {
        // optional
    }
    const smsText = (0, notifications_1.formatSMS)(summary, forecastSales, forecastNote);
    let emailSent = false;
    let smsSent = false;
    if (options.email) {
        const result = await (0, email_1.sendDailySummary)(options.email, summary, summary.locationName);
        emailSent = result.success;
        if (!result.success)
            errors.push(`Email failed: ${result.error}`);
    }
    if (options.phone) {
        const result = await (0, sms_1.sendSMS)(options.phone, smsText);
        smsSent = result.success;
        if (!result.success)
            errors.push(`SMS failed: ${result.error}`);
    }
    return { summary, smsText, emailSent, smsSent, errors };
}
//# sourceMappingURL=digest.js.map