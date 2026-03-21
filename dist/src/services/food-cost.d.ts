interface IngredientInput {
    name: string;
    cost: number;
    unit: string;
    quantity: number;
}
interface MenuItemCostAnalysis {
    menuItemId: string;
    menuItemName: string;
    menuPrice: number;
    ingredientCost: number;
    foodCostPercent: number;
    margin: number;
    category: 'star' | 'puzzle' | 'plow_horse' | 'dog';
    ingredients: Array<{
        name: string;
        cost: number;
        unit: string;
        quantity: number;
    }>;
}
interface FoodCostSummary {
    locationId: string;
    totalMenuItems: number;
    itemsWithCostData: number;
    averageFoodCostPercent: number;
    totalRevenuePotential: number;
    totalIngredientCost: number;
    overallFoodCostPercent: number;
    categoryBreakdown: Record<string, number>;
    highCostItems: Array<{
        name: string;
        foodCostPercent: number;
    }>;
    recommendations: string[];
}
/**
 * Add or update ingredient costs for a menu item.
 */
export declare function upsertIngredientCosts(locationId: string, menuItemId: string, ingredients: IngredientInput[]): Promise<void>;
/**
 * Get food cost analysis for all menu items at a location.
 */
export declare function getFoodCostAnalysis(locationId: string): Promise<MenuItemCostAnalysis[]>;
/**
 * Get food cost summary for a location.
 */
export declare function getFoodCostSummary(locationId: string): Promise<FoodCostSummary>;
export {};
//# sourceMappingURL=food-cost.d.ts.map