"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Seed the Square sandbox with realistic restaurant test data.
 *
 * Creates:
 * - 30+ catalog items (appetizers, entrees, drinks, desserts)
 * - 500+ orders spread over the last 90 days
 *
 * Usage: npx ts-node scripts/seed-square-sandbox.ts
 */
require("dotenv/config");
const square_1 = require("square");
const uuid_1 = require("uuid");
const client = new square_1.SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN || '',
    environment: square_1.SquareEnvironment.Sandbox,
});
const MENU_ITEMS = [
    // Appetizers
    { name: 'Mozzarella Sticks', category: 'Appetizers', priceCents: 899 },
    { name: 'Loaded Nachos', category: 'Appetizers', priceCents: 1199 },
    { name: 'Buffalo Wings', category: 'Appetizers', priceCents: 1299 },
    { name: 'Bruschetta', category: 'Appetizers', priceCents: 999 },
    { name: 'Calamari', category: 'Appetizers', priceCents: 1099 },
    { name: 'Spinach Artichoke Dip', category: 'Appetizers', priceCents: 1049 },
    // Entrees
    { name: 'Grilled Salmon', category: 'Entrees', priceCents: 2299 },
    { name: 'NY Strip Steak', category: 'Entrees', priceCents: 2899 },
    { name: 'Chicken Alfredo', category: 'Entrees', priceCents: 1699 },
    { name: 'Fish Tacos', category: 'Entrees', priceCents: 1499 },
    { name: 'Classic Burger', category: 'Entrees', priceCents: 1399 },
    { name: 'BBQ Ribs', category: 'Entrees', priceCents: 2199 },
    { name: 'Shrimp Scampi', category: 'Entrees', priceCents: 1999 },
    { name: 'Veggie Stir Fry', category: 'Entrees', priceCents: 1399 },
    // Salads & Soups
    { name: 'Caesar Salad', category: 'Salads', priceCents: 1199 },
    { name: 'Garden Salad', category: 'Salads', priceCents: 999 },
    { name: 'Tomato Basil Soup', category: 'Soups', priceCents: 799 },
    { name: 'Chicken Noodle Soup', category: 'Soups', priceCents: 849 },
    { name: 'Clam Chowder', category: 'Soups', priceCents: 999 },
    // Sides
    { name: 'French Fries', category: 'Sides', priceCents: 599 },
    { name: 'Mac & Cheese', category: 'Sides', priceCents: 699 },
    { name: 'Coleslaw', category: 'Sides', priceCents: 449 },
    { name: 'Sweet Potato Fries', category: 'Sides', priceCents: 699 },
    // Drinks
    { name: 'Iced Tea', category: 'Drinks', priceCents: 349 },
    { name: 'Lemonade', category: 'Drinks', priceCents: 399 },
    { name: 'Coffee', category: 'Drinks', priceCents: 299 },
    { name: 'Cappuccino', category: 'Drinks', priceCents: 499 },
    { name: 'Smoothie', category: 'Drinks', priceCents: 699 },
    { name: 'Hot Chocolate', category: 'Drinks', priceCents: 449 },
    // Desserts
    { name: 'Chocolate Brownie', category: 'Desserts', priceCents: 799 },
    { name: 'Cheesecake', category: 'Desserts', priceCents: 899 },
    { name: 'Ice Cream Sundae', category: 'Desserts', priceCents: 749 },
    { name: 'Key Lime Pie', category: 'Desserts', priceCents: 849 },
    { name: 'Churros', category: 'Desserts', priceCents: 649 },
];
// ─── Helpers ──────────────────────────────────────────────
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
// ─── Step 1: Create Catalog Items ─────────────────────────
async function createCatalogItems(locationId) {
    console.log('\n📦 Creating catalog items...');
    // Build catalog objects with temporary IDs
    const objects = [];
    for (let i = 0; i < MENU_ITEMS.length; i++) {
        const item = MENU_ITEMS[i];
        objects.push({
            type: 'ITEM',
            id: `#item-${i}`,
            itemData: {
                name: item.name,
                description: `${item.category} — ${item.name}`,
                variations: [
                    {
                        type: 'ITEM_VARIATION',
                        id: `#var-${i}`,
                        itemVariationData: {
                            name: 'Regular',
                            pricingType: 'FIXED_PRICING',
                            priceMoney: { amount: BigInt(item.priceCents), currency: 'USD' },
                        },
                    },
                ],
            },
        });
    }
    // Batch upsert (max 1000 objects per batch)
    const response = await client.catalog.batchUpsert({
        idempotencyKey: (0, uuid_1.v4)(),
        batches: [{ objects: objects }],
    });
    // Map server-assigned IDs back to our items
    const idMapping = response.idMappings ?? [];
    const variationToItem = new Map();
    for (const mapping of idMapping) {
        const clientId = mapping.clientObjectId ?? '';
        const serverId = mapping.objectId ?? '';
        // Map variation IDs to their menu item
        if (clientId.startsWith('#var-')) {
            const idx = parseInt(clientId.replace('#var-', ''), 10);
            variationToItem.set(serverId, MENU_ITEMS[idx]);
        }
    }
    console.log(`  ✅ Created ${MENU_ITEMS.length} catalog items (${idMapping.length} total objects including variations)`);
    return variationToItem;
}
// ─── Step 2: Create Orders ────────────────────────────────
async function createOrders(locationId, variationToItem) {
    console.log('\n🧾 Creating orders...');
    const variationIds = Array.from(variationToItem.keys());
    if (variationIds.length === 0) {
        console.log('  ⚠️  No variation IDs found — fetching catalog to get IDs...');
        // Fallback: list catalog to get real variation IDs
        const page = await client.catalog.list({ types: 'ITEM' });
        for await (const obj of page) {
            if (obj.type !== 'ITEM')
                continue;
            const itemData = obj.itemData;
            if (!itemData?.variations)
                continue;
            for (const v of itemData.variations) {
                if (v.type === 'ITEM_VARIATION') {
                    const mi = MENU_ITEMS.find((m) => m.name === itemData.name);
                    if (mi) {
                        variationToItem.set(v.id, mi);
                        variationIds.push(v.id);
                    }
                }
            }
        }
        console.log(`  Found ${variationIds.length} variation IDs from catalog`);
    }
    const now = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    let orderCount = 0;
    let errorCount = 0;
    // Create ~550 orders spread over 90 days
    const totalOrders = 550;
    const batchSize = 10; // Create orders in small batches to avoid rate limits
    for (let i = 0; i < totalOrders; i += batchSize) {
        const batch = Math.min(batchSize, totalOrders - i);
        const promises = [];
        for (let j = 0; j < batch; j++) {
            const orderIdx = i + j;
            // Spread orders over 90 days
            const daysAgo = Math.floor((orderIdx / totalOrders) * 90);
            const hoursOfDay = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
            const hour = randomPick(hoursOfDay);
            const orderDate = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
            orderDate.setHours(hour, randomInt(0, 59), randomInt(0, 59), 0);
            // Pick 1-4 line items
            const numItems = randomInt(1, 4);
            const lineItems = [];
            const usedIds = new Set();
            for (let k = 0; k < numItems; k++) {
                let varId;
                do {
                    varId = randomPick(variationIds);
                } while (usedIds.has(varId) && usedIds.size < variationIds.length);
                usedIds.add(varId);
                lineItems.push({
                    catalogObjectId: varId,
                    quantity: String(randomInt(1, 2)),
                });
            }
            promises.push((async () => {
                try {
                    await client.orders.create({
                        order: {
                            locationId,
                            lineItems: lineItems.map((li) => ({
                                catalogObjectId: li.catalogObjectId,
                                quantity: li.quantity,
                            })),
                            state: 'COMPLETED',
                            createdAt: orderDate.toISOString(),
                        },
                        idempotencyKey: (0, uuid_1.v4)(),
                    });
                    orderCount++;
                }
                catch (err) {
                    errorCount++;
                    if (errorCount <= 3) {
                        console.log(`  ⚠️  Order creation error: ${err.message || err}`);
                    }
                }
            })());
        }
        await Promise.all(promises);
        // Rate limit: ~30 requests per second for Square sandbox
        await sleep(400);
        if ((i + batch) % 50 === 0 || i + batch >= totalOrders) {
            console.log(`  Progress: ${orderCount} orders created (${errorCount} errors)...`);
        }
    }
    console.log(`  ✅ Created ${orderCount} orders total (${errorCount} errors)`);
}
// ─── Main ─────────────────────────────────────────────────
async function main() {
    console.log('🌱 Square Sandbox Seed Script');
    console.log('============================\n');
    // Get location
    const locationsResponse = await client.locations.list();
    const locations = locationsResponse.locations ?? [];
    if (locations.length === 0) {
        console.error('❌ No locations found in Square sandbox');
        process.exit(1);
    }
    const location = locations[0];
    console.log(`📍 Using location: ${location.name} (${location.id})`);
    // Step 1: Create catalog items
    const variationMap = await createCatalogItems(location.id);
    // Give Square a moment to process the catalog
    await sleep(2000);
    // Step 2: Create orders
    await createOrders(location.id, variationMap);
    console.log('\n🎉 Sandbox seeding complete!');
    console.log(`   Location: ${location.name}`);
    console.log(`   Location ID: ${location.id}`);
    console.log(`   Catalog items: ${MENU_ITEMS.length}`);
    console.log('   Orders: 500+\n');
    console.log('You can now run: npx ts-node scripts/full-sync.ts');
}
main().catch((err) => {
    console.error('💥 Seed script failed:', err);
    process.exit(1);
});
//# sourceMappingURL=seed-square-sandbox.js.map