import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import router from './api/routes';
import { requestLogger, errorHandler } from './api/middleware';
import { startSyncSchedule } from './integrations/square/sync';
import { startCloverSyncSchedule } from './integrations/clover/sync';
import { startWeatherSchedule } from './integrations/weather/client';
import { analyzeAllLocations } from './ai/engine';
import { generateAllDailySummaries, generateDailySummary } from './services/daily-summary';
import { evaluateAllAlerts } from './services/alerts';
import { sendDailySummary } from './services/email';
import cron from 'node-cron';
import { logger } from './utils/logger';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors({
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
app.use(express.json());
app.use(requestLogger);

// Routes
app.use('/api', router);

// Error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info('Server', `TempoAi Engine running on port ${PORT}`);
  logger.info('Server', `Demo mode: ${process.env.DEMO_MODE === 'true' ? 'ON' : 'OFF'}`);

  // Start scheduled jobs
  startSyncSchedule();        // Square sync every 15 min
  startCloverSyncSchedule();  // Clover sync every 15 min
  startWeatherSchedule();     // Weather snapshots

  // Re-run AI analysis every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('AI', 'Running hourly AI analysis...');
    try {
      await analyzeAllLocations();
      logger.info('AI', 'Hourly analysis complete');
    } catch (err) {
      logger.error('AI', 'Hourly analysis failed', err);
    }
  });
  logger.info('AI', 'Hourly AI analysis scheduled');

  // Daily summary + email digest at 6 AM every day
  cron.schedule('0 6 * * *', async () => {
    logger.info('DailySummary', 'Running daily summary generation...');
    try {
      await generateAllDailySummaries();
      await evaluateAllAlerts();
      logger.info('DailySummary', 'Daily summaries and alerts complete');

      // Send email digests to merchants with emails on file
      const { default: prisma } = await import('./db/client');
      const locations = await prisma.location.findMany();
      for (const location of locations) {
        try {
          const merchant = location.squareMerchantId
            ? await prisma.squareMerchant.findUnique({ where: { merchantId: location.squareMerchantId } })
            : null;
          if (merchant?.email) {
            const summary = await generateDailySummary(location.id);
            await sendDailySummary(merchant.email, summary, location.name);
          }
        } catch (emailErr) {
          logger.error('Email', `Failed to send digest for ${location.name}`, emailErr);
        }
      }
      logger.info('Email', 'Daily digest emails sent');
    } catch (err) {
      logger.error('DailySummary', 'Daily summary generation failed', err);
    }
  });
  logger.info('DailySummary', 'Daily summary scheduled for 6 AM');
});

export default app;
