export declare function syncCloverCatalog(locationId: string): Promise<number>;
export declare function syncCloverOrders(locationId: string, since?: Date): Promise<number>;
export declare function syncCloverPayments(locationId: string, since?: Date): Promise<number>;
export declare function syncAllCloverLocations(): Promise<void>;
/**
 * Full initial sync — pulls 90 days of data.
 */
export declare function initialCloverSync(locationId: string): Promise<{
    catalog: number;
    orders: number;
}>;
/**
 * Sync labor/shift data from Clover Employees & Shifts APIs.
 */
export declare function syncCloverLabor(locationId: string): Promise<number>;
export declare function startCloverSyncSchedule(): void;
//# sourceMappingURL=sync.d.ts.map