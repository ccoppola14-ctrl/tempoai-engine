export interface SquareOAuthTokens {
    accessToken: string;
    refreshToken: string;
    merchantId: string;
    expiresAt: Date;
}
export interface SquareCatalogItem {
    id: string;
    name: string;
    category: string;
    price: number;
    variations: SquareItemVariation[];
}
export interface SquareItemVariation {
    id: string;
    name: string;
    price: number;
}
export interface SquareOrder {
    id: string;
    locationId: string;
    createdAt: string;
    totalMoney: {
        amount: number;
        currency: string;
    };
    lineItems: SquareLineItem[];
    state: string;
}
export interface SquareLineItem {
    catalogObjectId: string;
    name: string;
    quantity: string;
    totalMoney: {
        amount: number;
        currency: string;
    };
}
export interface SquarePayment {
    id: string;
    orderId: string;
    amountMoney: {
        amount: number;
        currency: string;
    };
    status: string;
    createdAt: string;
}
/** Generic POS integration interface — implement for Square, Toast, etc. */
export interface POSIntegration {
    name: string;
    connect(authCode: string, locationId: string): Promise<void>;
    syncCatalog(locationId: string): Promise<number>;
    syncOrders(locationId: string, since?: Date): Promise<number>;
    disconnect(locationId: string): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map