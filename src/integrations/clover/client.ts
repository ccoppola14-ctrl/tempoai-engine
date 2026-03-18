import { logger } from '../../utils/logger';
import type {
  CloverMerchant,
  CloverInventoryItem,
  CloverOrder,
  CloverLineItem,
  CloverPayment,
  CloverPaginatedResponse,
} from './types';

const PAGE_LIMIT = 100;

function getBaseUrl(): string {
  const env = process.env.CLOVER_ENVIRONMENT || 'sandbox';
  return env === 'production'
    ? 'https://api.clover.com'
    : 'https://apisandbox.dev.clover.com';
}

function merchantUrl(merchantId: string): string {
  return `${getBaseUrl()}/v3/merchants/${merchantId}`;
}

async function cloverFetch<T>(url: string, apiToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Clover API error ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Paginate through a Clover list endpoint that returns { elements: T[] }.
 */
async function paginateAll<T>(
  baseUrl: string,
  apiToken: string,
  extraParams?: string
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;

  do {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}limit=${PAGE_LIMIT}&offset=${offset}${extraParams ? `&${extraParams}` : ''}`;
    const page = await cloverFetch<CloverPaginatedResponse<T>>(url, apiToken);
    const elements = page.elements ?? [];
    all.push(...elements);

    if (elements.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  } while (true);

  return all;
}

// ─── Merchant ────────────────────────────────────────────

export async function getMerchant(
  merchantId: string,
  apiToken: string
): Promise<CloverMerchant> {
  const merchant = await cloverFetch<CloverMerchant>(
    merchantUrl(merchantId),
    apiToken
  );
  logger.info('CloverClient', `Fetched merchant: ${merchant.name}`);
  return merchant;
}

// ─── Inventory ───────────────────────────────────────────

export async function listInventory(
  merchantId: string,
  apiToken: string
): Promise<CloverInventoryItem[]> {
  const items = await paginateAll<CloverInventoryItem>(
    `${merchantUrl(merchantId)}/items`,
    apiToken,
    'expand=categories'
  );
  logger.info('CloverClient', `Fetched ${items.length} inventory items`);
  return items;
}

// ─── Orders ──────────────────────────────────────────────

export async function listOrders(
  merchantId: string,
  apiToken: string,
  startDate?: Date,
  endDate?: Date
): Promise<CloverOrder[]> {
  let filterParam = '';
  if (startDate) {
    filterParam += `filter=createdTime>=${startDate.getTime()}`;
    if (endDate) {
      filterParam += `&filter=createdTime<=${endDate.getTime()}`;
    }
  }

  const orders = await paginateAll<CloverOrder>(
    `${merchantUrl(merchantId)}/orders`,
    apiToken,
    filterParam
  );

  logger.info('CloverClient', `Fetched ${orders.length} orders`);
  return orders;
}

/**
 * Fetch line items for a specific order.
 */
export async function listOrderLineItems(
  merchantId: string,
  orderId: string,
  apiToken: string
): Promise<CloverLineItem[]> {
  const items = await paginateAll<CloverLineItem>(
    `${merchantUrl(merchantId)}/orders/${orderId}/line_items`,
    apiToken
  );
  return items;
}

// ─── Payments ────────────────────────────────────────────

export async function listPayments(
  merchantId: string,
  apiToken: string,
  startDate?: Date,
  endDate?: Date
): Promise<CloverPayment[]> {
  let filterParam = '';
  if (startDate) {
    filterParam += `filter=createdTime>=${startDate.getTime()}`;
    if (endDate) {
      filterParam += `&filter=createdTime<=${endDate.getTime()}`;
    }
  }

  const payments = await paginateAll<CloverPayment>(
    `${merchantUrl(merchantId)}/payments`,
    apiToken,
    filterParam
  );

  logger.info('CloverClient', `Fetched ${payments.length} payments`);
  return payments;
}

// ─── Legacy interface (kept for compatibility) ───────────

export const cloverIntegration = {
  name: 'clover' as const,

  async connect(_authCode: string, _locationId: string): Promise<void> {
    logger.info('CloverIntegration', 'Connected Clover merchant');
  },

  async syncCatalog(locationId: string): Promise<number> {
    // Placeholder — actual sync done in sync.ts
    logger.info('CloverIntegration', `Catalog sync requested for ${locationId}`);
    return 0;
  },

  async syncOrders(locationId: string, _since?: Date): Promise<number> {
    logger.info('CloverIntegration', `Orders sync requested for ${locationId}`);
    return 0;
  },

  async disconnect(_locationId: string): Promise<void> {
    logger.info('CloverIntegration', `Disconnecting location ${_locationId}`);
  },
};
