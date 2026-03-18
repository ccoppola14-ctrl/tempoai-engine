import { SquareClient, SquareEnvironment } from 'square';
import type { SquareEnvironment as SquareEnvType, Location as SquareLocation } from 'square';
import { logger } from '../../utils/logger';
import type {
  SquareOAuthTokens,
  SquareCatalogItem,
  SquareOrder,
  SquarePayment,
} from './types';

function getEnvironment(): SquareEnvType {
  const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  return env === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox;
}

/** Create a SquareClient for a given access token (or use env default). */
export function createSquareClient(accessToken?: string): SquareClient {
  const token = accessToken || process.env.SQUARE_ACCESS_TOKEN || '';
  return new SquareClient({
    token,
    environment: getEnvironment(),
  });
}

// ─── OAuth (kept for future production use) ───────────────────

export function getOAuthUrl(redirectUri: string): string {
  const appId = process.env.SQUARE_APP_ID;
  const baseUrl =
    process.env.SQUARE_ENVIRONMENT === 'production'
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

export async function exchangeOAuthCode(
  code: string,
  redirectUri: string
): Promise<SquareOAuthTokens> {
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

// ─── Locations ────────────────────────────────────────────────

export async function listLocations(accessToken?: string): Promise<SquareLocation[]> {
  const client = createSquareClient(accessToken);
  const response = await client.locations.list();
  const locations = response.locations ?? [];

  logger.info('SquareClient', `Found ${locations.length} locations`);
  return locations;
}

// ─── Catalog ──────────────────────────────────────────────────

export async function listCatalog(
  accessToken?: string
): Promise<SquareCatalogItem[]> {
  const client = createSquareClient(accessToken);
  const items: SquareCatalogItem[] = [];

  // catalog.list returns an auto-paginated async iterable Page
  const page = await client.catalog.list({ types: 'ITEM' });

  for await (const obj of page) {
    if (obj.type !== 'ITEM') continue;
    const itemData = (obj as { itemData?: Record<string, unknown> }).itemData as
      | {
          name?: string;
          categoryId?: string;
          categories?: Array<{ name?: string }>;
          variations?: Array<{
            id: string;
            type: string;
            itemVariationData?: {
              name?: string;
              priceMoney?: { amount?: bigint };
            };
          }>;
        }
      | undefined;
    if (!itemData) continue;

    const variations = (itemData.variations ?? []).map((v) => ({
      id: v.id,
      name: v.itemVariationData?.name ?? v.id,
      price: Number(v.itemVariationData?.priceMoney?.amount ?? 0n),
    }));

    let category = 'Uncategorized';
    if (itemData.categories && itemData.categories.length > 0) {
      category = itemData.categories[0].name ?? 'Uncategorized';
    } else if (itemData.categoryId) {
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

  logger.info('SquareClient', `Fetched ${items.length} catalog items`);
  return items;
}

// ─── Orders ───────────────────────────────────────────────────

export async function listOrders(
  locationId: string,
  startDate?: Date,
  endDate?: Date,
  accessToken?: string
): Promise<SquareOrder[]> {
  const client = createSquareClient(accessToken);
  const allOrders: SquareOrder[] = [];
  let cursor: string | undefined;

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
          lineItems: (order.lineItems ?? []).map((li: any) => ({
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

  logger.info('SquareClient', `Fetched ${allOrders.length} orders for location ${locationId}`);
  return allOrders;
}

// ─── Payments ─────────────────────────────────────────────────

export async function listPayments(
  locationId: string,
  startDate?: Date,
  endDate?: Date,
  accessToken?: string
): Promise<SquarePayment[]> {
  const client = createSquareClient(accessToken);
  const allPayments: SquarePayment[] = [];

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

  logger.info('SquareClient', `Fetched ${allPayments.length} payments for location ${locationId}`);
  return allPayments;
}

// ─── Legacy interface (kept for compatibility) ────────────────

export const squareIntegration = {
  name: 'square' as const,

  async connect(authCode: string, _locationId: string): Promise<void> {
    const redirectUri = `${process.env.APP_URL || 'http://localhost:3001'}/api/auth/square/callback`;
    await exchangeOAuthCode(authCode, redirectUri);
    logger.info('SquareIntegration', 'Connected Square merchant');
  },

  async syncCatalog(_locationId: string): Promise<number> {
    const items = await listCatalog();
    return items.length;
  },

  async syncOrders(locationId: string, since?: Date): Promise<number> {
    const orders = await listOrders(locationId, since);
    return orders.length;
  },

  async disconnect(_locationId: string): Promise<void> {
    logger.info('SquareIntegration', `Disconnecting location ${_locationId}`);
  },
};
