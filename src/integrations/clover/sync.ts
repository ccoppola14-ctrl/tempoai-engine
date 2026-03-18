import cron from 'node-cron';
import prisma from '../../db/client';
import { logger } from '../../utils/logger';
import { listInventory, listOrders, listOrderLineItems, listPayments } from './client';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Determine the "since" date for syncing orders.
 * - First sync (no prior sync log): 90 days back.
 * - Subsequent syncs: last successful sync timestamp.
 */
async function getSyncSince(locationId: string): Promise<Date> {
  const lastSync = await prisma.syncLog.findFirst({
    where: { locationId, source: 'clover_orders', status: 'success' },
    orderBy: { timestamp: 'desc' },
  });

  if (lastSync) {
    return lastSync.timestamp;
  }

  // First sync — pull 90 days of history
  return new Date(Date.now() - NINETY_DAYS_MS);
}

export async function syncCloverCatalog(locationId: string): Promise<number> {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location?.cloverApiToken || !location.cloverMerchantId) {
    logger.warn('CloverSync', `No Clover credentials for location ${locationId}`);
    return 0;
  }

  try {
    const items = await listInventory(location.cloverMerchantId, location.cloverApiToken);
    let count = 0;

    for (const item of items) {
      if (item.hidden) continue;

      const category =
        item.categories?.elements?.[0]?.name ?? 'Uncategorized';

      await prisma.menuItem.upsert({
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

    await prisma.syncLog.create({
      data: {
        locationId,
        source: 'clover_catalog',
        status: 'success',
        recordsProcessed: count,
      },
    });

    logger.info('CloverSync', `Synced ${count} catalog items for ${locationId}`);
    return count;
  } catch (err) {
    await prisma.syncLog.create({
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

export async function syncCloverOrders(locationId: string, since?: Date): Promise<number> {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location?.cloverApiToken || !location.cloverMerchantId) {
    logger.warn('CloverSync', `No Clover credentials for location ${locationId}`);
    return 0;
  }

  try {
    const sinceDate = since ?? await getSyncSince(locationId);
    const orders = await listOrders(
      location.cloverMerchantId,
      location.cloverApiToken,
      sinceDate
    );
    let count = 0;

    // Build a lookup of cloverItemId -> menuItem.id for this location
    const menuItems = await prisma.menuItem.findMany({
      where: { locationId },
      select: { id: true, cloverItemId: true },
    });
    const menuItemMap = new Map<string, string>();
    for (const mi of menuItems) {
      if (mi.cloverItemId) menuItemMap.set(mi.cloverItemId, mi.id);
    }

    for (const order of orders) {
      const existingOrder = await prisma.order.findFirst({
        where: { cloverOrderId: order.id },
      });
      if (existingOrder) continue;

      // Fetch line items for this order
      const lineItems = await listOrderLineItems(
        location.cloverMerchantId,
        order.id,
        location.cloverApiToken
      );

      // Filter line items to those with a matching menu item
      const validLineItems = lineItems.filter(
        (li) => li.item?.id && menuItemMap.has(li.item.id)
      );

      await prisma.order.create({
        data: {
          locationId,
          cloverOrderId: order.id,
          timestamp: new Date(order.createdTime ?? Date.now()),
          total: (order.total ?? 0) / 100,
          itemCount: lineItems.length,
          orderItems: {
            create: validLineItems.map((li) => ({
              menuItemId: menuItemMap.get(li.item!.id)!,
              quantity: li.unitQty ?? 1,
              amount: li.price / 100,
            })),
          },
        },
      });
      count++;
    }

    await prisma.syncLog.create({
      data: {
        locationId,
        source: 'clover_orders',
        status: 'success',
        recordsProcessed: count,
      },
    });

    logger.info('CloverSync', `Synced ${count} orders for ${locationId}`);
    return count;
  } catch (err) {
    await prisma.syncLog.create({
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

export async function syncCloverPayments(locationId: string, since?: Date): Promise<number> {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location?.cloverApiToken || !location.cloverMerchantId) {
    logger.warn('CloverSync', `No Clover credentials for location ${locationId}`);
    return 0;
  }

  const sinceDate = since ?? await getSyncSince(locationId);
  const payments = await listPayments(
    location.cloverMerchantId,
    location.cloverApiToken,
    sinceDate
  );

  logger.info('CloverSync', `Fetched ${payments.length} payments for ${locationId}`);
  return payments.length;
}

export async function syncAllCloverLocations(): Promise<void> {
  const locations = await prisma.location.findMany({
    where: { cloverApiToken: { not: null } },
  });

  for (const location of locations) {
    try {
      await syncCloverCatalog(location.id);
      await syncCloverOrders(location.id);
    } catch (err) {
      logger.error('CloverSync', `Failed to sync location ${location.id}`, err);
    }
  }
}

/**
 * Full initial sync — pulls 90 days of data.
 */
export async function initialCloverSync(locationId: string): Promise<{ catalog: number; orders: number }> {
  const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS);
  const catalog = await syncCloverCatalog(locationId);
  const orders = await syncCloverOrders(locationId, ninetyDaysAgo);
  return { catalog, orders };
}

export function startCloverSyncSchedule(): void {
  if (process.env.DEMO_MODE === 'true') {
    logger.info('CloverSync', 'Demo mode — skipping sync schedule');
    return;
  }

  // Every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('CloverSync', 'Running scheduled sync...');
    await syncAllCloverLocations();
  });

  logger.info('CloverSync', 'Sync scheduled every 15 minutes');
}
