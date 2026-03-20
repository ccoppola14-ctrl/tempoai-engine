import type { CloverMerchant, CloverInventoryItem, CloverOrder, CloverLineItem, CloverPayment } from './types';
export declare function getMerchant(merchantId: string, apiToken: string): Promise<CloverMerchant>;
export declare function listInventory(merchantId: string, apiToken: string): Promise<CloverInventoryItem[]>;
export declare function listOrders(merchantId: string, apiToken: string, startDate?: Date, endDate?: Date): Promise<CloverOrder[]>;
/**
 * Fetch line items for a specific order.
 */
export declare function listOrderLineItems(merchantId: string, orderId: string, apiToken: string): Promise<CloverLineItem[]>;
export declare function listPayments(merchantId: string, apiToken: string, startDate?: Date, endDate?: Date): Promise<CloverPayment[]>;
export declare const cloverIntegration: {
    name: "clover";
    connect(_authCode: string, _locationId: string): Promise<void>;
    syncCatalog(locationId: string): Promise<number>;
    syncOrders(locationId: string, _since?: Date): Promise<number>;
    disconnect(_locationId: string): Promise<void>;
};
//# sourceMappingURL=client.d.ts.map