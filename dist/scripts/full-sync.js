"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Full sync + analyze flow.
 *
 * 1. Connect to Square sandbox
 * 2. Pull all locations
 * 3. For each location: sync catalog, sync orders, sync payments
 * 4. Pull weather data
 * 5. Run AI analysis
 * 6. Print summary of patterns found
 *
 * Usage: npx ts-node scripts/full-sync.ts
 */
require("dotenv/config");
const client_1 = __importDefault(require("../src/db/client"));
const client_2 = require("../src/integrations/square/client");
const sync_1 = require("../src/integrations/square/sync");
const client_3 = require("../src/integrations/weather/client");
const engine_1 = require("../src/ai/engine");
async function main() {
    console.log('🔄 Full Sync + Analyze Flow');
    console.log('===========================\n');
    // 1. Connect to Square sandbox and list locations
    console.log('📍 Step 1: Fetching Square locations...');
    const squareLocations = await (0, client_2.listLocations)();
    if (squareLocations.length === 0) {
        console.error('❌ No locations found in Square account');
        process.exit(1);
    }
    for (const loc of squareLocations) {
        console.log(`   - ${loc.name} (${loc.id})`);
    }
    // 2. Ensure locations are in our database
    console.log('\n📦 Step 2: Ensuring locations exist in database...');
    let org = await client_1.default.organization.findFirst();
    if (!org) {
        org = await client_1.default.organization.create({
            data: { name: squareLocations[0].businessName ?? 'Restaurant Group' },
        });
        console.log(`   Created organization: ${org.name}`);
    }
    const dbLocations = [];
    for (const sqLoc of squareLocations) {
        let location = await client_1.default.location.findFirst({
            where: { squareMerchantId: sqLoc.id },
        });
        if (!location) {
            location = await client_1.default.location.create({
                data: {
                    organizationId: org.id,
                    name: sqLoc.name ?? 'Square Location',
                    address: sqLoc.address
                        ? [
                            sqLoc.address.addressLine1,
                            sqLoc.address.locality,
                            sqLoc.address.administrativeDistrictLevel1,
                        ]
                            .filter(Boolean)
                            .join(', ')
                        : '',
                    lat: sqLoc.coordinates?.latitude ?? 27.9506, // Tampa default
                    lng: sqLoc.coordinates?.longitude ?? -82.4572,
                    timezone: sqLoc.timezone ?? 'America/New_York',
                    squareMerchantId: sqLoc.id,
                    squareAccessToken: process.env.SQUARE_ACCESS_TOKEN || '',
                },
            });
            console.log(`   Created location: ${location.name}`);
        }
        else {
            // Update access token
            await client_1.default.location.update({
                where: { id: location.id },
                data: { squareAccessToken: process.env.SQUARE_ACCESS_TOKEN || '' },
            });
            console.log(`   Updated location: ${location.name}`);
        }
        dbLocations.push({ id: location.id, name: location.name });
    }
    // 3. Sync each location
    console.log('\n🔄 Step 3: Syncing catalog and orders for each location...');
    for (const loc of dbLocations) {
        console.log(`\n   --- ${loc.name} ---`);
        // Sync catalog
        try {
            const catalogCount = await (0, sync_1.syncLocationCatalog)(loc.id);
            console.log(`   📋 Catalog: ${catalogCount} items synced`);
        }
        catch (err) {
            console.log(`   ⚠️  Catalog sync error: ${err instanceof Error ? err.message : err}`);
        }
        // Sync orders (90-day initial sync)
        try {
            const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            const orderCount = await (0, sync_1.syncLocationOrders)(loc.id, ninetyDaysAgo);
            console.log(`   🧾 Orders: ${orderCount} new orders synced`);
        }
        catch (err) {
            console.log(`   ⚠️  Order sync error: ${err instanceof Error ? err.message : err}`);
        }
        // Fetch payment info (not stored locally, just logged)
        try {
            const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            const location = await client_1.default.location.findUnique({ where: { id: loc.id } });
            if (location?.squareMerchantId) {
                const payments = await (0, client_2.listPayments)(location.squareMerchantId, ninetyDaysAgo, undefined, location.squareAccessToken ?? undefined);
                console.log(`   💳 Payments: ${payments.length} fetched`);
            }
        }
        catch (err) {
            console.log(`   ⚠️  Payment fetch error: ${err instanceof Error ? err.message : err}`);
        }
    }
    // 4. Pull weather data
    console.log('\n🌤️  Step 4: Pulling weather data...');
    for (const loc of dbLocations) {
        try {
            await (0, client_3.snapshotWeather)(loc.id);
            console.log(`   ✅ Weather snapshot for ${loc.name}`);
        }
        catch (err) {
            console.log(`   ⚠️  Weather fetch error for ${loc.name}: ${err instanceof Error ? err.message : err}`);
        }
    }
    // 5. Run AI analysis
    console.log('\n🧠 Step 5: Running AI analysis...');
    for (const loc of dbLocations) {
        try {
            const result = await (0, engine_1.analyzeLocation)(loc.id);
            console.log(`   ✅ ${loc.name}: ${result.patternsFound} patterns, ${result.recommendationsGenerated} recommendations`);
        }
        catch (err) {
            console.log(`   ⚠️  Analysis error for ${loc.name}: ${err instanceof Error ? err.message : err}`);
        }
    }
    // 6. Print summary
    console.log('\n📊 Summary');
    console.log('══════════\n');
    for (const loc of dbLocations) {
        const orderCount = await client_1.default.order.count({ where: { locationId: loc.id } });
        const menuCount = await client_1.default.menuItem.count({ where: { locationId: loc.id } });
        const patternCount = await client_1.default.aIPattern.count({ where: { locationId: loc.id } });
        const recCount = await client_1.default.recommendation.count({ where: { locationId: loc.id, status: 'active' } });
        const weatherCount = await client_1.default.weatherSnapshot.count({ where: { locationId: loc.id } });
        console.log(`📍 ${loc.name}`);
        console.log(`   Menu items:       ${menuCount}`);
        console.log(`   Orders:           ${orderCount}`);
        console.log(`   Weather snapshots:${weatherCount}`);
        console.log(`   AI patterns:      ${patternCount}`);
        console.log(`   Recommendations:  ${recCount}`);
        // Top patterns
        const topPatterns = await client_1.default.aIPattern.findMany({
            where: { locationId: loc.id },
            include: { menuItem: true },
            orderBy: { liftPercent: 'desc' },
            take: 5,
        });
        if (topPatterns.length > 0) {
            console.log(`   Top patterns:`);
            for (const p of topPatterns) {
                console.log(`     • ${p.menuItem.name}: ${p.patternType} [${p.triggerCondition}] → +${p.liftPercent.toFixed(0)}% lift (${p.confidence.toFixed(1)} confidence)`);
            }
        }
        // Active recommendations
        const activeRecs = await client_1.default.recommendation.findMany({
            where: { locationId: loc.id, status: 'active', currentlyActive: true },
            include: { menuItem: true },
            orderBy: { expectedLift: 'desc' },
            take: 5,
        });
        if (activeRecs.length > 0) {
            console.log(`   Active recommendations:`);
            for (const r of activeRecs) {
                console.log(`     • ${r.message} (+${r.expectedLift.toFixed(0)}% expected)`);
            }
        }
        console.log();
    }
    console.log('✅ Full sync + analyze complete!');
}
main()
    .catch((err) => {
    console.error('💥 Full sync failed:', err);
    process.exit(1);
})
    .finally(async () => {
    await client_1.default.$disconnect();
});
//# sourceMappingURL=full-sync.js.map