import { SquareClient } from 'square';
import type { Location as SquareLocation } from 'square';
import type { SquareOAuthTokens, SquareCatalogItem, SquareOrder, SquarePayment } from './types';
/** Create a SquareClient for a given access token (or use env default). */
export declare function createSquareClient(accessToken?: string): SquareClient;
export declare function getOAuthUrl(redirectUri: string): string;
export declare function exchangeOAuthCode(code: string, redirectUri: string): Promise<SquareOAuthTokens>;
export declare function getMerchantInfo(merchantId: string, accessToken: string): Promise<{
    businessName?: string;
    email?: string;
}>;
export declare function listLocations(accessToken?: string): Promise<SquareLocation[]>;
export declare function listCatalog(accessToken?: string): Promise<SquareCatalogItem[]>;
export declare function listOrders(locationId: string, startDate?: Date, endDate?: Date, accessToken?: string): Promise<SquareOrder[]>;
export declare function listPayments(locationId: string, startDate?: Date, endDate?: Date, accessToken?: string): Promise<SquarePayment[]>;
export declare const squareIntegration: {
    name: "square";
    connect(authCode: string, _locationId: string): Promise<void>;
    syncCatalog(_locationId: string): Promise<number>;
    syncOrders(locationId: string, since?: Date): Promise<number>;
    disconnect(_locationId: string): Promise<void>;
};
//# sourceMappingURL=client.d.ts.map