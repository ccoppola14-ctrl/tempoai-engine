"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.squareIntegration = void 0;
exports.createSquareClient = createSquareClient;
exports.getOAuthUrl = getOAuthUrl;
exports.exchangeOAuthCode = exchangeOAuthCode;
exports.getMerchantInfo = getMerchantInfo;
exports.listLocations = listLocations;
exports.listCatalog = listCatalog;
exports.listOrders = listOrders;
exports.listPayments = listPayments;
const square_1 = require("square");
const logger_1 = require("../../utils/logger");
function getEnvironment() {
    const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
    return env === 'production' ? square_1.SquareEnvironment.Production : square_1.SquareEnvironment.Sandbox;
}
/** Create a SquareClient for a given access token (or use env default). */
function createSquareClient(accessToken) {
    const token = accessToken || process.env.SQUARE_ACCESS_TOKEN || '';
    return new square_1.SquareClient({
        token,
        environment: getEnvironment(),
    });
}
// ─── OAuth (kept for future production use) ───────────────────
function getOAuthUrl(redirectUri) {
    const appId = process.env.SQUARE_APP_ID;
    const baseUrl = process.env.SQUARE_ENVIRONMENT === 'production'
        ? 'https://connect.squareup.com'
        : 'https://connect.squareupsandbox.com';
    const scopes = [
        'ITEMS_READ',
        'ORDERS_READ',
        'ORDERS_WRITE',
        'PAYMENTS_READ',
        'MERCHANT_PROFILE_READ',
    ].join('+');
    return `${baseUrl}/oauth2/authorize?client_id=${appId}&scope=${scopes}&session=false&redirect_uri=${encodeURIComponent(redirectUri)}`;
}
async function exchangeOAuthCode(code, redirectUri) {
    const client = createSquareClient();
    const response = await client.oAuth.obtainToken({
        clientId: process.env.SQUARE_APP_ID || '',
        clientSecret: process.env.SQUARE_APP_SECRET || '',
        code,
        grantType: 'authorization_code',
        redirectUri,
    });
    return {
        accessToken: response.accessToken ?? '',
        refreshToken: response.refreshToken ?? '',
        merchantId: response.merchantId ?? '',
        expiresAt: new Date(response.expiresAt ?? Date.now()),
    };
}
// ─── Merchant Info ────────────────────────────────────────────
async function getMerchantInfo(merchantId, accessToken) {
    const client = createSquareClient(accessToken);
    try {
        const response = await client.merchants.get({ merchantId });
        return {
            businessName: response.merchant?.businessName ?? undefined,
        };
    }
    catch (err) {
        logger_1.logger.warn('SquareClient', `Failed to fetch merchant profile: ${err}`);
        return {};
    }
}
// ─── Locations ────────────────────────────────────────────────
async function listLocations(accessToken) {
    const client = createSquareClient(accessToken);
    const response = await client.locations.list();
    const locations = response.locations ?? [];
    logger_1.logger.info('SquareClient', `Found ${locations.length} locations`);
    return locations;
}
// ─── Catalog ──────────────────────────────────────────────────
async function listCatalog(accessToken) {
    const client = createSquareClient(accessToken);
    const items = [];
    // catalog.list returns an auto-paginated async iterable Page
    const page = await client.catalog.list({ types: 'ITEM' });
    for await (const obj of page) {
        if (obj.type !== 'ITEM')
            continue;
        const itemData = obj.itemData;
        if (!itemData)
            continue;
        const variations = (itemData.variations ?? []).map((v) => ({
            id: v.id,
            name: v.itemVariationData?.name ?? v.id,
            price: Number(v.itemVariationData?.priceMoney?.amount ?? 0n),
        }));
        let category = 'Uncategorized';
        if (itemData.categories && itemData.categories.length > 0) {
            category = itemData.categories[0].name ?? 'Uncategorized';
        }
        else if (itemData.categoryId) {
            category = itemData.categoryId;
        }
        items.push({
            id: obj.id,
            name: itemData.name ?? 'Unknown',
            category,
            price: variations.length > 0 ? variations[0].price : 0,
            variations,
        });
    }
    logger_1.logger.info('SquareClient', `Fetched ${items.length} catalog items`);
    return items;
}
// ─── Orders ───────────────────────────────────────────────────
async function listOrders(locationId, startDate, endDate, accessToken) {
    const client = createSquareClient(accessToken);
    const allOrders = [];
    let cursor;
    do {
        const response = await client.orders.search({
            locationIds: [locationId],
            query: {
                filter: {
                    stateFilter: { states: ['COMPLETED'] },
                    ...(startDate && {
                        dateTimeFilter: {
                            createdAt: {
                                startAt: startDate.toISOString(),
                                ...(endDate && { endAt: endDate.toISOString() }),
                            },
                        },
                    }),
                },
                sort: { sortField: 'CREATED_AT', sortOrder: 'DESC' },
            },
            limit: 500,
            ...(cursor && { cursor }),
        });
        if (response.orders) {
            for (const order of response.orders) {
                allOrders.push({
                    id: order.id ?? '',
                    locationId: order.locationId,
                    createdAt: order.createdAt ?? new Date().toISOString(),
                    totalMoney: {
                        amount: Number(order.totalMoney?.amount ?? 0n),
                        currency: order.totalMoney?.currency ?? 'USD',
                    },
                    lineItems: (order.lineItems ?? []).map((li) => ({
                        catalogObjectId: li.catalogObjectId ?? '',
                        name: li.name ?? 'Unknown',
                        quantity: li.quantity,
                        totalMoney: {
                            amount: Number(li.totalMoney?.amount ?? 0n),
                            currency: li.totalMoney?.currency ?? 'USD',
                        },
                    })),
                    state: order.state ?? 'COMPLETED',
                });
            }
        }
        cursor = response.cursor;
    } while (cursor);
    logger_1.logger.info('SquareClient', `Fetched ${allOrders.length} orders for location ${locationId}`);
    return allOrders;
}
// ─── Payments ─────────────────────────────────────────────────
async function listPayments(locationId, startDate, endDate, accessToken) {
    const client = createSquareClient(accessToken);
    const allPayments = [];
    const page = await client.payments.list({
        locationId,
        ...(startDate && { beginTime: startDate.toISOString() }),
        ...(endDate && { endTime: endDate.toISOString() }),
    });
    for await (const payment of page) {
        allPayments.push({
            id: payment.id ?? '',
            orderId: payment.orderId ?? '',
            amountMoney: {
                amount: Number(payment.amountMoney?.amount ?? 0n),
                currency: payment.amountMoney?.currency ?? 'USD',
            },
            status: payment.status ?? 'UNKNOWN',
            createdAt: payment.createdAt ?? new Date().toISOString(),
        });
    }
    logger_1.logger.info('SquareClient', `Fetched ${allPayments.length} payments for location ${locationId}`);
    return allPayments;
}
// ─── Legacy interface (kept for compatibility) ────────────────
exports.squareIntegration = {
    name: 'square',
    async connect(authCode, _locationId) {
        const redirectUri = `${process.env.APP_URL || 'http://localhost:3001'}/api/auth/square/callback`;
        await exchangeOAuthCode(authCode, redirectUri);
        logger_1.logger.info('SquareIntegration', 'Connected Square merchant');
    },
    async syncCatalog(_locationId) {
        const items = await listCatalog();
        return items.length;
    },
    async syncOrders(locationId, since) {
        const orders = await listOrders(locationId, since);
        return orders.length;
    },
    async disconnect(_locationId) {
        logger_1.logger.info('SquareIntegration', `Disconnecting location ${_locationId}`);
    },
};
//# sourceMappingURL=client.js.map