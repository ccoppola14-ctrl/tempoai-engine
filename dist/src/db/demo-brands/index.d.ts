export interface DemoBrandConfig {
    brandName: string;
    locations: Array<{
        name: string;
        address: string;
        lat: number;
        lng: number;
        timezone: string;
    }>;
    menuItems: Array<{
        name: string;
        category: string;
        price: number;
    }>;
    weatherProfile: 'coastal-mild' | 'hot-humid' | 'cold-northern' | 'temperate';
    avgDailyRevenue: number;
    avgOrderValue: number;
}
export declare function getBrandConfig(brandSlug: string): DemoBrandConfig | null;
export declare function listBrands(): string[];
//# sourceMappingURL=index.d.ts.map