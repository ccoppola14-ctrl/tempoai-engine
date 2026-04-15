import "dotenv/config";
import express from "express";
import cors from "cors";
import router from "./api/routes";
import { requestLogger, errorHandler } from "./api/middleware";
import { logger } from "./utils/logger";
import "./infra/healthcheck"; // Initialize healthcheck

import * as Sentry from "@sentry/node";
import { expressIntegration, httpIntegration, requestDataIntegration, setupExpressErrorHandler } from "@sentry/node";
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { createClient } from "redis";

const app = express();
const PORT = process.env.PORT || 3001;

// Sentry error tracking (initialized if SENTRY_DSN is set)
let sentryInitialized = false;
if (process.env.SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "production",
      integrations: [
        httpIntegration({ trace: false }), // Trace only in production
        expressIntegration({ app }),
      ].filter(Boolean), // Filter out nulls
      tracesSampleRate: 0.1,
    });
    sentryInitialized = true;
    logger.info("Sentry", "Error tracking initialized");
  } catch (e) {
    logger.error("Sentry", "Failed to initialize Sentry", e);
  }
}

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

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS', `Blocked request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger); // Request logging

// Sentry middleware — request and error handling
if (sentryInitialized) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

// Routes
app.use("/api", router);

// Rate limiting with Redis store and per-tenant keys
const redisOptions = { url: process.env.REDIS_URL || "redis://localhost:6379" };
const redisClient = createClient(redisOptions);
redisClient.on("error", (err) => logger.error("Redis Client Error", err));
await redisClient.connect(); // Ensure client is connected

// Helper: extract orgId from JWT in Authorization header
function getOrgIdFromToken(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return payload.orgId || payload.organizationId || null;
  } catch (e) { logger.error("JWT parsing error:", e); return null; }
}

// Helper: build rate limit key - uses orgId if authenticated, falls back to IP
function rateLimitKey(orgId, req) {
  const forwarded = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || "unknown";
  return orgId ? `org:${orgId}` : `ip:${ip}`;
}

// Rate limiting — global: 100 req / 15 min per tenant (orgId) or IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.path === "/api/health",
  store: new RedisStore({ redisClient: redisClient }), // Use connected client
  keyGenerator: (req) => rateLimitKey(getOrgIdFromToken(req), req),
  message: { error: "Too many requests, please try again later" },
});
app.use(globalLimiter);

// Rate limiting — auth endpoints: 30 req / 15 min per tenant or IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: new RedisStore({ redisClient: redisClient }), // Use connected client
  keyGenerator: (req) => "auth:" + rateLimitKey(getOrgIdFromToken(req), req),
  message: { error: "Too many requests, please try again later" },
});
app.use("/api/auth", authLimiter);
app.use("/api/signup", authLimiter);
app.use("/api/login", authLimiter);

// Existing error handler MUST come after all routes and other middleware
app.use(errorHandler);

// Sentry Express error handler — must be last middleware
if (sentryInitialized) {
  app.use(Sentry.setupExpressErrorHandler());
}

// Global error handlers for unhandled exceptions and rejections
process.on("unhandledRejection", (reason) => {
  if (sentryInitialized && reason instanceof Error) {
    Sentry.captureException(reason);
  }
  logger.error("Server", "Unhandled Rejection", reason);
});

process.on("uncaughtException", (error) => {
  if (sentryInitialized) {
    Sentry.captureException(error);
  }
  logger.error("Server", "Uncaught Exception", error);
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
    logger.error('Startup', `Missing required env vars: ${missing.join(', ')}`);
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  logger.info('Startup', 'All required environment variables verified');
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
    logger.warn('Startup', 'Build artifacts are older than 7 days');
  }
  
  logger.info('Startup', `Build artifacts verified (modified: ${stats.mtime.toISOString()})`);
}

// Run verifications on startup
verifyProductionEnvironment();
verifyBuildArtifacts();

export default app;
