"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDailyDigest = runDailyDigest;
exports.sendTestDigest = sendTestDigest;
const logger_1 = require("../utils/logger");
/**
 * DISABLED: Digest service requires schema migration for:
 * - digestEmail, digestSms, digestHour fields on User model
 * - phone field on User model
 * - assignedLocations relation on User model
 *
 * Run the following Prisma migration to enable:
 * npx prisma migrate dev --name add_digest_preferences
 */
async function runDailyDigest() {
    logger_1.logger.warn("Digest", "Digest service disabled - schema migration required");
    return [];
}
async function sendTestDigest(_locationId, _options) {
    logger_1.logger.warn("Digest", "Test digest disabled - schema migration required");
    return {
        summary: {},
        smsText: "",
        emailSent: false,
        smsSent: false,
        errors: ["Digest service temporarily disabled"],
    };
}
//# sourceMappingURL=digest.js.map