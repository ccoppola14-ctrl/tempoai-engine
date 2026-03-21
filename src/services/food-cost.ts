import prisma from '../db/client';
import { logger } from '../utils/logger';

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
  ingredients: Array<{ name: string; cost: number; unit: string; quantity: number }>;
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
  highCostItems: Array<{ name: string; foodCostPercent: number }>;
  recommendations: string[];
}

/**
 * Add or update ingredient costs for a menu item.
 */
export async function upsertIngredientCosts(
  locationId: string,
  menuItemId: string,
  ingredients: IngredientInput[]
): Promise<void> {
  logger.info('FoodCost', `Updating ingredient costs for menu item ${menuItemId}`);

  // Delete existing ingredients for this menu item at this location
  await prisma.ingredientCost.deleteMany({
    where: { locationId, menuItemId },
  });

  // Insert new ingredients
  for (const ing of ingredients) {
    await prisma.ingredientCost.create({
      data: {
        locationId,
        menuItemId,
        ingredientName: ing.name,
        cost: ing.cost,
        unit: ing.unit,
        quantity: ing.quantity,
      },
    });
  }

  logger.info('FoodCost', `Saved ${ingredients.length} ingredients for item ${menuItemId}`);
}

/**
 * Classify a menu item using the BCG matrix approach:
 * Star = high profit + high popularity
 * Puzzle = high profit + low popularity
 * Plow Horse = low profit + high popularity
 * Dog = low profit + low popularity
 */
function classifyItem(
  foodCostPercent: number,
  orderCount: number,
  medianFoodCost: number,
  medianOrders: number
): 'star' | 'puzzle' | 'plow_horse' | 'dog' {
  const highProfit = foodCostPercent < medianFoodCost; // Lower food cost = higher profit
  const highPopularity = orderCount >= medianOrders;

  if (highProfit && highPopularity) return 'star';
  if (highProfit && !highPopularity) return 'puzzle';
  if (!highProfit && highPopularity) return 'plow_horse';
  return 'dog';
}

/**
 * Get food cost analysis for all menu items at a location.
 */
export async function getFoodCostAnalysis(locationId: string): Promise<MenuItemCostAnalysis[]> {
  const menuItems = await prisma.menuItem.findMany({
    where: { locationId, active: true },
  });

  // Get order counts for popularity (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const orderCounts: Record<string, number> = {};
  for (const item of menuItems) {
    const count = await prisma.orderItem.count({
      where: {
        menuItemId: item.id,
        order: { timestamp: { gte: thirtyDaysAgo } },
      },
    });
    orderCounts[item.id] = count;
  }

  // Get ingredient costs
  const allIngredients = await prisma.ingredientCost.findMany({
    where: { locationId },
  });

  // Group ingredients by menu item
  const ingredientsByItem: Record<string, Array<{ name: string; cost: number; unit: string; quantity: number }>> = {};
  for (const ing of allIngredients) {
    if (!ingredientsByItem[ing.menuItemId]) ingredientsByItem[ing.menuItemId] = [];
    ingredientsByItem[ing.menuItemId].push({
      name: ing.ingredientName,
      cost: ing.cost,
      unit: ing.unit,
      quantity: ing.quantity,
    });
  }

  // Calculate cost analysis for each item
  const analyses: MenuItemCostAnalysis[] = [];
  const foodCostPercents: number[] = [];
  const orderCountValues: number[] = [];

  for (const item of menuItems) {
    const ingredients = ingredientsByItem[item.id] ?? [];
    const ingredientCost = ingredients.reduce((sum, ing) => sum + ing.cost * ing.quantity, 0);
    const foodCostPercent = item.price > 0 ? (ingredientCost / item.price) * 100 : 0;
    const margin = item.price - ingredientCost;

    if (ingredients.length > 0) {
      foodCostPercents.push(foodCostPercent);
    }
    orderCountValues.push(orderCounts[item.id] ?? 0);

    analyses.push({
      menuItemId: item.id,
      menuItemName: item.name,
      menuPrice: item.price,
      ingredientCost: Math.round(ingredientCost * 100) / 100,
      foodCostPercent: Math.round(foodCostPercent * 10) / 10,
      margin: Math.round(margin * 100) / 100,
      category: 'dog', // Placeholder, will be classified below
      ingredients,
    });
  }

  // Calculate medians for classification
  const sortedCosts = [...foodCostPercents].sort((a, b) => a - b);
  const sortedOrders = [...orderCountValues].sort((a, b) => a - b);
  const medianFoodCost = sortedCosts.length > 0
    ? sortedCosts[Math.floor(sortedCosts.length / 2)]
    : 30; // Default 30% if no data
  const medianOrders = sortedOrders.length > 0
    ? sortedOrders[Math.floor(sortedOrders.length / 2)]
    : 0;

  // Classify items
  for (const analysis of analyses) {
    analysis.category = classifyItem(
      analysis.foodCostPercent,
      orderCounts[analysis.menuItemId] ?? 0,
      medianFoodCost,
      medianOrders
    );
  }

  return analyses;
}

