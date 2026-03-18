import { Router, type Request, type Response } from 'express';
import prisma from '../db/client';
import { getOAuthUrl, exchangeOAuthCode, listLocations as listSquareLocations } from '../integrations/square/client';
import { syncLocationCatalog, syncLocationOrders, syncAllLocations, initialSync } from '../integrations/square/sync';
import { getMerchant as getCloverMerchant } from '../integrations/clover/client';
import { syncCloverCatalog, syncCloverOrders, initialCloverSync } from '../integrations/clover/sync';
import { fetchWeather } from '../integrations/weather/client';
import { analyzeLocation, analyzeAllLocations } from '../ai/engine';
import { logger } from '../utils/logger';

const router = Router();

function paramStr(val: string | string[] | undefined): string {
  return Array.isArray(val) ? val[0] : val ?? '';
}

// ─── Health ───────────────────────────────────────────────
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    demoMode: process.env.DEMO_MODE === 'true',
  });
});

// ─── Square OAuth ─────────────────────────────────────────
router.post('/auth/square/connect', (req: Request, res: Response) => {
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/square/callback`;
  const url = getOAuthUrl(redirectUri);
  res.json({ authUrl: url });
});

router.get('/auth/square/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/square/callback`;
    const tokens = await exchangeOAuthCode(code, redirectUri);

    logger.info('Auth', `Square merchant connected: ${tokens.merchantId}`);
    res.json({ success: true, merchantId: tokens.merchantId });
  } catch (err) {
    logger.error('Auth', 'Square OAuth callback failed', err);
    res.status(500).json({ error: 'OAuth failed' });
  }
});

// ─── Locations ────────────────────────────────────────────
router.get('/locations', async (_req: Request, res: Response) => {
  const locations = await prisma.location.findMany({
    include: {
      organization: true,
      _count: { select: { orders: true, menuItems: true, recommendations: true } },
    },
  });
  res.json(locations);
});

router.get('/locations/:id', async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const location = await prisma.location.findUnique({
    where: { id },
    include: {
      organization: true,
      _count: { select: { orders: true, menuItems: true, recommendations: true } },
    },
  });

  if (!location) {
    res.status(404).json({ error: 'Location not found' });
    return;
  }

  const latestWeather = await prisma.weatherSnapshot.findFirst({
    where: { locationId: location.id },
    orderBy: { timestamp: 'desc' },
  });

  res.json({ ...location, currentWeather: latestWeather });
});

// ─── Orders ───────────────────────────────────────────────
router.get('/locations/:id/orders', async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  const orders = await prisma.order.findMany({
    where: { locationId: id },
    include: {
      orderItems: { include: { menuItem: true } },
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
    skip: offset,
  });

  const total = await prisma.order.count({
    where: { locationId: id },
  });

  res.json({ orders, total, limit, offset });
});

// ─── Menu ─────────────────────────────────────────────────
router.get('/locations/:id/menu', async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const menuItems = await prisma.menuItem.findMany({
    where: { locationId: id, active: true },
    include: {
      aiPatterns: true,
      recommendations: { where: { status: 'active' } },
    },
    orderBy: { category: 'asc' },
  });

  res.json(menuItems);
});

// ─── Weather ──────────────────────────────────────────────
router.get('/locations/:id/weather', async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const location = await prisma.location.findUnique({
    where: { id },
  });

  if (!location) {
    res.status(404).json({ error: 'Location not found' });
    return;
  }

  const snapshots = await prisma.weatherSnapshot.findMany({
    where: { locationId: id },
    orderBy: { timestamp: 'desc' },
    take: 24,
  });

  let live = null;
  if (process.env.DEMO_MODE !== 'true') {
    try {
      live = await fetchWeather(location.lat, location.lng);
    } catch {
      // Use stored data if live fetch fails
    }
  }

  res.json({
    current: snapshots[0] ?? null,
    recent: snapshots,
    live,
  });
});

// ─── Recommendations ──────────────────────────────────────
router.get('/recommendations', async (_req: Request, res: Response) => {
  const recommendations = await prisma.recommendation.findMany({
    where: { status: 'active' },
    include: { menuItem: true, location: true },
    orderBy: { expectedLift: 'desc' },
  });

  res.json(recommendations);
});

