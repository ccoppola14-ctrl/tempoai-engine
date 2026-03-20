export declare function syncLocationCatalog(locationId: string): Promise<number>;
export declare function syncLocationOrders(locationId: string, since?: Date): Promise<number>;
export declare function syncLocationPayments(locationId: string, since?: Date): Promise<number>;
export declare function syncAllLocations(): Promise<void>;
/**
 * Full initial sync — pulls 90 days of data.
 */
export declare function initialSync(locationId: string): Promise<{
    catalog: number;
    orders: number;
}>;
export declare function startSyncSchedule(): void;
//# sourceMappingURL=sync.d.ts.map