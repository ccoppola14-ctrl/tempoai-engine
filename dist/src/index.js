"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const routes_1 = __importDefault(require("./api/routes"));
const middleware_1 = require("./api/middleware");
const sync_1 = require("./integrations/square/sync");
const sync_2 = require("./integrations/clover/sync");
const client_1 = require("./integrations/weather/client");
const engine_1 = require("./ai/engine");
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
    ],
    credentials: true,
}));
app.use(express_1.default.json());
app.use(middleware_1.requestLogger);
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
});
exports.default = app;
//# sourceMappingURL=index.js.map