"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertIngredientCosts = upsertIngredientCosts;
exports.getFoodCostAnalysis = getFoodCostAnalysis;
exports.getFoodCostSummary = getFoodCostSummary;
const client_1 = __importDefault(require("../db/client"));
const logger_1 = require("../utils/logger");
/**
 * Add or update ingredient costs for a menu item.
 */
async function upsertIngredientCosts(locationId, menuItemId, ingredients) {
    logger_1.logger.info('FoodCost', `Updating ingredient costs for menu item ${menuItemId}`);
    // Delete existing ingredients for this menu item at this location
    await client_1.default.ingredientCost.deleteMany({
        where: { locationId, menuItemId },
    });
    // Insert new ingredients
    for (const ing of ingredients) {
        await client_1.default.ingredientCost.create({
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
    logger_1.logger.info('FoodCost', `Saved ${ingredients.length} ingredients for item ${menuItemId}`);
}
/**
 * Classify a menu item using the BCG matrix approach:
 * Star = high profit + high popularity
 * Puzzle = high profit + low popularity
 * Plow Horse = low profit + high popularity
 * Dog = low profit + low popularity
 */
function classifyItem(foodCostPercent, orderCount, medianFoodCost, medianOrders) {
    const highProfit = foodCostPercent < medianFoodCost; // Lower food cost = higher profit
    const highPopularity = orderCount >= medianOrders;
    if (highProfit && highPopularity)
        return 'star';
    if (highProfit && !highPopularity)
        return 'puzzle';
    if (!highProfit && highPopularity)
        return 'plow_horse';
    return 'dog';
}
/**
 * Get food cost analysis for all menu items at a location.
 */
async function getFoodCostAnalysis(locationId) {
    const menuItems = await client_1.default.menuItem.findMany({
        where: { locationId, active: true },
    });
    // Get order counts for popularity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const orderCounts = {};
    for (const item of menuItems) {
        const count = await client_1.default.orderItem.count({
            where: {
                menuItemId: item.id,
                order: { timestamp: { gte: thirtyDaysAgo } },
            },
        });
        orderCounts[item.id] = count;
    }
    // Get ingredient costs
    const allIngredients = await client_1.default.ingredientCost.findMany({
        where: { locationId },
    });
    // Group ingredients by menu item
    const ingredientsByItem = {};
    for (const ing of allIngredients) {
        if (!ingredientsByItem[ing.menuItemId])
            ingredientsByItem[ing.menuItemId] = [];
        ingredientsByItem[ing.menuItemId].push({
            name: ing.ingredientName,
            cost: ing.cost,
            unit: ing.unit,
            quantity: ing.quantity,
        });
    }
    // Calculate cost analysis for each item
    const analyses = [];
    const foodCostPercents = [];
    const orderCountValues = [];
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
        analysis.category = classifyItem(analysis.foodCostPercent, orderCounts[analysis.menuItemId] ?? 0, medianFoodCost, medianOrders);
    }
    return analyses;
}
/**
 * Get food cost summary for a location.
 */
async function getFoodCostSummary(locationId) {
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
    const categoryBreakdown = { star: 0, puzzle: 0, plow_horse: 0, dog: 0 };
    for (const a of analyses) {
        categoryBreakdown[a.category]++;
    }
    // High cost items (food cost > 35%)
    const highCostItems = itemsWithCostData
        .filter((a) => a.foodCostPercent > 35)
        .sort((a, b) => b.foodCostPercent - a.foodCostPercent)
        .map((a) => ({ name: a.menuItemName, foodCostPercent: a.foodCostPercent }));
    // Generate recommendations
    const recommendations = [];
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
//# sourceMappingURL=food-cost.js.map