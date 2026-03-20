export interface CloverMerchant {
    id: string;
    name: string;
    address?: {
        address1?: string;
        city?: string;
        state?: string;
        zip?: string;
        country?: string;
    };
    phoneNumber?: string;
    website?: string;
    tpiId?: string;
}
export interface CloverInventoryItem {
    id: string;
    name: string;
    price: number;
    priceType?: string;
    code?: string;
    sku?: string;
    hidden?: boolean;
    categories?: {
        elements?: Array<{
            id: string;
            name: string;
        }>;
    };
}
export interface CloverOrder {
    id: string;
    currency: string;
    total: number;
    state?: string;
    createdTime?: number;
    modifiedTime?: number;
    lineItems?: CloverLineItem[];
}
export interface CloverLineItem {
    id: string;
    name: string;
    price: number;
    unitQty?: number;
    item?: {
        id: string;
    };
    createdTime?: number;
}
export interface CloverPayment {
    id: string;
    order?: {
        id: string;
    };
    amount: number;
    result: string;
    createdTime?: number;
}
export interface CloverPaginatedResponse<T> {
    elements: T[];
    href?: string;
}
/** Generic POS integration interface — implement for Square, Clover, etc. */
export interface POSIntegration {
    name: string;
    connect(authCode: string, locationId: string): Promise<void>;
    syncCatalog(locationId: string): Promise<number>;
    syncOrders(locationId: string, since?: Date): Promise<number>;
    disconnect(locationId: string): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map