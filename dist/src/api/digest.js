"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = __importDefault(require("../db/client"));
const auth_1 = require("./middleware/auth");
const digest_1 = require("../services/digest");
const logger_1 = require("../utils/logger");
const digestRouter = (0, express_1.Router)();
// Helper to get fresh user data with all fields
async function getUserWithDigestPrefs(userId) {
    return client_1.default.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            organizationId: true,
            digestEmail: true,
            digestSms: true,
            digestHour: true,
            phone: true,
        },
    });
}
// GET /api/digest/preferences — get current user digest preferences
digestRouter.get("/preferences", auth_1.authMiddleware, async (req, res) => {
    const user = await getUserWithDigestPrefs(req.user.id);
    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }
    res.json({
        digestEmail: user.digestEmail ?? true,
        digestSms: user.digestSms ?? false,
        digestHour: user.digestHour ?? 6,
        phone: user.phone ?? null,
        email: user.email,
    });
});
// PUT /api/digest/preferences — update digest preferences
digestRouter.put("/preferences", auth_1.authMiddleware, async (req, res) => {
    const { digestEmail, digestSms, digestHour, phone } = req.body;
    const data = {};
    if (digestEmail !== undefined)
        data.digestEmail = Boolean(digestEmail);
    if (digestSms !== undefined)
        data.digestSms = Boolean(digestSms);
    if (digestHour !== undefined) {
        const h = parseInt(digestHour);
        if (h >= 0 && h <= 23)
            data.digestHour = h;
    }
    if (phone !== undefined)
        data.phone = phone || null;
    // If enabling SMS, require phone number
    const currentUser = await getUserWithDigestPrefs(req.user.id);
    if (!currentUser) {
        res.status(404).json({ error: "User not found" });
        return;
    }
    if (data.digestSms && !phone && !currentUser.phone) {
        res.status(400).json({ error: "Phone number required to enable SMS digest" });
        return;
    }
    const updated = await client_1.default.user.update({
        where: { id: req.user.id },
        data,
        select: {
            digestEmail: true,
            digestSms: true,
            digestHour: true,
            phone: true,
            email: true,
        },
    });
    logger_1.logger.info("Digest", `Updated preferences for ${req.user.email}: ${JSON.stringify(updated)}`);
    res.json(updated);
});
// POST /api/digest/test — send a test digest (admin or to self)
digestRouter.post("/test", auth_1.authMiddleware, async (req, res) => {
    const { locationId, email, phone } = req.body;
    if (!locationId) {
        res.status(400).json({ error: "locationId is required" });
        return;
    }
    const user = await getUserWithDigestPrefs(req.user.id);
    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }
    try {
        const result = await (0, digest_1.sendTestDigest)(locationId, {
            email: email || user.email,
            phone: phone || user.phone || undefined,
        });
        res.json({
            success: true,
            smsText: result.smsText,
            smsLength: result.smsText.length,
            emailSent: result.emailSent,
            smsSent: result.smsSent,
            errors: result.errors,
            summary: {
                locationName: result.summary.locationName,
                date: result.summary.date,
                totalSales: result.summary.totalSales,
                orderCount: result.summary.orderCount,
                topItems: result.summary.topItems,
                changePercent: result.summary.changePercent,
                weatherNote: result.summary.weatherNote,
            },
        });
    }
    catch (err) {
        logger_1.logger.error("Digest", "Test digest failed", err);
        res.status(500).json({
            error: "Failed to send test digest",
            message: err instanceof Error ? err.message : String(err),
        });
    }
});
// POST /api/digest/run — manually trigger daily digest (admin only)
digestRouter.post("/run", auth_1.authMiddleware, async (req, res) => {
    const user = await getUserWithDigestPrefs(req.user.id);
    if (!user || user.role !== "ADMIN") {
        res.status(403).json({ error: "Admin only" });
        return;
    }
    try {
        const results = await (0, digest_1.runDailyDigest)();
        res.json({ success: true, results });
    }
    catch (err) {
        logger_1.logger.error("Digest", "Manual digest run failed", err);
        res.status(500).json({
            error: "Failed to run digest",
            message: err instanceof Error ? err.message : String(err),
        });
    }
});
exports.default = digestRouter;
//# sourceMappingURL=digest.js.map