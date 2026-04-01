import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import router from "./api/routes";
import { requestLogger, errorHandler } from "./api/middleware";
import { startSyncSchedule } from "./integrations/square/sync";
import { startCloverSyncSchedule } from "./integrations/clover/sync";
import { startWeatherSchedule } from "./integrations/weather/client";
import { analyzeAllLocations } from "./ai/engine";
import { generateAllDailySummaries } from "./services/daily-summary";
import { evaluateAllAlerts } from "./services/alerts";
import { runDailyDigest } from "./services/digest";
import cron from "node-cron";
import { logger } from "./utils/logger";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// Middleware
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:4000",
    /localhost:\d+/,
    /\.vercel\.app$/,
    /\.trycloudflare\.com$/,
    "https://usetempoai.com",
    /usetempoai\.com$/,
  ],
  credentials: true,
}));
app.use(express.json());
app.use(requestLogger);

// Rate limiting — global: 100 req / 15 min per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.path === "/api/health",
  message: { error: "Too many requests, please try again later" },
});
app.use(globalLimiter);

// Rate limiting — auth endpoints: 30 req / 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
app.use("/api/auth", authLimiter);
app.use("/api/signup", authLimiter);
app.use("/api/login", authLimiter);

// Routes
app.use("/api", router);

// Error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info("Server", `TempoAi Engine running on port ${PORT}`);
  logger.info("Server", `Demo mode: ${process.env.DEMO_MODE === "true" ? "ON" : "OFF"}`);

  // Start scheduled jobs
  startSyncSchedule();        // Square sync every 15 min
  startCloverSyncSchedule();  // Clover sync every 15 min
  startWeatherSchedule();     // Weather snapshots

  // Re-run AI analysis every hour
  cron.schedule("0 * * * *", async () => {
    logger.info("AI", "Running hourly AI analysis...");
    try {
      await analyzeAllLocations();
      logger.info("AI", "Hourly analysis complete");
    } catch (err) {
      logger.error("AI", "Hourly analysis failed", err);
    }
  });
  logger.info("AI", "Hourly AI analysis scheduled");

  // Daily summary + digest at 6 AM every day
  cron.schedule("0 6 * * *", async () => {
    logger.info("DailySummary", "Running daily summary + digest...");
    try {
      await generateAllDailySummaries();
      await evaluateAllAlerts();
      logger.info("DailySummary", "Daily summaries and alerts complete");

      // Run daily digest (email + SMS) for all opted-in users
      const digestResults = await runDailyDigest();
      const totalEmails = digestResults.reduce((s, r) => s + r.emailsSent, 0);
      const totalSms = digestResults.reduce((s, r) => s + r.smsSent, 0);
      logger.info("Digest", `Daily digest complete: ${totalEmails} emails, ${totalSms} SMS to ${digestResults.length} users`);
    } catch (err) {
      logger.error("DailySummary", "Daily summary/digest failed", err);
    }
  });
  logger.info("DailySummary", "Daily summary + digest scheduled for 6 AM");
});

export default app;
