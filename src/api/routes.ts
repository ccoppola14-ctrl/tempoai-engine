import { Router, type Request, type Response } from 'express';
import prisma from '../db/client';
import { getOAuthUrl, exchangeOAuthCode, listLocations as listSquareLocations, listCatalog } from '../integrations/square/client';
import { syncLocationCatalog, syncLocationOrders, syncAllLocations, initialSync } from '../integrations/square/sync';
import { snapshotWeather } from '../integrations/weather/client';
import { getMerchant as getCloverMerchant } from '../integrations/clover/client';
import { syncCloverCatalog, syncCloverOrders, initialCloverSync } from '../integrations/clover/sync';
import { fetchWeather } from '../integrations/weather/client';
import { analyzeLocation, analyzeAllLocations } from '../ai/engine';
import { getDaypart, getDayName } from '../utils/dayparts';
import { logger } from '../utils/logger';
import billingRouter from './billing';

const router = Router();

// ─── Billing ──────────────────────────────────────────────
router.use('/billing', billingRouter);

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

// ─── Square OAuth Production Flow ─────────────────────────

// GET /square/oauth/authorize — redirects merchant to Square's OAuth page
router.get('/square/oauth/authorize', (req: Request, res: Response) => {
  const redirectUri = req.query.redirect_uri as string | undefined;
  const callbackUrl = `${process.env.ENGINE_URL || 'https://tempoai-engine.onrender.com'}/api/square/oauth/callback`;

  // Store the dashboard redirect_uri so we can send the merchant back after OAuth
  const state = redirectUri ? Buffer.from(redirectUri).toString('base64') : '';

  const appId = process.env.SQUARE_APP_ID;
  const baseUrl =
    process.env.SQUARE_ENVIRONMENT === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';
  const scopes = [
    'MERCHANT_PROFILE_READ',
    'ORDERS_READ',
    'ITEMS_READ',
    'INVENTORY_READ',
  ].join('+');

  const authUrl = `${baseUrl}/oauth2/authorize?client_id=${appId}&scope=${scopes}&session=false&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
  res.redirect(authUrl);
});

// GET /square/oauth/callback — handles OAuth redirect from Square
router.get('/square/oauth/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  try {
    const callbackUrl = `${process.env.ENGINE_URL || 'https://tempoai-engine.onrender.com'}/api/square/oauth/callback`;
    const tokens = await exchangeOAuthCode(code, callbackUrl);

    logger.info('SquareOAuth', `Got tokens for merchant ${tokens.merchantId}`);

    // Fetch merchant locations from Square
    const squareLocations = await listSquareLocations(tokens.accessToken);

    // Store SquareMerchant record
    await prisma.squareMerchant.upsert({
      where: { merchantId: tokens.merchantId },
      update: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        locations: JSON.stringify(squareLocations.map((l) => ({ id: l.id, name: l.name }))),
        active: true,
      },
      create: {
        merchantId: tokens.merchantId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        name: squareLocations[0]?.businessName ?? 'Square Merchant',
        locations: JSON.stringify(squareLocations.map((l) => ({ id: l.id, name: l.name }))),
      },
    });

    // Find or create organization
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({
        data: { name: squareLocations[0]?.businessName ?? 'My Restaurant' },
      });
    }

    // Create Location records for each Square location
    const createdLocationIds: string[] = [];
    for (const sl of squareLocations) {
      let location = await prisma.location.findFirst({
        where: { squareMerchantId: sl.id },
      });

      const addr = sl.address;
      const addressStr = addr
        ? [addr.addressLine1, addr.locality, addr.administrativeDistrictLevel1].filter(Boolean).join(', ')
        : '';
      const lat = sl.coordinates?.latitude ?? 0;
      const lng = sl.coordinates?.longitude ?? 0;

      if (!location) {
        location = await prisma.location.create({
          data: {
            organizationId: org.id,
            name: sl.name ?? sl.businessName ?? 'Square Location',
            address: addressStr,
            lat,
            lng,
            timezone: sl.timezone ?? 'America/New_York',
            squareMerchantId: sl.id,
            squareAccessToken: tokens.accessToken,
          },
        });
      } else {
        location = await prisma.location.update({
          where: { id: location.id },
          data: {
            squareAccessToken: tokens.accessToken,
            name: sl.name ?? location.name,
            address: addressStr || location.address,
            lat: lat || location.lat,
            lng: lng || location.lng,
          },
        });
      }

      createdLocationIds.push(location.id);
    }

    // Trigger initial sync for all locations in background
    for (const locId of createdLocationIds) {
      initialSync(locId)
        .then(() => snapshotWeather(locId))
        .then(() => analyzeLocation(locId))
        .then(() => logger.info('SquareOAuth', `Initial sync + analysis complete for location ${locId}`))
        .catch((err) => logger.error('SquareOAuth', `Background sync failed for ${locId}`, err));
    }

    // Redirect back to dashboard
    let dashboardRedirect = process.env.DASHBOARD_URL || 'https://tempoai-three.vercel.app';
    if (state && typeof state === 'string') {
      try {
        dashboardRedirect = Buffer.from(state, 'base64').toString('utf-8');
      } catch {
        // Use default
      }
    }
    const merchantParam = encodeURIComponent(tokens.merchantId);
    res.redirect(`${dashboardRedirect}?merchantId=${merchantParam}`);
  } catch (err) {
    logger.error('SquareOAuth', 'OAuth callback failed', err);
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://tempoai-three.vercel.app';
    res.redirect(`${dashboardUrl}/onboard?error=oauth_failed`);
  }
});

// GET /square/merchants — list connected Square merchants
router.get('/square/merchants', async (_req: Request, res: Response) => {
  const merchants = await prisma.squareMerchant.findMany({
    orderBy: { installedAt: 'desc' },
  });

  res.json({
    total: merchants.length,
    active: merchants.filter((m) => m.active).length,
    merchants: merchants.map((m) => ({
      id: m.id,
      merchantId: m.merchantId,
      name: m.name,
      plan: m.plan,
      active: m.active,
      locations: JSON.parse(m.locations),
      installedAt: m.installedAt,
    })),
  });
});

// GET /square/merchants/:merchantId/status — merchant connection status
router.get('/square/merchants/:merchantId/status', async (req: Request, res: Response) => {
  const merchantId = paramStr(req.params.merchantId);

  const merchant = await prisma.squareMerchant.findUnique({
    where: { merchantId },
  });

  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  // Find associated locations
  const locations = await prisma.location.findMany({
    where: { squareMerchantId: { in: JSON.parse(merchant.locations).map((l: { id: string }) => l.id) } },
    include: {
      _count: { select: { orders: true, menuItems: true, recommendations: true, weatherSnapshots: true } },
    },
  });

  // Get latest sync logs
  const recentSyncs = locations.length > 0
    ? await prisma.syncLog.findMany({
        where: { locationId: { in: locations.map((l) => l.id) }, source: { startsWith: 'square' } },
        orderBy: { timestamp: 'desc' },
        take: 10,
      })
    : [];

  res.json({
    merchant: {
      id: merchant.id,
      merchantId: merchant.merchantId,
      name: merchant.name,
      plan: merchant.plan,
      active: merchant.active,
      installedAt: merchant.installedAt,
      expiresAt: merchant.expiresAt,
    },
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      orders: l._count.orders,
      menuItems: l._count.menuItems,
      recommendations: l._count.recommendations,
      weatherSnapshots: l._count.weatherSnapshots,
    })),
    recentSyncs,
  });
});

// ─── Onboarding Status ───────────────────────────────────
router.get('/onboard/status/:merchantId', async (req: Request, res: Response) => {
  const merchantId = paramStr(req.params.merchantId);

  // Check SquareMerchant first, then CloverMerchant
  const squareMerchant = await prisma.squareMerchant.findUnique({ where: { merchantId } });
  const cloverMerchant = !squareMerchant
    ? await prisma.cloverMerchant.findUnique({ where: { merchantId } })
    : null;

  if (!squareMerchant && !cloverMerchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  // Find locations for this merchant
  const locations = squareMerchant
    ? await prisma.location.findMany({
        where: { squareMerchantId: { in: JSON.parse(squareMerchant.locations).map((l: { id: string }) => l.id) } },
        include: {
          _count: { select: { orders: true, menuItems: true, weatherSnapshots: true, recommendations: true } },
        },
      })
    : await prisma.location.findMany({
        where: { cloverMerchantId: merchantId },
        include: {
          _count: { select: { orders: true, menuItems: true, weatherSnapshots: true, recommendations: true } },
        },
      });

  const hasLocations = locations.length > 0;
  const hasMenu = locations.some((l) => l._count.menuItems > 0);
  const hasOrders = locations.some((l) => l._count.orders > 0);
  const hasWeather = locations.some((l) => l._count.weatherSnapshots > 0);
  const ready = hasLocations && hasMenu && hasOrders;

  res.json({
    merchantId,
    source: squareMerchant ? 'square' : 'clover',
    locations: hasLocations,
    menu: hasMenu,
    orders: hasOrders,
    weather: hasWeather,
    ready,
    locationCount: locations.length,
    details: locations.map((l) => ({
      id: l.id,
      name: l.name,
      menuItems: l._count.menuItems,
      orders: l._count.orders,
      weatherSnapshots: l._count.weatherSnapshots,
      recommendations: l._count.recommendations,
    })),
  });
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

// ─── Active Promos ───────────────────────────────────────

function generatePromoText(itemName: string, price: number, triggerType: string, triggerCondition: string): string {
  const priceStr = `$${price.toFixed(2)}`;
  switch (triggerType) {
    case 'temperature':
      if (triggerCondition === 'temp > 85') return `Beat the heat! Try our refreshing ${itemName} — just ${priceStr}`;
      if (triggerCondition === 'temp < 60') return `Warm up with our delicious ${itemName} — only ${priceStr}`;
      return `Perfect weather for our ${itemName} — just ${priceStr}`;
    case 'weather':
      if (['rain', 'drizzle', 'thunderstorm'].includes(triggerCondition))
        return `Rainy day comfort — treat yourself to ${itemName} for ${priceStr}`;
      if (triggerCondition === 'snow') return `Snow day special — warm up with ${itemName} for ${priceStr}`;
      if (triggerCondition === 'clear') return `Beautiful day for our ${itemName} — just ${priceStr}`;
      return `Try our ${itemName} today — only ${priceStr}`;
    case 'daypart':
      if (['early_morning', 'breakfast'].includes(triggerCondition))
        return `Start your morning right with ${itemName} — ${priceStr}`;
      if (triggerCondition === 'lunch') return `Lunchtime favorite — grab ${itemName} for just ${priceStr}`;
      if (triggerCondition === 'afternoon') return `Afternoon pick-me-up: ${itemName} for just ${priceStr}`;
      if (triggerCondition === 'dinner') return `Tonight's pick: ${itemName} — only ${priceStr}`;
      return `Late night craving? Try our ${itemName} — ${priceStr}`;
    case 'day_of_week':
      return `Happy ${triggerCondition}! Enjoy our ${itemName} — just ${priceStr}`;
    case 'trend':
      if (triggerCondition === 'trending_up') return `Trending now: ${itemName} — try it for ${priceStr}`;
      return `Rediscover our ${itemName} — just ${priceStr}`;
    default:
      return `Try our ${itemName} — only ${priceStr}`;
  }
}

