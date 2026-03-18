import cron from 'node-cron';
import prisma from '../../db/client';
import { logger } from '../../utils/logger';
import { listCatalog, listOrders, listPayments } from './client';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Determine the "since" date for syncing orders.
 * - First sync (no prior sync log): 90 days back.
 * - Subsequent syncs: last successful sync timestamp.
 */
async function getSyncSince(locationId: string): Promise<Date> {
  const lastSync = await prisma.syncLog.findFirst({
    where: { locationId, source: 'square_orders', status: 'success' },
    orderBy: { timestamp: 'desc' },
  });

  if (lastSync) {
    return lastSync.timestamp;
  }

  // First sync — pull 90 days of history
  return new Date(Date.now() - NINETY_DAYS_MS);
}

export async function syncLocationCatalog(locationId: string): Promise<number> {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location?.squareAccessToken) {
    logger.warn('SquareSync', `No access token for location ${locationId}`);
    return 0;
  }

  try {
    const catalogItems = await listCatalog(location.squareAccessToken);
    let count = 0;

    for (const item of catalogItems) {
      await prisma.menuItem.upsert({
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

    await prisma.syncLog.create({
      data: {
        locationId,
        source: 'square_catalog',
        status: 'success',
        recordsProcessed: count,
      },
    });

    logger.info('SquareSync', `Synced ${count} catalog items for ${locationId}`);
    return count;
  } catch (err) {
    await prisma.syncLog.create({
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

export async function syncLocationOrders(locationId: string, since?: Date): Promise<number> {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location?.squareAccessToken || !location.squareMerchantId) {
    logger.warn('SquareSync', `No access token or merchant ID for location ${locationId}`);
    return 0;
  }

  try {
    const sinceDate = since ?? await getSyncSince(locationId);
    const orders = await listOrders(
      location.squareMerchantId,
      sinceDate,
      undefined,
      location.squareAccessToken
    );
    let count = 0;

    // Build a lookup of squareItemId -> menuItem.id for this location
    const menuItems = await prisma.menuItem.findMany({
      where: { locationId },
      select: { id: true, squareItemId: true },
    });
    const menuItemMap = new Map<string, string>();
    for (const mi of menuItems) {
      if (mi.squareItemId) menuItemMap.set(mi.squareItemId, mi.id);
    }

    for (const order of orders) {
      const existingOrder = await prisma.order.findFirst({
        where: { squareOrderId: order.id },
      });
      if (existingOrder) continue;

      // Filter line items to those with a matching menu item
      const validLineItems = order.lineItems.filter((li) =>
        menuItemMap.has(li.catalogObjectId)
      );

      await prisma.order.create({
        data: {
          locationId,
          squareOrderId: order.id,
          timestamp: new Date(order.createdAt),
          total: order.totalMoney.amount / 100,
          itemCount: order.lineItems.length,
          orderItems: {
            create: validLineItems.map((li) => ({
              menuItemId: menuItemMap.get(li.catalogObjectId)!,
              quantity: parseInt(li.quantity, 10) || 1,
              amount: li.totalMoney.amount / 100,
            })),
          },
        },
      });
      count++;
    }

    await prisma.syncLog.create({
      data: {
        locationId,
        source: 'square_orders',
        status: 'success',
        recordsProcessed: count,
      },
    });

    logger.info('SquareSync', `Synced ${count} orders for ${locationId}`);
    return count;
  } catch (err) {
    await prisma.syncLog.create({
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

export async function syncLocationPayments(locationId: string, since?: Date): Promise<number> {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location?.squareAccessToken || !location.squareMerchantId) {
    logger.warn('SquareSync', `No access token for location ${locationId}`);
    return 0;
  }

  const sinceDate = since ?? await getSyncSince(locationId);
  const payments = await listPayments(
    location.squareMerchantId,
    sinceDate,
    undefined,
    location.squareAccessToken
  );

  logger.info('SquareSync', `Fetched ${payments.length} payments for ${locationId}`);
  return payments.length;
}

export async function syncAllLocations(): Promise<void> {
  const locations = await prisma.location.findMany({
    where: { squareAccessToken: { not: null } },
  });

  for (const location of locations) {
    try {
      await syncLocationCatalog(location.id);
      await syncLocationOrders(location.id);
    } catch (err) {
      logger.error('SquareSync', `Failed to sync location ${location.id}`, err);
    }
  }
}

/**
 * Full initial sync — pulls 90 days of data.
 */
export async function initialSync(locationId: string): Promise<{ catalog: number; orders: number }> {
  const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS);
  const catalog = await syncLocationCatalog(locationId);
  const orders = await syncLocationOrders(locationId, ninetyDaysAgo);
  return { catalog, orders };
}

export function startSyncSchedule(): void {
  if (process.env.DEMO_MODE === 'true') {
    logger.info('SquareSync', 'Demo mode — skipping sync schedule');
    return;
  }

  // Every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('SquareSync', 'Running scheduled sync...');
    await syncAllLocations();
  });

  logger.info('SquareSync', 'Sync scheduled every 15 minutes');
}
