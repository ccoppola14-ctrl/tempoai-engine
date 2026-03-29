import type { DemoBrandConfig } from './demo-brands';
export declare function seedDemoOrganization(brandConfig: DemoBrandConfig): Promise<{
    organizationId: string;
    locationCount: number;
    menuItemCount: number;
    orderCount: number;
    demoUserEmail: string;
    demoUserPassword: string;
    ownerEmail: string;
    ownerPassword: string;
    managerEmail: string;
    managerPassword: string;
}>;
export declare function clearDemoData(): Promise<{
    deleted: boolean;
}>;
export declare function swapDemoBrand(brandSlug: string): Promise<any>;
export declare function getDemoStatus(): Promise<any>;
//# sourceMappingURL=demo-seed.d.ts.map