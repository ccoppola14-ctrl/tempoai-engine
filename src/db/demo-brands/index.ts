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

import leesDonutsConfig from './lees-donuts';

const brandRegistry: Record<string, DemoBrandConfig> = {
  'lees-donuts': leesDonutsConfig,
};

export function getBrandConfig(brandSlug: string): DemoBrandConfig | null {
  return brandRegistry[brandSlug] ?? null;
}

export function listBrands(): string[] {
  return Object.keys(brandRegistry);
}