router.get('/recommendations/:locationId', async (req: Request, res: Response) => {
  const locationId = paramStr(req.params.locationId);
  const recommendations = await prisma.recommendation.findMany({
    where: { locationId, status: 'active' },
    include: { menuItem: true },
    orderBy: { expectedLift: 'desc' },
  });

  res.json(recommendations);
});

router.post('/recommendations/:id/apply', async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const recommendation = await prisma.recommendation.update({
    where: { id },
    data: { status: 'applied', appliedAt: new Date() },
  });

  res.json(recommendation);
});

// ─── Insights ─────────────────────────────────────────────
router.get('/insights', async (_req: Request, res: Response) => {
  const patterns = await prisma.aIPattern.findMany({
    include: { menuItem: true, location: true },
    orderBy: { liftPercent: 'desc' },
  });

  const grouped = patterns.reduce<Record<string, typeof patterns>>((acc, p) => {
    if (!acc[p.patternType]) acc[p.patternType] = [];
    acc[p.patternType].push(p);
    return acc;
  }, {});

  res.json({
    total: patterns.length,
    byType: grouped,
    topPatterns: patterns.slice(0, 20),
  });
});

// ─── Analytics ────────────────────────────────────────────
router.get('/analytics/revenue', async (req: Request, res: Response) => {
  const locationId = req.query.locationId as string | undefined;
  const days = parseInt(req.query.days as string) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const where = {
    timestamp: { gte: since },
    ...(locationId && { locationId }),
  };

  const orders = await prisma.order.findMany({
    where,
    orderBy: { timestamp: 'asc' },
  });

  const dailyRevenue = new Map<string, { date: string; revenue: number; orderCount: number }>();

  for (const order of orders) {
    const dateKey = order.timestamp.toISOString().split('T')[0];
    const existing = dailyRevenue.get(dateKey);
    if (existing) {
      existing.revenue += order.total;
      existing.orderCount += 1;
    } else {
      dailyRevenue.set(dateKey, { date: dateKey, revenue: order.total, orderCount: 1 });
    }
  }

  const data = Array.from(dailyRevenue.values());
  const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);
  const totalOrders = data.reduce((sum, d) => sum + d.orderCount, 0);
  const avgDaily = data.length > 0 ? totalRevenue / data.length : 0;

  res.json({
    period: { days, since: since.toISOString() },
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalOrders,
    avgDailyRevenue: Math.round(avgDaily * 100) / 100,
    daily: data,
  });
});

router.get('/analytics/items', async (req: Request, res: Response) => {
  const locationId = req.query.locationId as string | undefined;
  const days = parseInt(req.query.days as string) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: {
        timestamp: { gte: since },
        ...(locationId && { locationId }),
      },
    },
    include: { menuItem: true },
  });

  const itemStats = new Map<
    string,
    { menuItemId: string; name: string; category: string; totalQuantity: number; totalRevenue: number; orderCount: number }
  >();

  for (const oi of orderItems) {
    const existing = itemStats.get(oi.menuItemId);
    if (existing) {
      existing.totalQuantity += oi.quantity;
      existing.totalRevenue += oi.amount;
      existing.orderCount += 1;
    } else {
      itemStats.set(oi.menuItemId, {
        menuItemId: oi.menuItemId,
        name: oi.menuItem.name,
        category: oi.menuItem.category,
        totalQuantity: oi.quantity,
        totalRevenue: oi.amount,
        orderCount: 1,
      });
    }
  }

  const items = Array.from(itemStats.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);

  res.json({ period: { days }, items });
});

// ─── Sync ─────────────────────────────────────────────────
router.post('/sync/trigger', async (req: Request, res: Response) => {
  const { locationId } = req.body as { locationId?: string };

  try {
    if (locationId) {
      const catalogCount = await syncLocationCatalog(locationId);
      const orderCount = await syncLocationOrders(locationId);
      const analysis = await analyzeLocation(locationId);

      res.json({
        success: true,
        catalogSynced: catalogCount,
        ordersSynced: orderCount,
        ...analysis,
      });
    } else {
      await syncAllLocations();
      await analyzeAllLocations();
      res.json({ success: true, message: 'All locations synced and analyzed' });
    }
  } catch (err) {
    logger.error('Sync', 'Manual sync trigger failed', err);
    res.status(500).json({ error: 'Sync failed', message: err instanceof Error ? err.message : String(err) });
  }
});

