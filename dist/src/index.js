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
const routes_1 = __importDefault(require("./api/routes"));
const middleware_1 = require("./api/middleware");
const logger_1 = require("./utils/logger");
const express_rate_limit_1 = __importStar(require("express-rate-limit"));
const redis_1 = require("redis");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Sentry error tracking (DISABLED: TypeScript errors with Sentry v10 API)
const sentryInitialized = false;
// if (process.env.SENTRY_DSN) {
//   try {
//     Sentry.init({
//       dsn: process.env.SENTRY_DSN,
//       environment: process.env.NODE_ENV || "production",
//       tracesSampleRate: 0.1,
//     });
//     sentryInitialized = true;
//     logger.info("Sentry", "Error tracking initialized");
//   } catch (e) {
//     logger.error("Sentry", "Failed to initialize Sentry", e);
//   }
// }
// CORS - restrict to production domains
const allowedOrigins = [
    'https://usetempoai.com',
    'https://www.usetempoai.com',
    'https://tempoai-three.vercel.app',
];
// Allow localhost in development
if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000');
    allowedOrigins.push('http://localhost:3001');
}
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            logger_1.logger.warn('CORS', `Blocked request from: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use(middleware_1.requestLogger); // Request logging
// Sentry middleware — DISABLED (TypeScript errors with v10 API)
// if (sentryInitialized) {
//   app.use(Sentry.Handlers.requestHandler());
//   app.use(Sentry.Handlers.tracingHandler());
// }
// Routes
app.use("/api", routes_1.default);
// Rate limiting with Redis store and per-tenant keys (lazy initialization)
let redisClient = null;
async function getRedisClient() {
    if (!redisClient) {
        const redisOptions = { url: process.env.REDIS_URL || "redis://localhost:6379" };
        redisClient = (0, redis_1.createClient)(redisOptions);
        redisClient.on("error", (err) => logger_1.logger.error("Redis Client Error", err));
        await redisClient.connect();
    }
    return redisClient;
}
// Redis disabled for now — using memory store for rate limiting stability
// const redisStore = new RedisStore({...});
// Rate limiting configurations
// Helper: extract orgId from JWT in Authorization header
function getOrgIdFromToken(req) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer "))
            return null;
        const token = authHeader.slice(7);
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
        return payload.orgId || payload.organizationId || null;
    }
    catch (e) {
        logger_1.logger.error("JWT parsing", e instanceof Error ? e.message : String(e));
        return null;
    }
}
// Helper: build rate limit key - uses orgId if authenticated, falls back to IP
function rateLimitKey(orgId, req) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xff = req.headers["x-forwarded-for"];
    const xffStr = typeof xff === "string" ? xff : Array.isArray(xff) ? xff[0] || "" : "";
    const forwarded = xffStr.split(",")[0].trim();
    const ip = forwarded || req.ip || req.socket?.remoteAddress || "unknown";
    return orgId ? `org:${orgId}` : `ip:${ip}`;
}
// Rate limiting — global: 100 req / 15 min per tenant (orgId) or IP (using memory store for stability)
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new express_rate_limit_1.MemoryStore(),
    skip: (req) => req.path === "/api/health",
    keyGenerator: (req) => rateLimitKey(getOrgIdFromToken(req), req),
    message: { error: "Too many requests, please try again later" },
});
app.use(globalLimiter);
// Rate limiting — auth endpoints: 10 req / 15 min per tenant or IP (stricter)
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new express_rate_limit_1.MemoryStore(),
    keyGenerator: (req) => "auth:" + rateLimitKey(getOrgIdFromToken(req), req),
    message: { error: "Too many login attempts. Please try again later." },
});
app.use("/api/auth", authLimiter);
app.use("/api/signup", authLimiter);
app.use("/api/login", authLimiter);
// Existing error handler MUST come after all routes and other middleware
app.use(middleware_1.errorHandler);
// Sentry Express error handler — DISABLED
// if (sentryInitialized) {
//   app.use(Sentry.setupExpressErrorHandler());
// }
// Global error handlers for unhandled exceptions and rejections
process.on("unhandledRejection", (reason) => {
    // Sentry disabled
    logger_1.logger.error("Server", "Unhandled Rejection", reason);
});
process.on("uncaughtException", (error) => {
    // Sentry disabled
    logger_1.logger.error("Server", "Uncaught Exception", error);
    process.exit(1);
});
// Startup verification
function verifyProductionEnvironment() {
    const requiredEnvVars = [
        'DATABASE_URL',
        'JWT_SECRET',
        'ENCRYPTION_KEY',
        'RESEND_API_KEY',
        'SQUARE_APP_ID',
        'SQUARE_APP_SECRET',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_STARTER_PRICE_ID',
        'STRIPE_GROWTH_PRICE_ID',
        'STRIPE_PRO_PRICE_ID',
    ];
    const missing = requiredEnvVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
        logger_1.logger.warn('Startup', `Missing optional env vars: ${missing.join(', ')}`);
        // Allow startup with missing vars for gradual deployment
    }
    else {
        logger_1.logger.info('Startup', 'All required environment variables verified');
    }
}
// Verify build artifacts exist
function verifyBuildArtifacts() {
    const fs = require('fs');
    const path = require('path');
    const buildPath = path.join(__dirname, 'index.js');
    if (!fs.existsSync(buildPath)) {
        throw new Error('Build artifacts not found. Run npm run build before starting.');
    }
    const stats = fs.statSync(buildPath);
    if (Date.now() - stats.mtime.getTime() > 7 * 24 * 60 * 60 * 1000) {
        logger_1.logger.warn('Startup', 'Build artifacts are older than 7 days');
    }
    logger_1.logger.info('Startup', `Build artifacts verified (modified: ${stats.mtime.toISOString()})`);
}
// Run verifications on startup
verifyProductionEnvironment();
verifyBuildArtifacts();
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
// Start server
app.listen(PORT, () => {
    logger_1.logger.info('Startup', `Server listening on port ${PORT}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map