function matchesTrigger(
  triggerType: string,
  triggerCondition: string,
  temperature: number | null,
  weatherCondition: string | null,
  currentDaypart: string,
  currentDayName: string,
): boolean {
  switch (triggerType) {
    case 'temperature': {
      if (temperature === null) return false;
      if (triggerCondition === 'temp < 60') return temperature < 60;
      if (triggerCondition === 'temp 60-75') return temperature >= 60 && temperature < 75;
      if (triggerCondition === 'temp 75-85') return temperature >= 75 && temperature < 85;
      if (triggerCondition === 'temp > 85') return temperature >= 85;
      return false;
    }
    case 'weather':
      return weatherCondition === triggerCondition;
    case 'daypart':
      return currentDaypart === triggerCondition;
    case 'day_of_week':
      return currentDayName === triggerCondition;
    case 'trend':
      return true;
    default:
      return false;
  }
}

router.get('/active-promos/:locationId', async (req: Request, res: Response) => {
  const locationId = paramStr(req.params.locationId);

  try {
    const location = await prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    // Get latest weather snapshot
    const latestWeather = await prisma.weatherSnapshot.findFirst({
      where: { locationId },
      orderBy: { timestamp: 'desc' },
    });

    // Current time info
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeekNum = now.getDay();
    const currentDaypart = getDaypart(hour);
    const currentDayName = getDayName(dayOfWeekNum);

    const temperature = latestWeather?.temperature ?? null;
    const weatherCondition = latestWeather?.conditions ?? null;

    // Get all active recommendations for this location
    const recommendations = await prisma.recommendation.findMany({
      where: { locationId, status: 'active' },
      include: { menuItem: true },
      orderBy: { expectedLift: 'desc' },
    });

    // Filter to only those whose trigger conditions match right now
    const matchingRecs = recommendations.filter((rec) =>
      matchesTrigger(rec.triggerType, rec.triggerCondition, temperature, weatherCondition, currentDaypart, currentDayName)
    );

    // Top 10 by expectedLift (already sorted desc)
    const top10 = matchingRecs.slice(0, 10);

    const activePromos = top10.map((rec) => {
      const channels = JSON.parse(rec.channels) as string[];
      return {
        id: rec.id,
        itemName: rec.menuItem.name,
        itemPrice: rec.menuItem.price,
        message: rec.message,
        expectedLift: rec.expectedLift,
        channels,
        triggerType: rec.triggerType,
        triggerCondition: rec.triggerCondition,
        promoText: generatePromoText(rec.menuItem.name, rec.menuItem.price, rec.triggerType, rec.triggerCondition),
      };
    });

    // Best audio promo: highest lift with "audio" channel
    const audioPromo = activePromos.find((p) => p.channels.includes('audio')) ?? null;

    res.json({
      locationId,
      timestamp: now.toISOString(),
      conditions: {
        temperature,
        weather: weatherCondition,
        daypart: currentDaypart,
        dayOfWeek: currentDayName,
      },
      activePromos,
      audioPromo: audioPromo
        ? { text: audioPromo.promoText, itemName: audioPromo.itemName }
        : null,
    });
  } catch (err) {
    logger.error('ActivePromos', 'Failed to get active promos', err);
    res.status(500).json({ error: 'Failed to get active promotions' });
  }
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

// ─── Cashier Suggestions (Real-Time) ─────────────────────
// This endpoint powers live cashier recommendations.
// A Clover app, cashier tablet, or any POS integration hits this
// to get the top items to suggest RIGHT NOW based on current conditions.
router.get('/cashier/suggest/:locationId', async (req: Request, res: Response) => {
  const locationId = paramStr(req.params.locationId);

  try {
    const location = await prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    // Get current conditions
    const latestWeather = await prisma.weatherSnapshot.findFirst({
      where: { locationId },
      orderBy: { timestamp: 'desc' },
    });

    const now = new Date();
    const hour = now.getHours();
    const dayOfWeekNum = now.getDay();
    const currentDaypart = getDaypart(hour);
    const currentDayName = getDayName(dayOfWeekNum);
    const temperature = latestWeather?.temperature ?? null;
    const weatherCondition = latestWeather?.conditions ?? null;

    // Get active recommendations
    const recommendations = await prisma.recommendation.findMany({
      where: { locationId, status: 'active' },
      include: { menuItem: true },
      orderBy: { expectedLift: 'desc' },
    });

    // Filter to matching current conditions
    const matching = recommendations.filter((rec) =>
      matchesTrigger(rec.triggerType, rec.triggerCondition, temperature, weatherCondition, currentDaypart, currentDayName)
    );

    // Top 3 suggestions for the cashier
    const suggestions = matching.slice(0, 3).map((rec, i) => ({
      rank: i + 1,
      item: rec.menuItem.name,
      price: `$${rec.menuItem.price.toFixed(2)}`,
      reason: rec.message,
      expectedLift: `+${rec.expectedLift}%`,
      triggerType: rec.triggerType,
      triggerCondition: rec.triggerCondition,
      suggestText: generatePromoText(rec.menuItem.name, rec.menuItem.price, rec.triggerType, rec.triggerCondition),
    }));

    res.json({
      locationId,
      locationName: location.name,
      timestamp: now.toISOString(),
      conditions: {
        temperature,
        weather: weatherCondition,
        daypart: currentDaypart,
        dayOfWeek: currentDayName,
      },
      suggestions,
      cashierPrompt: suggestions.length > 0
        ? `Suggest: "${suggestions[0].item}" — ${suggestions[0].reason}`
        : null,
    });
  } catch (err) {
    logger.error('Cashier', 'Failed to get suggestions', err);
    res.status(500).json({ error: 'Failed to get cashier suggestions' });
  }
});

// ─── Clover OAuth Flow ───────────────────────────────────
// This is the proper app-market install flow.
// Merchant clicks Install → Clover redirects to us with auth code → we exchange for token.

const CLOVER_APP_ID = process.env.CLOVER_APP_ID || 'j4eb4vp13bmy6';
const CLOVER_APP_SECRET = process.env.CLOVER_APP_SECRET || '';

function getCloverOAuthBaseUrl(): string {
  const env = process.env.CLOVER_ENVIRONMENT || 'sandbox';
  return env === 'production'
    ? 'https://www.clover.com'
    : 'https://sandbox.dev.clover.com';
}

function getCloverApiBaseUrl(): string {
  const env = process.env.CLOVER_ENVIRONMENT || 'sandbox';
  return env === 'production'
    ? 'https://api.clover.com'
    : 'https://apisandbox.dev.clover.com';
}

// Step 1: Redirect merchant to Clover authorization page
router.get('/auth/clover/connect', (_req: Request, res: Response) => {
  if (!CLOVER_APP_ID) {
    res.status(500).json({ error: 'CLOVER_APP_ID not configured' });
    return;
  }
  const redirectUri = `${process.env.ENGINE_URL || 'https://tempoai-engine.onrender.com'}/api/auth/clover/callback`;
  const authUrl = `${getCloverOAuthBaseUrl()}/oauth/v2/authorize?client_id=${CLOVER_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(authUrl);
});

// Step 2: Clover redirects back with merchant_id and code
router.get('/auth/clover/callback', async (req: Request, res: Response) => {
  const { merchant_id, code } = req.query;

  if (!code || !merchant_id || typeof code !== 'string' || typeof merchant_id !== 'string') {
    res.status(400).json({ error: 'Missing merchant_id or authorization code' });
    return;
  }

  try {
    // Exchange code for access token
    const tokenUrl = `${getCloverApiBaseUrl()}/oauth/v2/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLOVER_APP_ID,
        client_secret: CLOVER_APP_SECRET,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      logger.error('CloverOAuth', `Token exchange failed: ${errorBody}`);
      res.status(500).json({ error: 'Failed to exchange authorization code' });
      return;
    }

    const tokenData = await tokenResponse.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    logger.info('CloverOAuth', `Got access token for merchant ${merchant_id}`);

    // Fetch merchant details
    const merchant = await getCloverMerchant(merchant_id, accessToken);

    // Find or create organization
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({
        data: { name: merchant.name || 'My Restaurant' },
      });
    }

    // Create or update location
    let location = await prisma.location.findFirst({
      where: { cloverMerchantId: merchant_id },
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
          cloverMerchantId: merchant_id,
          cloverApiToken: accessToken,
        },
      });
    } else {
      location = await prisma.location.update({
        where: { id: location.id },
        data: {
          cloverApiToken: accessToken,
          name: merchant.name || location.name,
        },
      });
    }

    // Store in CloverMerchant table for app market tracking
    await prisma.cloverMerchant.upsert({
      where: { merchantId: merchant_id },
      update: { accessToken, name: merchant.name || 'Clover Merchant', active: true },
      create: { merchantId: merchant_id, accessToken, name: merchant.name || 'Clover Merchant' },
    });

    logger.info('CloverOAuth', `Onboarded: ${location.name} (${location.id})`);

    // Run initial sync in background (don't block the redirect)
    initialCloverSync(location.id)
      .then(() => analyzeLocation(location!.id))
      .then(() => logger.info('CloverOAuth', `Initial sync + analysis complete for ${location!.name}`))
      .catch((err) => logger.error('CloverOAuth', `Background sync failed for ${location!.name}`, err));

    // Redirect to dashboard
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://tempoai-three.vercel.app';
    res.redirect(`${dashboardUrl}/onboard?success=true&location=${encodeURIComponent(location.name)}`);
  } catch (err) {
    logger.error('CloverOAuth', 'OAuth callback failed', err);
    res.status(500).json({ error: 'OAuth failed', message: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Clover App Market OAuth Callback ────────────────────
// Dedicated endpoint for Clover App Market redirect URI
router.get('/clover/oauth/callback', async (req: Request, res: Response) => {
  const { merchant_id, code, employee_id } = req.query;

  if (!code || !merchant_id || typeof code !== 'string' || typeof merchant_id !== 'string') {
    res.status(400).json({ error: 'Missing merchant_id or authorization code' });
    return;
  }

  try {
    // Exchange authorization code for access token
    const tokenUrl = `${getCloverOAuthBaseUrl()}/oauth/token`;
    const params = new URLSearchParams({
      client_id: CLOVER_APP_ID,
      client_secret: CLOVER_APP_SECRET,
      code,
    });

    const tokenResponse = await fetch(`${tokenUrl}?${params.toString()}`);

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      logger.error('CloverAppMarket', `Token exchange failed: ${errorBody}`);
      res.status(500).json({ error: 'Failed to exchange authorization code' });
      return;
    }

    const tokenData = await tokenResponse.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    logger.info('CloverAppMarket', `Got access token for merchant ${merchant_id}`);

    // Fetch merchant details from Clover API
    const merchant = await getCloverMerchant(merchant_id, accessToken);

    // Store in CloverMerchant table
    await prisma.cloverMerchant.upsert({
      where: { merchantId: merchant_id },
      update: { accessToken, name: merchant.name || 'Clover Merchant', active: true },
      create: { merchantId: merchant_id, accessToken, name: merchant.name || 'Clover Merchant' },
    });

    // Find or create organization
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({
        data: { name: merchant.name || 'My Restaurant' },
      });
    }

    // Create or update location
    let location = await prisma.location.findFirst({
      where: { cloverMerchantId: merchant_id },
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
          cloverMerchantId: merchant_id,
          cloverApiToken: accessToken,
        },
      });
    } else {
      location = await prisma.location.update({
        where: { id: location.id },
        data: {
          cloverApiToken: accessToken,
          name: merchant.name || location.name,
        },
      });
    }

    logger.info('CloverAppMarket', `Merchant onboarded: ${location.name} (${merchant_id})`);

    // Trigger initial data sync in background
    initialCloverSync(location.id)
      .then(() => analyzeLocation(location!.id))
      .then(() => logger.info('CloverAppMarket', `Initial sync complete for ${location!.name}`))
      .catch((err) => logger.error('CloverAppMarket', `Background sync failed`, err));

    // Redirect to dashboard
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://tempoai-three.vercel.app';
    res.redirect(`${dashboardUrl}/onboard?success=true&merchant=${merchant_id}&location=${encodeURIComponent(location.name)}`);
  } catch (err) {
    logger.error('CloverAppMarket', 'OAuth callback failed', err);
    res.status(500).json({ error: 'OAuth failed', message: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Clover Webhooks ────────────────────────────────────
// Handles install/uninstall events from Clover App Market
router.post('/clover/webhooks', async (req: Request, res: Response) => {
  try {
    const { type, merchantId, appId } = req.body as {
      type?: string;
      merchantId?: string;
      appId?: string;
    };

    if (!type || !merchantId) {
      res.status(400).json({ error: 'Missing type or merchantId' });
      return;
    }

    logger.info('CloverWebhook', `Received ${type} for merchant ${merchantId}`);

    switch (type) {
      case 'APP_INSTALLED': {
        // Merchant installed our app — they'll go through OAuth next
        // Create a placeholder record if it doesn't exist
        const existing = await prisma.cloverMerchant.findUnique({
          where: { merchantId },
        });
        if (!existing) {
          await prisma.cloverMerchant.create({
            data: {
              merchantId,
              accessToken: '',
              name: 'Pending OAuth',
              active: true,
            },
          });
          logger.info('CloverWebhook', `Created placeholder for merchant ${merchantId}`);
        }
        res.json({ received: true, action: 'merchant_created' });
        break;
      }

      case 'APP_UNINSTALLED': {
        // Deactivate merchant
        const merchant = await prisma.cloverMerchant.findUnique({
          where: { merchantId },
        });

        if (merchant) {
          await prisma.cloverMerchant.update({
            where: { merchantId },
            data: { active: false, uninstalledAt: new Date() },
          });

          // Also deactivate the associated location
          const location = await prisma.location.findFirst({
            where: { cloverMerchantId: merchantId },
          });
          if (location) {
            await prisma.location.update({
              where: { id: location.id },
              data: { cloverApiToken: null },
            });
          }

          logger.info('CloverWebhook', `Deactivated merchant ${merchantId}`);
        }

        res.json({ received: true, action: 'merchant_deactivated' });
        break;
      }

      default:
        logger.info('CloverWebhook', `Unhandled event type: ${type}`);
        res.json({ received: true, action: 'ignored' });
    }
  } catch (err) {
    logger.error('CloverWebhook', 'Webhook processing failed', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ─── Clover Merchants (Admin) ───────────────────────────
router.get('/clover/merchants', async (_req: Request, res: Response) => {
  const merchants = await prisma.cloverMerchant.findMany({
    orderBy: { installedAt: 'desc' },
  });

  res.json({
    total: merchants.length,
    active: merchants.filter((m) => m.active).length,
    merchants: merchants.map((m) => ({
      id: m.id,
      merchantId: m.merchantId,
      name: m.name,
      plan: m.plan,
      active: m.active,
      installedAt: m.installedAt,
      uninstalledAt: m.uninstalledAt,
    })),
  });
});

// ─── Clover Merchant Status ─────────────────────────────
router.get('/clover/merchants/:merchantId/status', async (req: Request, res: Response) => {
  const merchantId = paramStr(req.params.merchantId);

  const merchant = await prisma.cloverMerchant.findUnique({
    where: { merchantId },
  });

  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  // Find associated location
  const location = await prisma.location.findFirst({
    where: { cloverMerchantId: merchantId },
  });

  // Get latest sync logs
  const recentSyncs = location
    ? await prisma.syncLog.findMany({
        where: { locationId: location.id, source: { startsWith: 'clover' } },
        orderBy: { timestamp: 'desc' },
        take: 5,
      })
    : [];

  // Get counts
  const counts = location
    ? await prisma.location.findUnique({
        where: { id: location.id },
        include: {
          _count: { select: { orders: true, menuItems: true, recommendations: true } },
        },
      })
    : null;

  res.json({
    merchant: {
      id: merchant.id,
      merchantId: merchant.merchantId,
      name: merchant.name,
      plan: merchant.plan,
      active: merchant.active,
      installedAt: merchant.installedAt,
    },
    location: location
      ? {
          id: location.id,
          name: location.name,
          address: location.address,
          orders: counts?._count.orders ?? 0,
          menuItems: counts?._count.menuItems ?? 0,
          recommendations: counts?._count.recommendations ?? 0,
        }
      : null,
    recentSyncs,
  });
});
