"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloverIntegration = void 0;
exports.getMerchant = getMerchant;
exports.listInventory = listInventory;
exports.listOrders = listOrders;
exports.listOrderLineItems = listOrderLineItems;
exports.listPayments = listPayments;
const logger_1 = require("../../utils/logger");
const PAGE_LIMIT = 100;
function getBaseUrl() {
    const env = process.env.CLOVER_ENVIRONMENT || 'sandbox';
    return env === 'production'
        ? 'https://api.clover.com'
        : 'https://apisandbox.dev.clover.com';
}
function merchantUrl(merchantId) {
    return `${getBaseUrl()}/v3/merchants/${merchantId}`;
}
async function cloverFetch(url, apiToken) {
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
    return response.json();
}
/**
 * Paginate through a Clover list endpoint that returns { elements: T[] }.
 */
async function paginateAll(baseUrl, apiToken, extraParams) {
    const all = [];
    let offset = 0;
    do {
        const sep = baseUrl.includes('?') ? '&' : '?';
        const url = `${baseUrl}${sep}limit=${PAGE_LIMIT}&offset=${offset}${extraParams ? `&${extraParams}` : ''}`;
        const page = await cloverFetch(url, apiToken);
        const elements = page.elements ?? [];
        all.push(...elements);
        if (elements.length < PAGE_LIMIT)
            break;
        offset += PAGE_LIMIT;
    } while (true);
    return all;
}
// ─── Merchant ────────────────────────────────────────────
async function getMerchant(merchantId, apiToken) {
    const merchant = await cloverFetch(merchantUrl(merchantId), apiToken);
    logger_1.logger.info('CloverClient', `Fetched merchant: ${merchant.name}`);
    return merchant;
}
// ─── Inventory ───────────────────────────────────────────
async function listInventory(merchantId, apiToken) {
    const items = await paginateAll(`${merchantUrl(merchantId)}/items`, apiToken, 'expand=categories');
    logger_1.logger.info('CloverClient', `Fetched ${items.length} inventory items`);
    return items;
}
// ─── Orders ──────────────────────────────────────────────
async function listOrders(merchantId, apiToken, startDate, endDate) {
    let filterParam = '';
    if (startDate) {
        filterParam += `filter=createdTime>=${startDate.getTime()}`;
        if (endDate) {
            filterParam += `&filter=createdTime<=${endDate.getTime()}`;
        }
    }
    const orders = await paginateAll(`${merchantUrl(merchantId)}/orders`, apiToken, filterParam);
    logger_1.logger.info('CloverClient', `Fetched ${orders.length} orders`);
    return orders;
}
/**
 * Fetch line items for a specific order.
 */
async function listOrderLineItems(merchantId, orderId, apiToken) {
    const items = await paginateAll(`${merchantUrl(merchantId)}/orders/${orderId}/line_items`, apiToken);
    return items;
}
// ─── Payments ────────────────────────────────────────────
async function listPayments(merchantId, apiToken, startDate, endDate) {
    let filterParam = '';
    if (startDate) {
        filterParam += `filter=createdTime>=${startDate.getTime()}`;
        if (endDate) {
            filterParam += `&filter=createdTime<=${endDate.getTime()}`;
        }
    }
    const payments = await paginateAll(`${merchantUrl(merchantId)}/payments`, apiToken, filterParam);
    logger_1.logger.info('CloverClient', `Fetched ${payments.length} payments`);
    return payments;
}
// ─── Legacy interface (kept for compatibility) ───────────
exports.cloverIntegration = {
    name: 'clover',
    async connect(_authCode, _locationId) {
        logger_1.logger.info('CloverIntegration', 'Connected Clover merchant');
    },
    async syncCatalog(locationId) {
        // Placeholder — actual sync done in sync.ts
        logger_1.logger.info('CloverIntegration', `Catalog sync requested for ${locationId}`);
        return 0;
    },
    async syncOrders(locationId, _since) {
        logger_1.logger.info('CloverIntegration', `Orders sync requested for ${locationId}`);
        return 0;
    },
    async disconnect(_locationId) {
        logger_1.logger.info('CloverIntegration', `Disconnecting location ${_locationId}`);
    },
};
//# sourceMappingURL=client.js.map