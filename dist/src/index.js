"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const routes_1 = __importDefault(require("./api/routes"));
const middleware_1 = require("./api/middleware");
const sync_1 = require("./integrations/square/sync");
const sync_2 = require("./integrations/clover/sync");
const client_1 = require("./integrations/weather/client");
const engine_1 = require("./ai/engine");
const daily_summary_1 = require("./services/daily-summary");
const alerts_1 = require("./services/alerts");
const email_1 = require("./services/email");
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = require("./utils/logger");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '3001', 10);
// Middleware
app.use((0, cors_1.default)({
    origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:4000',
        /localhost:\d+/,
        /\.vercel\.app$/,
        /\.trycloudflare\.com$/,
        'https://usetempoai.com',
        /usetempoai\.com$/,
    ],
    credentials: true,
}));
app.use(express_1.default.json());
app.use(middleware_1.requestLogger);
// Rate limiting — global: 100 req / 15 min per IP
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/api/health',
    message: { error: 'Too many requests, please try again later' },
});
app.use(globalLimiter);
// Rate limiting — auth endpoints: 10 req / 15 min per IP
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
});
app.use('/api/auth', authLimiter);
app.use('/api/signup', authLimiter);
app.use('/api/login', authLimiter);
// Routes
app.use('/api', routes_1.default);
// Error handler
app.use(middleware_1.errorHandler);
// Start server
app.listen(PORT, () => {
    logger_1.logger.info('Server', `TempoAi Engine running on port ${PORT}`);
    logger_1.logger.info('Server', `Demo mode: ${process.env.DEMO_MODE === 'true' ? 'ON' : 'OFF'}`);
    // Start scheduled jobs
    (0, sync_1.startSyncSchedule)(); // Square sync every 15 min
    (0, sync_2.startCloverSyncSchedule)(); // Clover sync every 15 min
    (0, client_1.startWeatherSchedule)(); // Weather snapshots
    // Re-run AI analysis every hour
    node_cron_1.default.schedule('0 * * * *', async () => {
        logger_1.logger.info('AI', 'Running hourly AI analysis...');
        try {
            await (0, engine_1.analyzeAllLocations)();
            logger_1.logger.info('AI', 'Hourly analysis complete');
        }
        catch (err) {
            logger_1.logger.error('AI', 'Hourly analysis failed', err);
        }
    });
    logger_1.logger.info('AI', 'Hourly AI analysis scheduled');
    // Daily summary + email digest at 6 AM every day
    node_cron_1.default.schedule('0 6 * * *', async () => {
        logger_1.logger.info('DailySummary', 'Running daily summary generation...');
        try {
            await (0, daily_summary_1.generateAllDailySummaries)();
            await (0, alerts_1.evaluateAllAlerts)();
            logger_1.logger.info('DailySummary', 'Daily summaries and alerts complete');
            // Send email digests to merchants with emails on file
            const { default: prisma } = await Promise.resolve().then(() => __importStar(require('./db/client')));
            const locations = await prisma.location.findMany();
            for (const location of locations) {
                try {
                    const merchant = location.squareMerchantId
                        ? await prisma.squareMerchant.findUnique({ where: { merchantId: location.squareMerchantId } })
                        : null;
                    if (merchant?.email) {
                        const summary = await (0, daily_summary_1.generateDailySummary)(location.id);
                        await (0, email_1.sendDailySummary)(merchant.email, summary, location.name);
                    }
                }
                catch (emailErr) {
                    logger_1.logger.error('Email', `Failed to send digest for ${location.name}`, emailErr);
                }
            }
            logger_1.logger.info('Email', 'Daily digest emails sent');
        }
        catch (err) {
            logger_1.logger.error('DailySummary', 'Daily summary generation failed', err);
        }
    });
    logger_1.logger.info('DailySummary', 'Daily summary scheduled for 6 AM');
});
exports.default = app;
//# sourceMappingURL=index.js.map