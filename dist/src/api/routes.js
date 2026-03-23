"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const client_1 = __importDefault(require("../db/client"));
const encryption_1 = require("../utils/encryption");
const client_2 = require("../integrations/square/client");
const sync_1 = require("../integrations/square/sync");
const client_3 = require("../integrations/weather/client");
const client_4 = require("../integrations/clover/client");
const sync_2 = require("../integrations/clover/sync");
const client_5 = require("../integrations/weather/client");
const engine_1 = require("../ai/engine");
const dayparts_1 = require("../utils/dayparts");
const logger_1 = require("../utils/logger");
const billing_1 = __importDefault(require("./billing"));
const auth_1 = __importDefault(require("./auth"));
const auth_2 = require("./middleware/auth");
const daily_summary_1 = require("../services/daily-summary");
const alerts_1 = require("../services/alerts");
const forecasting_1 = require("../services/forecasting");
const food_cost_1 = require("../services/food-cost");
const reviews_1 = require("../services/reviews");
const email_1 = require("../services/email");
const router = (0, express_1.Router)();
// ─── Billing ──────────────────────────────────────────────
router.use('/billing', billing_1.default);
// ─── Auth ────────────────────────────────────────────────
router.use('/auth', auth_1.default);
// Alias: /api/signup → /api/auth/signup (for get-started form)
router.post('/signup', (req, res, next) => {
    req.url = '/signup';
    (0, auth_1.default)(req, res, next);
});
function paramStr(val) {
    return Array.isArray(val) ? val[0] : val ?? '';
}
// ─── Health ───────────────────────────────────────────────
router.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        demoMode: process.env.DEMO_MODE === 'true',
    });
});
// ─── Square OAuth ─────────────────────────────────────────
router.post('/auth/square/connect', (req, res) => {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/square/callback`;
    const url = (0, client_2.getOAuthUrl)(redirectUri);
    res.json({ authUrl: url });
});
router.get('/auth/square/callback', async (req, res) => {
    const { code } = req.query;
    if (!code || typeof code !== 'string') {
        res.status(400).json({ error: 'Missing authorization code' });
        return;
    }
    try {
        const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/square/callback`;
        const tokens = await (0, client_2.exchangeOAuthCode)(code, redirectUri);
        logger_1.logger.info('Auth', `Square merchant connected: ${tokens.merchantId}`);
        res.json({ success: true, merchantId: tokens.merchantId });
    }
    catch (err) {
        logger_1.logger.error('Auth', 'Square OAuth callback failed', err);
        res.status(500).json({ error: 'OAuth failed' });
    }
});
// ─── Square OAuth Production Flow ─────────────────────────
// GET /square/oauth/authorize — redirects merchant to Square's OAuth page
router.get('/square/oauth/authorize', (req, res) => {
    const redirectUri = req.query.redirect_uri;
    const callbackUrl = `${process.env.ENGINE_URL || 'https://api.usetempoai.com'}/api/square/oauth/callback`;
    // Store the dashboard redirect_uri so we can send the merchant back after OAuth
    const state = redirectUri ? Buffer.from(redirectUri).toString('base64') : '';
    const appId = process.env.SQUARE_APP_ID;
    const baseUrl = process.env.SQUARE_ENVIRONMENT === 'production'
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
router.get('/square/oauth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || typeof code !== 'string') {
        res.status(400).json({ error: 'Missing authorization code' });
        return;
    }
    try {
        const callbackUrl = `${process.env.ENGINE_URL || 'https://api.usetempoai.com'}/api/square/oauth/callback`;
        const tokens = await (0, client_2.exchangeOAuthCode)(code, callbackUrl);
        logger_1.logger.info('SquareOAuth', `Got tokens for merchant ${tokens.merchantId}`);
        // Fetch merchant locations from Square
        const squareLocations = await (0, client_2.listLocations)(tokens.accessToken);
        // Store SquareMerchant record (tokens encrypted at rest)
        const encryptedAccessToken = (0, encryption_1.encrypt)(tokens.accessToken);
        const encryptedRefreshToken = (0, encryption_1.encrypt)(tokens.refreshToken);
        await client_1.default.squareMerchant.upsert({
            where: { merchantId: tokens.merchantId },
            update: {
                accessToken: encryptedAccessToken,
                refreshToken: encryptedRefreshToken,
                expiresAt: tokens.expiresAt,
                locations: JSON.stringify(squareLocations.map((l) => ({ id: l.id, name: l.name }))),
                active: true,
            },
            create: {
                merchantId: tokens.merchantId,
                accessToken: encryptedAccessToken,
                refreshToken: encryptedRefreshToken,
                expiresAt: tokens.expiresAt,
                name: squareLocations[0]?.businessName ?? 'Square Merchant',
                locations: JSON.stringify(squareLocations.map((l) => ({ id: l.id, name: l.name }))),
            },
        });
        // Fetch merchant profile for email (Fix 3)
        let merchantEmail;
        try {
            const merchantInfo = await (0, client_2.getMerchantInfo)(tokens.merchantId, tokens.accessToken);
            // Square Merchant API doesn't expose email; get it from Location.businessEmail
            merchantEmail = squareLocations.find((l) => l.businessEmail)?.businessEmail ?? undefined;
            // Update SquareMerchant email if found
            if (merchantEmail) {
                await client_1.default.squareMerchant.update({
                    where: { merchantId: tokens.merchantId },
                    data: { email: merchantEmail },
                });
            }
        }
        catch {
            // Fall back to placeholder email
        }
        // Find or create organization scoped to THIS merchant (Fix 2)
        const existingSquareLocation = await client_1.default.location.findFirst({
            where: { squareMerchantId: { in: squareLocations.map((l) => l.id) } },
            include: { organization: true },
        });
        let org = existingSquareLocation
            ? existingSquareLocation.organization
            : await client_1.default.organization.create({
                data: { name: squareLocations[0]?.businessName ?? 'My Restaurant' },
            });
        // Create Location records for each Square location
        const createdLocationIds = [];
        for (const sl of squareLocations) {
            let location = await client_1.default.location.findFirst({
                where: { squareMerchantId: sl.id },
            });
            const addr = sl.address;
            const addressStr = addr
                ? [addr.addressLine1, addr.locality, addr.administrativeDistrictLevel1].filter(Boolean).join(', ')
                : '';
            const lat = sl.coordinates?.latitude ?? 0;
            const lng = sl.coordinates?.longitude ?? 0;
            if (!location) {
                location = await client_1.default.location.create({
                    data: {
                        organizationId: org.id,
                        name: sl.name ?? sl.businessName ?? 'Square Location',
                        address: addressStr,
                        lat,
                        lng,
                        timezone: sl.timezone ?? 'America/New_York',
                        squareMerchantId: sl.id,
                        squareAccessToken: encryptedAccessToken,
                    },
                });
            }
            else {
                location = await client_1.default.location.update({
                    where: { id: location.id },
                    data: {
                        squareAccessToken: encryptedAccessToken,
                        name: sl.name ?? location.name,
                        address: addressStr || location.address,
                        lat: lat || location.lat,
                        lng: lng || location.lng,
                    },
                });
            }
            createdLocationIds.push(location.id);
        }
        // Auto-create User account for this merchant (Fix 1)
        const userEmail = merchantEmail || `merchant-${tokens.merchantId}@usetempoai.com`;
        let tempPassword;
        const existingUser = await client_1.default.user.findUnique({ where: { email: userEmail } });
        if (!existingUser) {
            tempPassword = crypto_1.default.randomBytes(12).toString('base64url');
            const passwordHash = await bcryptjs_1.default.hash(tempPassword, 12);
            await client_1.default.user.create({
                data: {
                    email: userEmail,
                    passwordHash,
                    name: squareLocations[0]?.businessName ?? 'Square Merchant',
                    organizationId: org.id,
                    emailVerified: true,
                },
            });
            logger_1.logger.info('SquareOAuth', `Auto-created user account: ${userEmail}`);
        }
        // Trigger initial sync for all locations in background
        for (const locId of createdLocationIds) {
            (0, sync_1.initialSync)(locId)
                .then(() => (0, client_3.snapshotWeather)(locId))
                .then(() => (0, engine_1.analyzeLocation)(locId))
                .then(() => logger_1.logger.info('SquareOAuth', `Initial sync + analysis complete for location ${locId}`))
                .catch((err) => logger_1.logger.error('SquareOAuth', `Background sync failed for ${locId}`, err));
        }
        // Redirect back to dashboard
        let dashboardRedirect = process.env.DASHBOARD_URL || 'https://usetempoai.com';
        if (state && typeof state === 'string') {
            try {
                dashboardRedirect = Buffer.from(state, 'base64').toString('utf-8');
            }
            catch {
                // Use default
            }
        }
        const merchantParam = encodeURIComponent(tokens.merchantId);
        let redirectUrl = `${dashboardRedirect}?merchantId=${merchantParam}`;
        if (tempPassword) {
            redirectUrl += `&tempEmail=${encodeURIComponent(userEmail)}&tempPassword=${encodeURIComponent(tempPassword)}`;
        }
        res.redirect(redirectUrl);
    }
    catch (err) {
        logger_1.logger.error('SquareOAuth', 'OAuth callback failed', err);
        const dashboardUrl = process.env.DASHBOARD_URL || 'https://usetempoai.com';
        res.redirect(`${dashboardUrl}/onboard?error=oauth_failed`);
    }
});
// GET /square/merchants — list connected Square merchants
router.get('/square/merchants', async (_req, res) => {
    const merchants = await client_1.default.squareMerchant.findMany({
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
router.get('/square/merchants/:merchantId/status', async (req, res) => {
    const merchantId = paramStr(req.params.merchantId);
    const merchant = await client_1.default.squareMerchant.findUnique({
        where: { merchantId },
    });
    if (!merchant) {
        res.status(404).json({ error: 'Merchant not found' });
        return;
    }
    // Find associated locations
    const locations = await client_1.default.location.findMany({
        where: { squareMerchantId: { in: JSON.parse(merchant.locations).map((l) => l.id) } },
        include: {
            _count: { select: { orders: true, menuItems: true, recommendations: true, weatherSnapshots: true } },
        },
    });
    // Get latest sync logs
    const recentSyncs = locations.length > 0
        ? await client_1.default.syncLog.findMany({
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
router.get('/onboard/status/:merchantId', async (req, res) => {
    const merchantId = paramStr(req.params.merchantId);
    // Check SquareMerchant first, then CloverMerchant
    const squareMerchant = await client_1.default.squareMerchant.findUnique({ where: { merchantId } });
    const cloverMerchant = !squareMerchant
        ? await client_1.default.cloverMerchant.findUnique({ where: { merchantId } })
        : null;
    if (!squareMerchant && !cloverMerchant) {
        res.status(404).json({ error: 'Merchant not found' });
        return;
    }
    // Find locations for this merchant
    const locations = squareMerchant
        ? await client_1.default.location.findMany({
            where: { squareMerchantId: { in: JSON.parse(squareMerchant.locations).map((l) => l.id) } },
            include: {
                _count: { select: { orders: true, menuItems: true, weatherSnapshots: true, recommendations: true } },
            },
        })
        : await client_1.default.location.findMany({
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
router.get('/locations', auth_2.optionalAuth, async (req, res) => {
    // Org-scoping: non-admin authenticated users only see their org's locations
    const where = req.user && req.user.role !== 'ADMIN' && req.user.organizationId
        ? { organizationId: req.user.organizationId }
        : {};
    const locations = await client_1.default.location.findMany({
        where,
        include: {
            organization: true,
            _count: { select: { orders: true, menuItems: true, recommendations: true } },
        },
    });
    res.json(locations);
});
router.get('/locations/:id', async (req, res) => {
    const id = paramStr(req.params.id);
    const location = await client_1.default.location.findUnique({
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
    const latestWeather = await client_1.default.weatherSnapshot.findFirst({
        where: { locationId: location.id },
        orderBy: { timestamp: 'desc' },
    });
    res.json({ ...location, currentWeather: latestWeather });
});
// ─── Orders ───────────────────────────────────────────────
router.get('/locations/:id/orders', async (req, res) => {
    const id = paramStr(req.params.id);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const orders = await client_1.default.order.findMany({
        where: { locationId: id },
        include: {
            orderItems: { include: { menuItem: true } },
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
    });
    const total = await client_1.default.order.count({
        where: { locationId: id },
    });
    res.json({ orders, total, limit, offset });
});
// ─── Menu ─────────────────────────────────────────────────
router.get('/locations/:id/menu', async (req, res) => {
    const id = paramStr(req.params.id);
    const menuItems = await client_1.default.menuItem.findMany({
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
router.get('/locations/:id/weather', async (req, res) => {
    const id = paramStr(req.params.id);
    const location = await client_1.default.location.findUnique({
        where: { id },
    });
    if (!location) {
        res.status(404).json({ error: 'Location not found' });
        return;
    }
    const snapshots = await client_1.default.weatherSnapshot.findMany({
        where: { locationId: id },
        orderBy: { timestamp: 'desc' },
        take: 24,
    });
    let live = null;
    if (process.env.DEMO_MODE !== 'true') {
        try {
            live = await (0, client_5.fetchWeather)(location.lat, location.lng);
        }
        catch {
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
router.get('/recommendations', async (_req, res) => {
    const recommendations = await client_1.default.recommendation.findMany({
        where: { status: 'active' },
        include: { menuItem: true, location: true },
        orderBy: { expectedLift: 'desc' },
    });
    res.json(recommendations);
});
router.get('/recommendations/:locationId', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    const recommendations = await client_1.default.recommendation.findMany({
        where: { locationId, status: 'active' },
        include: { menuItem: true },
        orderBy: { expectedLift: 'desc' },
    });
    res.json(recommendations);
});
router.post('/recommendations/:id/apply', async (req, res) => {
    const id = paramStr(req.params.id);
    const recommendation = await client_1.default.recommendation.update({
        where: { id },
        data: { status: 'applied', appliedAt: new Date() },
    });
    res.json(recommendation);
});
// ─── Active Promos ───────────────────────────────────────
function generatePromoText(itemName, price, triggerType, triggerCondition) {
    const priceStr = `$${price.toFixed(2)}`;
    switch (triggerType) {
        case 'temperature':
            if (triggerCondition === 'temp > 85')
                return `Beat the heat! Try our refreshing ${itemName} — just ${priceStr}`;
            if (triggerCondition === 'temp < 60')
                return `Warm up with our delicious ${itemName} — only ${priceStr}`;
            return `Perfect weather for our ${itemName} — just ${priceStr}`;
        case 'weather':
            if (['rain', 'drizzle', 'thunderstorm'].includes(triggerCondition))
                return `Rainy day comfort — treat yourself to ${itemName} for ${priceStr}`;
            if (triggerCondition === 'snow')
                return `Snow day special — warm up with ${itemName} for ${priceStr}`;
            if (triggerCondition === 'clear')
                return `Beautiful day for our ${itemName} — just ${priceStr}`;
            return `Try our ${itemName} today — only ${priceStr}`;
        case 'daypart':
            if (['early_morning', 'breakfast'].includes(triggerCondition))
                return `Start your morning right with ${itemName} — ${priceStr}`;
            if (triggerCondition === 'lunch')
                return `Lunchtime favorite — grab ${itemName} for just ${priceStr}`;
            if (triggerCondition === 'afternoon')
                return `Afternoon pick-me-up: ${itemName} for just ${priceStr}`;
            if (triggerCondition === 'dinner')
                return `Tonight's pick: ${itemName} — only ${priceStr}`;
            return `Late night craving? Try our ${itemName} — ${priceStr}`;
        case 'day_of_week':
            return `Happy ${triggerCondition}! Enjoy our ${itemName} — just ${priceStr}`;
        case 'trend':
            if (triggerCondition === 'trending_up')
                return `Trending now: ${itemName} — try it for ${priceStr}`;
            return `Rediscover our ${itemName} — just ${priceStr}`;
        default:
            return `Try our ${itemName} — only ${priceStr}`;
    }
}
function matchesTrigger(triggerType, triggerCondition, temperature, weatherCondition, currentDaypart, currentDayName) {
    switch (triggerType) {
        case 'temperature': {
            if (temperature === null)
                return false;
            if (triggerCondition === 'temp < 60')
                return temperature < 60;
            if (triggerCondition === 'temp 60-75')
                return temperature >= 60 && temperature < 75;
            if (triggerCondition === 'temp 75-85')
                return temperature >= 75 && temperature < 85;
            if (triggerCondition === 'temp > 85')
                return temperature >= 85;
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
router.get('/active-promos/:locationId', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    try {
        const location = await client_1.default.location.findUnique({ where: { id: locationId } });
        if (!location) {
            res.status(404).json({ error: 'Location not found' });
            return;
        }
        // Get latest weather snapshot
        const latestWeather = await client_1.default.weatherSnapshot.findFirst({
            where: { locationId },
            orderBy: { timestamp: 'desc' },
        });
        // Current time info
        const now = new Date();
        const hour = now.getHours();
        const dayOfWeekNum = now.getDay();
        const currentDaypart = (0, dayparts_1.getDaypart)(hour);
        const currentDayName = (0, dayparts_1.getDayName)(dayOfWeekNum);
        const temperature = latestWeather?.temperature ?? null;
        const weatherCondition = latestWeather?.conditions ?? null;
        // Get all active recommendations for this location
        const recommendations = await client_1.default.recommendation.findMany({
            where: { locationId, status: 'active' },
            include: { menuItem: true },
            orderBy: { expectedLift: 'desc' },
        });
        // Filter to only those whose trigger conditions match right now
        const matchingRecs = recommendations.filter((rec) => matchesTrigger(rec.triggerType, rec.triggerCondition, temperature, weatherCondition, currentDaypart, currentDayName));
        // Top 10 by expectedLift (already sorted desc)
        const top10 = matchingRecs.slice(0, 10);
        const activePromos = top10.map((rec) => {
            const channels = JSON.parse(rec.channels);
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
    }
    catch (err) {
        logger_1.logger.error('ActivePromos', 'Failed to get active promos', err);
        res.status(500).json({ error: 'Failed to get active promotions' });
    }
});
// ─── Insights ─────────────────────────────────────────────
router.get('/insights', async (_req, res) => {
    const patterns = await client_1.default.aIPattern.findMany({
        include: { menuItem: true, location: true },
        orderBy: { liftPercent: 'desc' },
    });
    const grouped = patterns.reduce((acc, p) => {
        if (!acc[p.patternType])
            acc[p.patternType] = [];
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
router.get('/analytics/revenue', async (req, res) => {
    const locationId = req.query.locationId;
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = {
        timestamp: { gte: since },
        ...(locationId && { locationId }),
    };
    const orders = await client_1.default.order.findMany({
        where,
        orderBy: { timestamp: 'asc' },
    });
    const dailyRevenue = new Map();
    for (const order of orders) {
        const dateKey = order.timestamp.toISOString().split('T')[0];
        const existing = dailyRevenue.get(dateKey);
        if (existing) {
            existing.revenue += order.total;
            existing.orderCount += 1;
        }
        else {
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
router.get('/analytics/items', async (req, res) => {
    const locationId = req.query.locationId;
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const orderItems = await client_1.default.orderItem.findMany({
        where: {
            order: {
                timestamp: { gte: since },
                ...(locationId && { locationId }),
            },
        },
        include: { menuItem: true },
    });
    const itemStats = new Map();
    for (const oi of orderItems) {
        const existing = itemStats.get(oi.menuItemId);
        if (existing) {
            existing.totalQuantity += oi.quantity;
            existing.totalRevenue += oi.amount;
            existing.orderCount += 1;
        }
        else {
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
router.post('/sync/trigger', async (req, res) => {
    const { locationId } = req.body;
    try {
        if (locationId) {
            const catalogCount = await (0, sync_1.syncLocationCatalog)(locationId);
            const orderCount = await (0, sync_1.syncLocationOrders)(locationId);
            const analysis = await (0, engine_1.analyzeLocation)(locationId);
            res.json({
                success: true,
                catalogSynced: catalogCount,
                ordersSynced: orderCount,
                ...analysis,
            });
        }
        else {
            await (0, sync_1.syncAllLocations)();
            await (0, engine_1.analyzeAllLocations)();
            res.json({ success: true, message: 'All locations synced and analyzed' });
        }
    }
    catch (err) {
        logger_1.logger.error('Sync', 'Manual sync trigger failed', err);
        res.status(500).json({ error: 'Sync failed', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── AI Analysis trigger ──────────────────────────────────
router.post('/analyze', async (req, res) => {
    const { locationId } = req.body;
    try {
        if (locationId) {
            const result = await (0, engine_1.analyzeLocation)(locationId);
            res.json({ success: true, ...result });
        }
        else {
            await (0, engine_1.analyzeAllLocations)();
            res.json({ success: true, message: 'All locations analyzed' });
        }
    }
    catch (err) {
        logger_1.logger.error('AI', 'Analysis trigger failed', err);
        res.status(500).json({ error: 'Analysis failed' });
    }
});
// ─── Square Onboarding ───────────────────────────────────
router.post('/onboard/square', async (req, res) => {
    const { accessToken, locationId } = req.body;
    if (!accessToken || !locationId) {
        res.status(400).json({ error: 'accessToken and locationId are required' });
        return;
    }
    try {
        // Fetch Square locations to get details
        const squareLocations = await (0, client_2.listLocations)(accessToken);
        const squareLocation = squareLocations.find((l) => l.id === locationId);
        if (!squareLocation) {
            res.status(404).json({ error: `Location ${locationId} not found in Square account` });
            return;
        }
        // Find or create organization scoped to THIS merchant (Fix 2)
        let location = await client_1.default.location.findFirst({
            where: { squareMerchantId: locationId },
        });
        let org = location
            ? await client_1.default.organization.findUnique({ where: { id: location.organizationId } })
            : null;
        if (!org) {
            org = await client_1.default.organization.create({
                data: { name: squareLocation.businessName ?? 'My Restaurant' },
            });
        }
        // Create or update the location in our DB
        const encryptedSquareToken = (0, encryption_1.encrypt)(accessToken);
        if (!location) {
            location = await client_1.default.location.create({
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
                    squareAccessToken: encryptedSquareToken,
                },
            });
        }
        else {
            location = await client_1.default.location.update({
                where: { id: location.id },
                data: {
                    squareAccessToken: encryptedSquareToken,
                    name: squareLocation.name ?? location.name,
                },
            });
        }
        logger_1.logger.info('Onboard', `Onboarding Square location: ${location.name} (${location.id})`);
        // Run initial sync (90 days of history)
        const syncResult = await (0, sync_1.initialSync)(location.id);
        // Run AI analysis
        const analysis = await (0, engine_1.analyzeLocation)(location.id);
        res.json({
            success: true,
            locationId: location.id,
            locationName: location.name,
            sync: syncResult,
            analysis,
        });
    }
    catch (err) {
        logger_1.logger.error('Onboard', 'Square onboarding failed', err);
        res.status(500).json({
            error: 'Onboarding failed',
            message: err instanceof Error ? err.message : String(err),
        });
    }
});
// ─── Square Status ───────────────────────────────────────
router.get('/square/status', async (_req, res) => {
    const locations = await client_1.default.location.findMany({
        where: { squareAccessToken: { not: null } },
        select: {
            id: true,
            name: true,
            squareMerchantId: true,
        },
    });
    const lastSync = await client_1.default.syncLog.findFirst({
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
router.post('/square/sync', async (req, res) => {
    const { locationId } = req.body;
    try {
        if (locationId) {
            const catalogCount = await (0, sync_1.syncLocationCatalog)(locationId);
            const orderCount = await (0, sync_1.syncLocationOrders)(locationId);
            res.json({ success: true, catalogSynced: catalogCount, ordersSynced: orderCount });
        }
        else {
            await (0, sync_1.syncAllLocations)();
            res.json({ success: true, message: 'All locations synced' });
        }
    }
    catch (err) {
        logger_1.logger.error('SquareSync', 'Manual sync failed', err);
        res.status(500).json({ error: 'Sync failed', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── Square Analyze ──────────────────────────────────────
router.post('/square/analyze', async (req, res) => {
    const { locationId } = req.body;
    try {
        if (locationId) {
            const result = await (0, engine_1.analyzeLocation)(locationId);
            res.json({ success: true, ...result });
        }
        else {
            await (0, engine_1.analyzeAllLocations)();
            res.json({ success: true, message: 'All locations analyzed' });
        }
    }
    catch (err) {
        logger_1.logger.error('AI', 'Analysis after sync failed', err);
        res.status(500).json({ error: 'Analysis failed', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── Clover Onboarding ───────────────────────────────────
router.post('/onboard/clover', async (req, res) => {
    const { merchantId, apiToken } = req.body;
    if (!merchantId || !apiToken) {
        res.status(400).json({ error: 'merchantId and apiToken are required' });
        return;
    }
    try {
        // Verify merchant credentials
        const merchant = await (0, client_4.getMerchant)(merchantId, apiToken);
        // Find or create organization scoped to THIS merchant (Fix 2)
        let location = await client_1.default.location.findFirst({
            where: { cloverMerchantId: merchantId },
        });
        let org = location
            ? await client_1.default.organization.findUnique({ where: { id: location.organizationId } })
            : null;
        if (!org) {
            org = await client_1.default.organization.create({
                data: { name: merchant.name || 'My Restaurant' },
            });
        }
        // Create or update location
        const encryptedCloverToken = (0, encryption_1.encrypt)(apiToken);
        if (!location) {
            location = await client_1.default.location.create({
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
                    cloverApiToken: encryptedCloverToken,
                },
            });
        }
        else {
            location = await client_1.default.location.update({
                where: { id: location.id },
                data: {
                    cloverApiToken: encryptedCloverToken,
                    name: merchant.name || location.name,
                },
            });
        }
        logger_1.logger.info('Onboard', `Onboarding Clover location: ${location.name} (${location.id})`);
        // Run initial sync
        const syncResult = await (0, sync_2.initialCloverSync)(location.id);
        // Run AI analysis
        const analysis = await (0, engine_1.analyzeLocation)(location.id);
        res.json({
            success: true,
            locationId: location.id,
            locationName: location.name,
            sync: syncResult,
            analysis,
        });
    }
    catch (err) {
        logger_1.logger.error('Onboard', 'Clover onboarding failed', err);
        res.status(500).json({
            error: 'Onboarding failed',
            message: err instanceof Error ? err.message : String(err),
        });
    }
});
// ─── Clover Status ───────────────────────────────────────
router.get('/clover/status', async (_req, res) => {
    const locations = await client_1.default.location.findMany({
        where: { cloverApiToken: { not: null } },
        select: {
            id: true,
            name: true,
            cloverMerchantId: true,
        },
    });
    const lastSync = await client_1.default.syncLog.findFirst({
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
router.post('/clover/sync', async (req, res) => {
    const { locationId } = req.body;
    try {
        if (locationId) {
            const catalogCount = await (0, sync_2.syncCloverCatalog)(locationId);
            const orderCount = await (0, sync_2.syncCloverOrders)(locationId);
            res.json({ success: true, catalogSynced: catalogCount, ordersSynced: orderCount });
        }
        else {
            // Sync all Clover locations
            const locations = await client_1.default.location.findMany({
                where: { cloverApiToken: { not: null } },
            });
            for (const loc of locations) {
                await (0, sync_2.syncCloverCatalog)(loc.id);
                await (0, sync_2.syncCloverOrders)(loc.id);
            }
            res.json({ success: true, message: 'All Clover locations synced' });
        }
    }
    catch (err) {
        logger_1.logger.error('CloverSync', 'Manual sync failed', err);
        res.status(500).json({ error: 'Sync failed', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── Clover Analyze ──────────────────────────────────────
router.post('/clover/analyze', async (req, res) => {
    const { locationId } = req.body;
    try {
        if (locationId) {
            const result = await (0, engine_1.analyzeLocation)(locationId);
            res.json({ success: true, ...result });
        }
        else {
            await (0, engine_1.analyzeAllLocations)();
            res.json({ success: true, message: 'All locations analyzed' });
        }
    }
    catch (err) {
        logger_1.logger.error('AI', 'Clover analysis failed', err);
        res.status(500).json({ error: 'Analysis failed', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── AI Sales Forecasting ────────────────────────────────
// GET /api/forecast/:locationId — generate 7-day sales forecast
router.get('/forecast/:locationId', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    try {
        const forecast = await (0, forecasting_1.generateForecast)(locationId);
        res.json({
            locationId,
            generatedAt: new Date().toISOString(),
            days: forecast,
        });
    }
    catch (err) {
        logger_1.logger.error('Forecast', 'Failed to generate forecast', err);
        res.status(500).json({ error: 'Failed to generate forecast', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── Food Cost Tracker ───────────────────────────────────
// POST /api/food-cost/:locationId/items — add/update ingredient costs for a menu item
router.post('/food-cost/:locationId/items', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    const { menuItemId, ingredients } = req.body;
    if (!menuItemId || !ingredients || !Array.isArray(ingredients)) {
        res.status(400).json({ error: 'Missing required fields: menuItemId, ingredients[]' });
        return;
    }
    try {
        await (0, food_cost_1.upsertIngredientCosts)(locationId, menuItemId, ingredients);
        res.json({ success: true, menuItemId, ingredientCount: ingredients.length });
    }
    catch (err) {
        logger_1.logger.error('FoodCost', 'Failed to update ingredient costs', err);
        res.status(500).json({ error: 'Failed to update ingredient costs', message: err instanceof Error ? err.message : String(err) });
    }
});
// GET /api/food-cost/:locationId — get all items with food cost analysis
router.get('/food-cost/:locationId', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    try {
        const items = await (0, food_cost_1.getFoodCostAnalysis)(locationId);
        res.json({ locationId, items });
    }
    catch (err) {
        logger_1.logger.error('FoodCost', 'Failed to get food cost analysis', err);
        res.status(500).json({ error: 'Failed to get food cost analysis', message: err instanceof Error ? err.message : String(err) });
    }
});
// GET /api/food-cost/:locationId/summary — overall food cost % and breakdown
router.get('/food-cost/:locationId/summary', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    try {
        const summary = await (0, food_cost_1.getFoodCostSummary)(locationId);
        res.json(summary);
    }
    catch (err) {
        logger_1.logger.error('FoodCost', 'Failed to get food cost summary', err);
        res.status(500).json({ error: 'Failed to get food cost summary', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── Review Monitoring ───────────────────────────────────
// GET /api/reviews/:locationId — get recent reviews
router.get('/reviews/:locationId', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    try {
        const reviews = await (0, reviews_1.getReviews)(locationId);
        res.json({
            locationId,
            reviewCount: reviews.length,
            reviews,
        });
    }
    catch (err) {
        logger_1.logger.error('Reviews', 'Failed to get reviews', err);
        res.status(500).json({ error: 'Failed to get reviews', message: err instanceof Error ? err.message : String(err) });
    }
});
// POST /api/reviews/:id/draft-response — generate a draft response to a review
router.post('/reviews/:id/draft-response', async (req, res) => {
    const { rating, reviewText, customerName } = req.body;
    if (rating === undefined || !reviewText || !customerName) {
        res.status(400).json({ error: 'Missing required fields: rating, reviewText, customerName' });
        return;
    }
    try {
        const draft = (0, reviews_1.generateDraftResponse)({ rating, reviewText, customerName });
        res.json({ draft });
    }
    catch (err) {
        logger_1.logger.error('Reviews', 'Failed to generate draft response', err);
        res.status(500).json({ error: 'Failed to generate draft response', message: err instanceof Error ? err.message : String(err) });
    }
});
exports.default = router;
// ─── Cashier Suggestions (Real-Time) ─────────────────────
// This endpoint powers live cashier recommendations.
// A Clover app, cashier tablet, or any POS integration hits this
// to get the top items to suggest RIGHT NOW based on current conditions.
router.get('/cashier/suggest/:locationId', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    try {
        const location = await client_1.default.location.findUnique({ where: { id: locationId } });
        if (!location) {
            res.status(404).json({ error: 'Location not found' });
            return;
        }
        // Get current conditions
        const latestWeather = await client_1.default.weatherSnapshot.findFirst({
            where: { locationId },
            orderBy: { timestamp: 'desc' },
        });
        const now = new Date();
        const hour = now.getHours();
        const dayOfWeekNum = now.getDay();
        const currentDaypart = (0, dayparts_1.getDaypart)(hour);
        const currentDayName = (0, dayparts_1.getDayName)(dayOfWeekNum);
        const temperature = latestWeather?.temperature ?? null;
        const weatherCondition = latestWeather?.conditions ?? null;
        // Get active recommendations
        const recommendations = await client_1.default.recommendation.findMany({
            where: { locationId, status: 'active' },
            include: { menuItem: true },
            orderBy: { expectedLift: 'desc' },
        });
        // Filter to matching current conditions
        const matching = recommendations.filter((rec) => matchesTrigger(rec.triggerType, rec.triggerCondition, temperature, weatherCondition, currentDaypart, currentDayName));
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
    }
    catch (err) {
        logger_1.logger.error('Cashier', 'Failed to get suggestions', err);
        res.status(500).json({ error: 'Failed to get cashier suggestions' });
    }
});
// ─── Clover OAuth Flow ───────────────────────────────────
// This is the proper app-market install flow.
// Merchant clicks Install → Clover redirects to us with auth code → we exchange for token.
const CLOVER_APP_ID = process.env.CLOVER_APP_ID || 'j4eb4vp13bmy6';
const CLOVER_APP_SECRET = process.env.CLOVER_APP_SECRET || '';
function getCloverOAuthBaseUrl() {
    const env = process.env.CLOVER_ENVIRONMENT || 'sandbox';
    return env === 'production'
        ? 'https://www.clover.com'
        : 'https://sandbox.dev.clover.com';
}
function getCloverApiBaseUrl() {
    const env = process.env.CLOVER_ENVIRONMENT || 'sandbox';
    return env === 'production'
        ? 'https://api.clover.com'
        : 'https://apisandbox.dev.clover.com';
}
// Step 1: Redirect merchant to Clover authorization page
router.get('/auth/clover/connect', (_req, res) => {
    if (!CLOVER_APP_ID) {
        res.status(500).json({ error: 'CLOVER_APP_ID not configured' });
        return;
    }
    const redirectUri = `${process.env.ENGINE_URL || 'https://api.usetempoai.com'}/api/auth/clover/callback`;
    const authUrl = `${getCloverOAuthBaseUrl()}/oauth/v2/authorize?client_id=${CLOVER_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.redirect(authUrl);
});
// Step 2: Clover redirects back with merchant_id and code
router.get('/auth/clover/callback', async (req, res) => {
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
            logger_1.logger.error('CloverOAuth', `Token exchange failed: ${errorBody}`);
            res.status(500).json({ error: 'Failed to exchange authorization code' });
            return;
        }
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        logger_1.logger.info('CloverOAuth', `Got access token for merchant ${merchant_id}`);
        // Fetch merchant details
        const merchant = await (0, client_4.getMerchant)(merchant_id, accessToken);
        // Find or create organization scoped to THIS merchant (Fix 2)
        let location = await client_1.default.location.findFirst({
            where: { cloverMerchantId: merchant_id },
        });
        let org = location
            ? await client_1.default.organization.findUnique({ where: { id: location.organizationId } })
            : null;
        if (!org) {
            org = await client_1.default.organization.create({
                data: { name: merchant.name || 'My Restaurant' },
            });
        }
        // Create or update location
        if (!location) {
            location = await client_1.default.location.create({
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
        }
        else {
            location = await client_1.default.location.update({
                where: { id: location.id },
                data: {
                    cloverApiToken: accessToken,
                    name: merchant.name || location.name,
                },
            });
        }
        // Store in CloverMerchant table for app market tracking
        await client_1.default.cloverMerchant.upsert({
            where: { merchantId: merchant_id },
            update: { accessToken, name: merchant.name || 'Clover Merchant', active: true },
            create: { merchantId: merchant_id, accessToken, name: merchant.name || 'Clover Merchant' },
        });
        logger_1.logger.info('CloverOAuth', `Onboarded: ${location.name} (${location.id})`);
        // Auto-create User account for this merchant (Fix 1)
        const cloverUserEmail = `merchant-${merchant_id}@usetempoai.com`;
        let cloverTempPassword;
        const existingCloverUser = await client_1.default.user.findUnique({ where: { email: cloverUserEmail } });
        if (!existingCloverUser) {
            cloverTempPassword = crypto_1.default.randomBytes(12).toString('base64url');
            const cloverPasswordHash = await bcryptjs_1.default.hash(cloverTempPassword, 12);
            await client_1.default.user.create({
                data: {
                    email: cloverUserEmail,
                    passwordHash: cloverPasswordHash,
                    name: merchant.name || 'Clover Merchant',
                    organizationId: org.id,
                    emailVerified: true,
                },
            });
            logger_1.logger.info('CloverOAuth', `Auto-created user account: ${cloverUserEmail}`);
        }
        // Run initial sync in background (don't block the redirect)
        (0, sync_2.initialCloverSync)(location.id)
            .then(() => (0, engine_1.analyzeLocation)(location.id))
            .then(() => logger_1.logger.info('CloverOAuth', `Initial sync + analysis complete for ${location.name}`))
            .catch((err) => logger_1.logger.error('CloverOAuth', `Background sync failed for ${location.name}`, err));
        // Redirect to dashboard
        const dashboardUrl = process.env.DASHBOARD_URL || 'https://usetempoai.com';
        let cloverRedirectUrl = `${dashboardUrl}/onboard?success=true&location=${encodeURIComponent(location.name)}`;
        if (cloverTempPassword) {
            cloverRedirectUrl += `&tempEmail=${encodeURIComponent(cloverUserEmail)}&tempPassword=${encodeURIComponent(cloverTempPassword)}`;
        }
        res.redirect(cloverRedirectUrl);
    }
    catch (err) {
        logger_1.logger.error('CloverOAuth', 'OAuth callback failed', err);
        res.status(500).json({ error: 'OAuth failed', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── Clover App Market OAuth Callback ────────────────────
// Dedicated endpoint for Clover App Market redirect URI
router.get('/clover/oauth/callback', async (req, res) => {
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
            logger_1.logger.error('CloverAppMarket', `Token exchange failed: ${errorBody}`);
            res.status(500).json({ error: 'Failed to exchange authorization code' });
            return;
        }
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        logger_1.logger.info('CloverAppMarket', `Got access token for merchant ${merchant_id}`);
        // Fetch merchant details from Clover API
        const merchant = await (0, client_4.getMerchant)(merchant_id, accessToken);
        // Store in CloverMerchant table
        await client_1.default.cloverMerchant.upsert({
            where: { merchantId: merchant_id },
            update: { accessToken, name: merchant.name || 'Clover Merchant', active: true },
            create: { merchantId: merchant_id, accessToken, name: merchant.name || 'Clover Merchant' },
        });
        // Find or create organization scoped to THIS merchant (Fix 2)
        let location = await client_1.default.location.findFirst({
            where: { cloverMerchantId: merchant_id },
        });
        let org = location
            ? await client_1.default.organization.findUnique({ where: { id: location.organizationId } })
            : null;
        if (!org) {
            org = await client_1.default.organization.create({
                data: { name: merchant.name || 'My Restaurant' },
            });
        }
        // Create or update location
        if (!location) {
            location = await client_1.default.location.create({
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
        }
        else {
            location = await client_1.default.location.update({
                where: { id: location.id },
                data: {
                    cloverApiToken: accessToken,
                    name: merchant.name || location.name,
                },
            });
        }
        logger_1.logger.info('CloverAppMarket', `Merchant onboarded: ${location.name} (${merchant_id})`);
        // Auto-create User account for this merchant (Fix 1)
        const appMarketUserEmail = `merchant-${merchant_id}@usetempoai.com`;
        let appMarketTempPassword;
        const existingAppMarketUser = await client_1.default.user.findUnique({ where: { email: appMarketUserEmail } });
        if (!existingAppMarketUser) {
            appMarketTempPassword = crypto_1.default.randomBytes(12).toString('base64url');
            const appMarketPasswordHash = await bcryptjs_1.default.hash(appMarketTempPassword, 12);
            await client_1.default.user.create({
                data: {
                    email: appMarketUserEmail,
                    passwordHash: appMarketPasswordHash,
                    name: merchant.name || 'Clover Merchant',
                    organizationId: org.id,
                    emailVerified: true,
                },
            });
            logger_1.logger.info('CloverAppMarket', `Auto-created user account: ${appMarketUserEmail}`);
        }
        // Trigger initial data sync in background
        (0, sync_2.initialCloverSync)(location.id)
            .then(() => (0, engine_1.analyzeLocation)(location.id))
            .then(() => logger_1.logger.info('CloverAppMarket', `Initial sync complete for ${location.name}`))
            .catch((err) => logger_1.logger.error('CloverAppMarket', `Background sync failed`, err));
        // Redirect to dashboard with credentials
        const dashboardUrl = process.env.DASHBOARD_URL || 'https://usetempoai.com';
        let appMarketRedirectUrl = `${dashboardUrl}/onboard?success=true&merchant=${merchant_id}&location=${encodeURIComponent(location.name)}`;
        if (appMarketTempPassword) {
            appMarketRedirectUrl += `&tempEmail=${encodeURIComponent(appMarketUserEmail)}&tempPassword=${encodeURIComponent(appMarketTempPassword)}`;
        }
        res.redirect(appMarketRedirectUrl);
    }
    catch (err) {
        logger_1.logger.error('CloverAppMarket', 'OAuth callback failed', err);
        res.status(500).json({ error: 'OAuth failed', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── Clover Webhooks ────────────────────────────────────
// Handles install/uninstall events from Clover App Market
router.post('/clover/webhooks', async (req, res) => {
    try {
        const { type, merchantId, appId } = req.body;
        if (!type || !merchantId) {
            res.status(400).json({ error: 'Missing type or merchantId' });
            return;
        }
        logger_1.logger.info('CloverWebhook', `Received ${type} for merchant ${merchantId}`);
        switch (type) {
            case 'APP_INSTALLED': {
                // Merchant installed our app — they'll go through OAuth next
                // Create a placeholder record if it doesn't exist
                const existing = await client_1.default.cloverMerchant.findUnique({
                    where: { merchantId },
                });
                if (!existing) {
                    await client_1.default.cloverMerchant.create({
                        data: {
                            merchantId,
                            accessToken: '',
                            name: 'Pending OAuth',
                            active: true,
                        },
                    });
                    logger_1.logger.info('CloverWebhook', `Created placeholder for merchant ${merchantId}`);
                }
                res.json({ received: true, action: 'merchant_created' });
                break;
            }
            case 'APP_UNINSTALLED': {
                // Deactivate merchant
                const merchant = await client_1.default.cloverMerchant.findUnique({
                    where: { merchantId },
                });
                if (merchant) {
                    await client_1.default.cloverMerchant.update({
                        where: { merchantId },
                        data: { active: false, uninstalledAt: new Date() },
                    });
                    // Also deactivate the associated location
                    const location = await client_1.default.location.findFirst({
                        where: { cloverMerchantId: merchantId },
                    });
                    if (location) {
                        await client_1.default.location.update({
                            where: { id: location.id },
                            data: { cloverApiToken: null },
                        });
                    }
                    logger_1.logger.info('CloverWebhook', `Deactivated merchant ${merchantId}`);
                }
                res.json({ received: true, action: 'merchant_deactivated' });
                break;
            }
            default:
                logger_1.logger.info('CloverWebhook', `Unhandled event type: ${type}`);
                res.json({ received: true, action: 'ignored' });
        }
    }
    catch (err) {
        logger_1.logger.error('CloverWebhook', 'Webhook processing failed', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});
// ─── Clover Merchants (Admin) ───────────────────────────
router.get('/clover/merchants', async (_req, res) => {
    const merchants = await client_1.default.cloverMerchant.findMany({
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
router.get('/clover/merchants/:merchantId/status', async (req, res) => {
    const merchantId = paramStr(req.params.merchantId);
    const merchant = await client_1.default.cloverMerchant.findUnique({
        where: { merchantId },
    });
    if (!merchant) {
        res.status(404).json({ error: 'Merchant not found' });
        return;
    }
    // Find associated location
    const location = await client_1.default.location.findFirst({
        where: { cloverMerchantId: merchantId },
    });
    // Get latest sync logs
    const recentSyncs = location
        ? await client_1.default.syncLog.findMany({
            where: { locationId: location.id, source: { startsWith: 'clover' } },
            orderBy: { timestamp: 'desc' },
            take: 5,
        })
        : [];
    // Get counts
    const counts = location
        ? await client_1.default.location.findUnique({
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
// ─── Daily Summary ───────────────────────────────────────
// POST /api/reports/daily-summary — generate a daily summary for a location
router.post('/reports/daily-summary', async (req, res) => {
    const { locationId, date } = req.body;
    if (!locationId) {
        res.status(400).json({ error: 'locationId is required' });
        return;
    }
    try {
        const summaryDate = date ? new Date(date) : new Date();
        const summary = await (0, daily_summary_1.generateDailySummary)(locationId, summaryDate);
        res.json(summary);
    }
    catch (err) {
        logger_1.logger.error('Reports', 'Failed to generate daily summary', err);
        res.status(500).json({ error: 'Failed to generate summary', message: err instanceof Error ? err.message : String(err) });
    }
});
// GET /api/reports/daily-summary/:locationId — retrieve the latest summary
router.get('/reports/daily-summary/:locationId', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    try {
        const summary = await client_1.default.dailySummary.findFirst({
            where: { locationId },
            orderBy: { date: 'desc' },
        });
        if (!summary) {
            res.status(404).json({ error: 'No summary found for this location' });
            return;
        }
        res.json({
            ...summary,
            topItems: JSON.parse(summary.topItems),
        });
    }
    catch (err) {
        logger_1.logger.error('Reports', 'Failed to retrieve daily summary', err);
        res.status(500).json({ error: 'Failed to retrieve summary', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── Smart Alerts ────────────────────────────────────────
// GET /api/alerts/:locationId — get active alerts for a location
router.get('/alerts/:locationId', async (req, res) => {
    const locationId = paramStr(req.params.locationId);
    try {
        // Run alert evaluation first to ensure alerts are current
        await (0, alerts_1.evaluateAlerts)(locationId);
        const alerts = await (0, alerts_1.getActiveAlerts)(locationId);
        res.json({
            locationId,
            alertCount: alerts.length,
            alerts: alerts.map(a => ({
                ...a,
                data: JSON.parse(a.data),
            })),
        });
    }
    catch (err) {
        logger_1.logger.error('Alerts', 'Failed to get alerts', err);
        res.status(500).json({ error: 'Failed to retrieve alerts', message: err instanceof Error ? err.message : String(err) });
    }
});
// POST /api/alerts/:id/acknowledge — dismiss an alert
router.post('/alerts/:id/acknowledge', async (req, res) => {
    const alertId = paramStr(req.params.id);
    try {
        const alert = await (0, alerts_1.acknowledgeAlert)(alertId);
        res.json({ success: true, alert: { ...alert, data: JSON.parse(alert.data) } });
    }
    catch (err) {
        logger_1.logger.error('Alerts', 'Failed to acknowledge alert', err);
        res.status(500).json({ error: 'Failed to acknowledge alert', message: err instanceof Error ? err.message : String(err) });
    }
});
// ─── Email Digest ─────────────────────────────────────────
// POST /api/email/test-digest — send a test daily digest email
router.post('/email/test-digest', async (req, res) => {
    const { to, locationId } = req.body;
    if (!to || typeof to !== 'string') {
        res.status(400).json({ error: 'Missing required field: to (email address)' });
        return;
    }
    try {
        let summary;
        let locationName;
        if (locationId) {
            summary = await (0, daily_summary_1.generateDailySummary)(locationId);
            locationName = summary.locationName;
        }
        else {
            summary = (0, email_1.buildMockSummary)();
            locationName = summary.locationName;
        }
        const result = await (0, email_1.sendDailySummary)(to, summary, locationName);
        if (result.success) {
            res.json({ success: true, emailId: result.id, summary });
        }
        else {
            res.status(502).json({ success: false, error: result.error, summary });
        }
    }
    catch (err) {
        logger_1.logger.error('Email', 'Failed to send test digest', err);
        res.status(500).json({ error: 'Failed to send test digest', message: err instanceof Error ? err.message : String(err) });
    }
});
//# sourceMappingURL=routes.js.map