/**
 * Get food cost summary for a location.
 */
export async function getFoodCostSummary(locationId: string): Promise<FoodCostSummary> {
  const analyses = await getFoodCostAnalysis(locationId);

  const itemsWithCostData = analyses.filter((a) => a.ingredients.length > 0);
  const totalRevenuePotential = analyses.reduce((sum, a) => sum + a.menuPrice, 0);
  const totalIngredientCost = itemsWithCostData.reduce((sum, a) => sum + a.ingredientCost, 0);
  const overallFoodCostPercent = totalRevenuePotential > 0
    ? (totalIngredientCost / totalRevenuePotential) * 100
    : 0;

  const avgFoodCost = itemsWithCostData.length > 0
    ? itemsWithCostData.reduce((sum, a) => sum + a.foodCostPercent, 0) / itemsWithCostData.length
    : 0;

  // Category breakdown
  const categoryBreakdown: Record<string, number> = { star: 0, puzzle: 0, plow_horse: 0, dog: 0 };
  for (const a of analyses) {
    categoryBreakdown[a.category]++;
  }

  // High cost items (food cost > 35%)
  const highCostItems = itemsWithCostData
    .filter((a) => a.foodCostPercent > 35)
    .sort((a, b) => b.foodCostPercent - a.foodCostPercent)
    .map((a) => ({ name: a.menuItemName, foodCostPercent: a.foodCostPercent }));

  // Generate recommendations
  const recommendations: string[] = [];
  if (overallFoodCostPercent > 35) {
    recommendations.push('Overall food cost is above 35%. Review ingredient sourcing and portion sizes.');
  }
  if (highCostItems.length > 0) {
    recommendations.push(`${highCostItems.length} item(s) have food cost above 35%. Consider price adjustments or recipe optimization.`);
  }
  const dogs = analyses.filter((a) => a.category === 'dog');
  if (dogs.length > 0) {
    recommendations.push(`${dogs.length} "dog" item(s) have low profit and low popularity. Consider removing or reworking them.`);
  }
  const puzzles = analyses.filter((a) => a.category === 'puzzle');
  if (puzzles.length > 0) {
    recommendations.push(`${puzzles.length} "puzzle" item(s) are profitable but unpopular. Promote them with specials or better placement.`);
  }
  if (itemsWithCostData.length < analyses.length) {
    recommendations.push(`${analyses.length - itemsWithCostData.length} item(s) have no ingredient cost data. Add costs for accurate analysis.`);
  }

  return {
    locationId,
    totalMenuItems: analyses.length,
    itemsWithCostData: itemsWithCostData.length,
    averageFoodCostPercent: Math.round(avgFoodCost * 10) / 10,
    totalRevenuePotential: Math.round(totalRevenuePotential * 100) / 100,
    totalIngredientCost: Math.round(totalIngredientCost * 100) / 100,
    overallFoodCostPercent: Math.round(overallFoodCostPercent * 10) / 10,
    categoryBreakdown,
    highCostItems,
    recommendations,
  };
}
