"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCloverCatalog = syncCloverCatalog;
exports.syncCloverOrders = syncCloverOrders;
exports.syncCloverPayments = syncCloverPayments;
exports.syncAllCloverLocations = syncAllCloverLocations;
exports.initialCloverSync = initialCloverSync;
exports.startCloverSyncSchedule = startCloverSyncSchedule;
const node_cron_1 = __importDefault(require("node-cron"));
const client_1 = __importDefault(require("../../db/client"));
const encryption_1 = require("../../utils/encryption");
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
        where: { locationId, source: 'clover_orders', status: 'success' },
        orderBy: { timestamp: 'desc' },
    });
    if (lastSync) {
        return lastSync.timestamp;
    }
    // First sync — pull 90 days of history
    return new Date(Date.now() - NINETY_DAYS_MS);
}
async function syncCloverCatalog(locationId) {
    const location = await client_1.default.location.findUnique({ where: { id: locationId } });
    if (!location?.cloverApiToken || !location.cloverMerchantId) {
        logger_1.logger.warn('CloverSync', `No Clover credentials for location ${locationId}`);
        return 0;
    }
    try {
        const items = await (0, client_2.listInventory)(location.cloverMerchantId, (0, encryption_1.decrypt)(location.cloverApiToken));
        let count = 0;
        for (const item of items) {
            if (item.hidden)
                continue;
            const category = item.categories?.elements?.[0]?.name ?? 'Uncategorized';
            await client_1.default.menuItem.upsert({
                where: {
                    locationId_cloverItemId: { locationId, cloverItemId: item.id },
                },
                create: {
                    locationId,
                    cloverItemId: item.id,
                    name: item.name,
                    category,
                    price: item.price / 100,
                    active: true,
                },
                update: {
                    name: item.name,
                    category,
                    price: item.price / 100,
                    active: true,
                },
            });
            count++;
        }
        await client_1.default.syncLog.create({
            data: {
                locationId,
                source: 'clover_catalog',
                status: 'success',
                recordsProcessed: count,
            },
        });
        logger_1.logger.info('CloverSync', `Synced ${count} catalog items for ${locationId}`);
        return count;
    }
    catch (err) {
        await client_1.default.syncLog.create({
            data: {
                locationId,
                source: 'clover_catalog',
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
            },
        });
        throw err;
    }
}
async function syncCloverOrders(locationId, since) {
    const location = await client_1.default.location.findUnique({ where: { id: locationId } });
    if (!location?.cloverApiToken || !location.cloverMerchantId) {
        logger_1.logger.warn('CloverSync', `No Clover credentials for location ${locationId}`);
        return 0;
    }
    try {
        const sinceDate = since ?? await getSyncSince(locationId);
        const orders = await (0, client_2.listOrders)(location.cloverMerchantId, (0, encryption_1.decrypt)(location.cloverApiToken), sinceDate);
        let count = 0;
        // Build a lookup of cloverItemId -> menuItem.id for this location
        const menuItems = await client_1.default.menuItem.findMany({
            where: { locationId },
            select: { id: true, cloverItemId: true },
        });
        const menuItemMap = new Map();
        for (const mi of menuItems) {
            if (mi.cloverItemId)
                menuItemMap.set(mi.cloverItemId, mi.id);
        }
        for (const order of orders) {
            const existingOrder = await client_1.default.order.findFirst({
                where: { cloverOrderId: order.id },
            });
            if (existingOrder)
                continue;
            // Fetch line items for this order
            const lineItems = await (0, client_2.listOrderLineItems)(location.cloverMerchantId, order.id, (0, encryption_1.decrypt)(location.cloverApiToken));
            // Filter line items to those with a matching menu item
            const validLineItems = lineItems.filter((li) => li.item?.id && menuItemMap.has(li.item.id));
            await client_1.default.order.create({
                data: {
                    locationId,
                    cloverOrderId: order.id,
                    timestamp: new Date(order.createdTime ?? Date.now()),
                    total: (order.total ?? 0) / 100,
                    itemCount: lineItems.length,
                    orderItems: {
                        create: validLineItems.map((li) => ({
                            menuItemId: menuItemMap.get(li.item.id),
                            quantity: li.unitQty ?? 1,
                            amount: li.price / 100,
                        })),
                    },
                },
            });
            count++;
        }
        await client_1.default.syncLog.create({
            data: {
                locationId,
                source: 'clover_orders',
                status: 'success',
                recordsProcessed: count,
            },
        });
        logger_1.logger.info('CloverSync', `Synced ${count} orders for ${locationId}`);
        return count;
    }
    catch (err) {
        await client_1.default.syncLog.create({
            data: {
                locationId,
                source: 'clover_orders',
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
            },
        });
        throw err;
    }
}
async function syncCloverPayments(locationId, since) {
    const location = await client_1.default.location.findUnique({ where: { id: locationId } });
    if (!location?.cloverApiToken || !location.cloverMerchantId) {
        logger_1.logger.warn('CloverSync', `No Clover credentials for location ${locationId}`);
        return 0;
    }
    const sinceDate = since ?? await getSyncSince(locationId);
    const payments = await (0, client_2.listPayments)(location.cloverMerchantId, (0, encryption_1.decrypt)(location.cloverApiToken), sinceDate);
    logger_1.logger.info('CloverSync', `Fetched ${payments.length} payments for ${locationId}`);
    return payments.length;
}
async function syncAllCloverLocations() {
    const locations = await client_1.default.location.findMany({
        where: { cloverApiToken: { not: null } },
    });
    for (const location of locations) {
        try {
            await syncCloverCatalog(location.id);
            await syncCloverOrders(location.id);
        }
        catch (err) {
            logger_1.logger.error('CloverSync', `Failed to sync location ${location.id}`, err);
        }
    }
}
/**
 * Full initial sync — pulls 90 days of data.
 */
async function initialCloverSync(locationId) {
    const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS);
    const catalog = await syncCloverCatalog(locationId);
    const orders = await syncCloverOrders(locationId, ninetyDaysAgo);
    return { catalog, orders };
}
function startCloverSyncSchedule() {
    if (process.env.DEMO_MODE === 'true') {
        logger_1.logger.info('CloverSync', 'Demo mode — skipping sync schedule');
        return;
    }
    // Every 15 minutes
    node_cron_1.default.schedule('*/15 * * * *', async () => {
        logger_1.logger.info('CloverSync', 'Running scheduled sync...');
        await syncAllCloverLocations();
    });
    logger_1.logger.info('CloverSync', 'Sync scheduled every 15 minutes');
}
//# sourceMappingURL=sync.js.map