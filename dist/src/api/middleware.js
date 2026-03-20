"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
exports.errorHandler = errorHandler;
exports.demoGuard = demoGuard;
const logger_1 = require("../utils/logger");
function requestLogger(req, _res, next) {
    logger_1.logger.info('API', `${req.method} ${req.path}`);
    next();
}
function errorHandler(err, _req, res, _next) {
    logger_1.logger.error('API', 'Unhandled error', err.message);
    res.status(500).json({ error: 'Internal server error', message: err.message });
}
function demoGuard(_req, res, next) {
    if (process.env.DEMO_MODE === 'true') {
        // In demo mode, skip auth checks
        next();
        return;
    }
    // In production, you'd check auth tokens here
    next();
}
//# sourceMappingURL=middleware.js.map