"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncLocationCatalog = syncLocationCatalog;
exports.syncLocationOrders = syncLocationOrders;
exports.syncLocationPayments = syncLocationPayments;
exports.syncAllLocations = syncAllLocations;
exports.initialSync = initialSync;
exports.startSyncSchedule = startSyncSchedule;
const node_cron_1 = __importDefault(require("node-cron"));
const client_1 = __importDefault(require("../../db/client"));
const logger_1 = require("../../utils/logger");
const client_2 = require("./client");
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * Determine the "since" date for syncing orders.
 * - First sync (no prior sync log): 90 days back.
 * - Subsequent syncs: last successful sync timestamp.
 */
async function getSyncSince(locationId) {
    const lastSync = await client_1.default.syncLog.findFirst({
        where: { locationId, source: 'square_orders', status: 'success' },
        orderBy: { timestamp: 'desc' },
    });
    if (lastSync) {
        return lastSync.timestamp;
    }
    // First sync — pull 90 days of history
    return new Date(Date.now() - NINETY_DAYS_MS);
}
async function syncLocationCatalog(locationId) {
    const location = await client_1.default.location.findUnique({ where: { id: locationId } });
    if (!location?.squareAccessToken) {
        logger_1.logger.warn('SquareSync', `No access token for location ${locationId}`);
        return 0;
    }
    try {
        const catalogItems = await (0, client_2.listCatalog)(location.squareAccessToken);
        let count = 0;
        for (const item of catalogItems) {
            await client_1.default.menuItem.upsert({
                where: {
                    locationId_squareItemId: { locationId, squareItemId: item.id },
                },
                create: {
                    locationId,
                    squareItemId: item.id,
                    name: item.name,
                    category: item.category,
                    price: item.price / 100,
                    active: true,
                },
                update: {
                    name: item.name,
                    category: item.category,
                    price: item.price / 100,
                    active: true,
                },
            });
            count++;
        }
        await client_1.default.syncLog.create({
            data: {
                locationId,
                source: 'square_catalog',
                status: 'success',
                recordsProcessed: count,
            },
        });
        logger_1.logger.info('SquareSync', `Synced ${count} catalog items for ${locationId}`);
        return count;
    }
    catch (err) {
        await client_1.default.syncLog.create({
            data: {
                locationId,
                source: 'square_catalog',
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
            },
        });
        throw err;
    }
}
async function syncLocationOrders(locationId, since) {
    const location = await client_1.default.location.findUnique({ where: { id: locationId } });
    if (!location?.squareAccessToken || !location.squareMerchantId) {
        logger_1.logger.warn('SquareSync', `No access token or merchant ID for location ${locationId}`);
        return 0;
    }
    try {
        const sinceDate = since ?? await getSyncSince(locationId);
        const orders = await (0, client_2.listOrders)(location.squareMerchantId, sinceDate, undefined, location.squareAccessToken);
        let count = 0;
        // Build a lookup of squareItemId -> menuItem.id for this location
        const menuItems = await client_1.default.menuItem.findMany({
            where: { locationId },
            select: { id: true, squareItemId: true },
        });
        const menuItemMap = new Map();
        for (const mi of menuItems) {
            if (mi.squareItemId)
                menuItemMap.set(mi.squareItemId, mi.id);
        }
        for (const order of orders) {
            const existingOrder = await client_1.default.order.findFirst({
                where: { squareOrderId: order.id },
            });
            if (existingOrder)
                continue;
            // Filter line items to those with a matching menu item
            const validLineItems = order.lineItems.filter((li) => menuItemMap.has(li.catalogObjectId));
            await client_1.default.order.create({
                data: {
                    locationId,
                    squareOrderId: order.id,
                    timestamp: new Date(order.createdAt),
                    total: order.totalMoney.amount / 100,
                    itemCount: order.lineItems.length,
                    orderItems: {
                        create: validLineItems.map((li) => ({
                            menuItemId: menuItemMap.get(li.catalogObjectId),
                            quantity: parseInt(li.quantity, 10) || 1,
                            amount: li.totalMoney.amount / 100,
                        })),
                    },
                },
            });
            count++;
        }
        await client_1.default.syncLog.create({
            data: {
                locationId,
                source: 'square_orders',
                status: 'success',
                recordsProcessed: count,
            },
        });
        logger_1.logger.info('SquareSync', `Synced ${count} orders for ${locationId}`);
        return count;
    }
    catch (err) {
        await client_1.default.syncLog.create({
            data: {
                locationId,
                source: 'square_orders',
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
            },
        });
        throw err;
    }
}
async function syncLocationPayments(locationId, since) {
    const location = await client_1.default.location.findUnique({ where: { id: locationId } });
    if (!location?.squareAccessToken || !location.squareMerchantId) {
        logger_1.logger.warn('SquareSync', `No access token for location ${locationId}`);
        return 0;
    }
    const sinceDate = since ?? await getSyncSince(locationId);
    const payments = await (0, client_2.listPayments)(location.squareMerchantId, sinceDate, undefined, location.squareAccessToken);
    logger_1.logger.info('SquareSync', `Fetched ${payments.length} payments for ${locationId}`);
    return payments.length;
}
async function syncAllLocations() {
    const locations = await client_1.default.location.findMany({
        where: { squareAccessToken: { not: null } },
    });
    for (const location of locations) {
        try {
            await syncLocationCatalog(location.id);
            await syncLocationOrders(location.id);
        }
        catch (err) {
            logger_1.logger.error('SquareSync', `Failed to sync location ${location.id}`, err);
        }
    }
}
/**
 * Full initial sync — pulls 90 days of data.
 */
async function initialSync(locationId) {
    const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS);
    const catalog = await syncLocationCatalog(locationId);
    const orders = await syncLocationOrders(locationId, ninetyDaysAgo);
    return { catalog, orders };
}
function startSyncSchedule() {
    if (process.env.DEMO_MODE === 'true') {
        logger_1.logger.info('SquareSync', 'Demo mode — skipping sync schedule');
        return;
    }
    // Every 15 minutes
    node_cron_1.default.schedule('*/15 * * * *', async () => {
        logger_1.logger.info('SquareSync', 'Running scheduled sync...');
        await syncAllLocations();
    });
    logger_1.logger.info('SquareSync', 'Sync scheduled every 15 minutes');
}
//# sourceMappingURL=sync.js.map