// ─── AI Analysis trigger ──────────────────────────────────
router.post('/analyze', async (req: Request, res: Response) => {
  const { locationId } = req.body as { locationId?: string };

  try {
    if (locationId) {
      const result = await analyzeLocation(locationId);
      res.json({ success: true, ...result });
    } else {
      await analyzeAllLocations();
      res.json({ success: true, message: 'All locations analyzed' });
    }
  } catch (err) {
    logger.error('AI', 'Analysis trigger failed', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// ─── Square Onboarding ───────────────────────────────────
router.post('/onboard/square', async (req: Request, res: Response) => {
  const { accessToken, locationId } = req.body as {
    accessToken?: string;
    locationId?: string;
  };

  if (!accessToken || !locationId) {
    res.status(400).json({ error: 'accessToken and locationId are required' });
    return;
  }

  try {
    // Fetch Square locations to get details
    const squareLocations = await listSquareLocations(accessToken);
    const squareLocation = squareLocations.find((l) => l.id === locationId);

    if (!squareLocation) {
      res.status(404).json({ error: `Location ${locationId} not found in Square account` });
      return;
    }

    // Find or create organization
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({
        data: { name: squareLocation.businessName ?? 'My Restaurant' },
      });
    }

    // Create or update the location in our DB
    let location = await prisma.location.findFirst({
      where: { squareMerchantId: locationId },
    });

    if (!location) {
      location = await prisma.location.create({
        data: {
          organizationId: org.id,
          name: squareLocation.name ?? 'Square Location',
          address: squareLocation.address
            ? [
                squareLocation.address.addressLine1,
                squareLocation.address.locality,
                squareLocation.address.administrativeDistrictLevel1,
              ]
                .filter(Boolean)
                .join(', ')
            : '',
          lat: squareLocation.coordinates?.latitude ?? 0,
          lng: squareLocation.coordinates?.longitude ?? 0,
          timezone: squareLocation.timezone ?? 'America/New_York',
          squareMerchantId: locationId,
          squareAccessToken: accessToken,
        },
      });
    } else {
      location = await prisma.location.update({
        where: { id: location.id },
        data: {
          squareAccessToken: accessToken,
          name: squareLocation.name ?? location.name,
        },
      });
    }

    logger.info('Onboard', `Onboarding Square location: ${location.name} (${location.id})`);

    // Run initial sync (90 days of history)
    const syncResult = await initialSync(location.id);

    // Run AI analysis
    const analysis = await analyzeLocation(location.id);

    res.json({
      success: true,
      locationId: location.id,
      locationName: location.name,
      sync: syncResult,
      analysis,
    });
  } catch (err) {
    logger.error('Onboard', 'Square onboarding failed', err);
    res.status(500).json({
      error: 'Onboarding failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// ─── Square Status ───────────────────────────────────────
router.get('/square/status', async (_req: Request, res: Response) => {
  const locations = await prisma.location.findMany({
    where: { squareAccessToken: { not: null } },
    select: {
      id: true,
      name: true,
      squareMerchantId: true,
    },
  });

  const lastSync = await prisma.syncLog.findFirst({
    where: { status: 'success' },
    orderBy: { timestamp: 'desc' },
  });

  res.json({
    connected: locations.length > 0,
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      squareMerchantId: l.squareMerchantId,
    })),
    lastSyncAt: lastSync?.timestamp ?? null,
    lastSyncSource: lastSync?.source ?? null,
  });
});

// ─── Square Manual Sync ──────────────────────────────────
router.post('/square/sync', async (req: Request, res: Response) => {
  const { locationId } = req.body as { locationId?: string };

  try {
    if (locationId) {
      const catalogCount = await syncLocationCatalog(locationId);
      const orderCount = await syncLocationOrders(locationId);
      res.json({ success: true, catalogSynced: catalogCount, ordersSynced: orderCount });
    } else {
      await syncAllLocations();
      res.json({ success: true, message: 'All locations synced' });
    }
  } catch (err) {
    logger.error('SquareSync', 'Manual sync failed', err);
    res.status(500).json({ error: 'Sync failed', message: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Square Analyze ──────────────────────────────────────
router.post('/square/analyze', async (req: Request, res: Response) => {
  const { locationId } = req.body as { locationId?: string };

  try {
    if (locationId) {
      const result = await analyzeLocation(locationId);
      res.json({ success: true, ...result });
    } else {
      await analyzeAllLocations();
      res.json({ success: true, message: 'All locations analyzed' });
    }
  } catch (err) {
    logger.error('AI', 'Analysis after sync failed', err);
    res.status(500).json({ error: 'Analysis failed', message: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Clover Onboarding ───────────────────────────────────
router.post('/onboard/clover', async (req: Request, res: Response) => {
  const { merchantId, apiToken } = req.body as {
    merchantId?: string;
    apiToken?: string;
  };

  if (!merchantId || !apiToken) {
    res.status(400).json({ error: 'merchantId and apiToken are required' });
    return;
  }

  try {
    // Verify merchant credentials
    const merchant = await getCloverMerchant(merchantId, apiToken);

    // Find or create organization
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({
        data: { name: merchant.name || 'My Restaurant' },
      });
    }

    // Create or update location
    let location = await prisma.location.findFirst({
      where: { cloverMerchantId: merchantId },
    });

    if (!location) {
      location = await prisma.location.create({
        data: {
          organizationId: org.id,
          name: merchant.name || 'Clover Location',
          address: merchant.address
            ? [merchant.address.address1, merchant.address.city, merchant.address.state]
                .filter(Boolean)
                .join(', ')
            : '',
          lat: 0,
          lng: 0,
          timezone: 'America/New_York',
          cloverMerchantId: merchantId,
          cloverApiToken: apiToken,
        },
      });
    } else {
      location = await prisma.location.update({
        where: { id: location.id },
        data: {
          cloverApiToken: apiToken,
          name: merchant.name || location.name,
        },
      });
    }

    logger.info('Onboard', `Onboarding Clover location: ${location.name} (${location.id})`);

    // Run initial sync
    const syncResult = await initialCloverSync(location.id);

    // Run AI analysis
    const analysis = await analyzeLocation(location.id);

    res.json({
      success: true,
      locationId: location.id,
      locationName: location.name,
      sync: syncResult,
      analysis,
    });
  } catch (err) {
    logger.error('Onboard', 'Clover onboarding failed', err);
    res.status(500).json({
      error: 'Onboarding failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// ─── Clover Status ───────────────────────────────────────
router.get('/clover/status', async (_req: Request, res: Response) => {
  const locations = await prisma.location.findMany({
    where: { cloverApiToken: { not: null } },
    select: {
      id: true,
      name: true,
      cloverMerchantId: true,
    },
  });

  const lastSync = await prisma.syncLog.findFirst({
    where: { status: 'success', source: { startsWith: 'clover' } },
    orderBy: { timestamp: 'desc' },
  });

  res.json({
    connected: locations.length > 0,
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      cloverMerchantId: l.cloverMerchantId,
    })),
    lastSyncAt: lastSync?.timestamp ?? null,
    lastSyncSource: lastSync?.source ?? null,
  });
});

// ─── Clover Manual Sync ──────────────────────────────────
router.post('/clover/sync', async (req: Request, res: Response) => {
  const { locationId } = req.body as { locationId?: string };

  try {
    if (locationId) {
      const catalogCount = await syncCloverCatalog(locationId);
      const orderCount = await syncCloverOrders(locationId);
      res.json({ success: true, catalogSynced: catalogCount, ordersSynced: orderCount });
    } else {
      // Sync all Clover locations
      const locations = await prisma.location.findMany({
        where: { cloverApiToken: { not: null } },
      });
      for (const loc of locations) {
        await syncCloverCatalog(loc.id);
        await syncCloverOrders(loc.id);
      }
      res.json({ success: true, message: 'All Clover locations synced' });
    }
  } catch (err) {
    logger.error('CloverSync', 'Manual sync failed', err);
    res.status(500).json({ error: 'Sync failed', message: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Clover Analyze ──────────────────────────────────────
router.post('/clover/analyze', async (req: Request, res: Response) => {
  const { locationId } = req.body as { locationId?: string };

  try {
    if (locationId) {
      const result = await analyzeLocation(locationId);
      res.json({ success: true, ...result });
    } else {
      await analyzeAllLocations();
      res.json({ success: true, message: 'All locations analyzed' });
    }
  } catch (err) {
    logger.error('AI', 'Clover analysis failed', err);
    res.status(500).json({ error: 'Analysis failed', message: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
