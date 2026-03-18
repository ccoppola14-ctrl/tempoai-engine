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
import 'dotenv/config';
import prisma from '../src/db/client';
import { listLocations, listCatalog, listOrders, listPayments } from '../src/integrations/square/client';
import { syncLocationCatalog, syncLocationOrders, initialSync } from '../src/integrations/square/sync';
import { snapshotWeather } from '../src/integrations/weather/client';
import { analyzeLocation } from '../src/ai/engine';
import { logger } from '../src/utils/logger';

async function main(): Promise<void> {
  console.log('🔄 Full Sync + Analyze Flow');
  console.log('===========================\n');

  // 1. Connect to Square sandbox and list locations
  console.log('📍 Step 1: Fetching Square locations...');
  const squareLocations = await listLocations();

  if (squareLocations.length === 0) {
    console.error('❌ No locations found in Square account');
    process.exit(1);
  }

  for (const loc of squareLocations) {
    console.log(`   - ${loc.name} (${loc.id})`);
  }

  // 2. Ensure locations are in our database
  console.log('\n📦 Step 2: Ensuring locations exist in database...');
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: squareLocations[0].businessName ?? 'Restaurant Group' },
    });
    console.log(`   Created organization: ${org.name}`);
  }

  const dbLocations: Array<{ id: string; name: string }> = [];

  for (const sqLoc of squareLocations) {
    let location = await prisma.location.findFirst({
      where: { squareMerchantId: sqLoc.id },
    });

    if (!location) {
      location = await prisma.location.create({
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
          lat: sqLoc.coordinates?.latitude ?? 27.9506,  // Tampa default
          lng: sqLoc.coordinates?.longitude ?? -82.4572,
          timezone: sqLoc.timezone ?? 'America/New_York',
          squareMerchantId: sqLoc.id!,
          squareAccessToken: process.env.SQUARE_ACCESS_TOKEN || '',
        },
      });
      console.log(`   Created location: ${location.name}`);
    } else {
      // Update access token
      await prisma.location.update({
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
      const catalogCount = await syncLocationCatalog(loc.id);
      console.log(`   📋 Catalog: ${catalogCount} items synced`);
    } catch (err) {
      console.log(`   ⚠️  Catalog sync error: ${err instanceof Error ? err.message : err}`);
    }

    // Sync orders (90-day initial sync)
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const orderCount = await syncLocationOrders(loc.id, ninetyDaysAgo);
      console.log(`   🧾 Orders: ${orderCount} new orders synced`);
    } catch (err) {
      console.log(`   ⚠️  Order sync error: ${err instanceof Error ? err.message : err}`);
    }

    // Fetch payment info (not stored locally, just logged)
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const location = await prisma.location.findUnique({ where: { id: loc.id } });
      if (location?.squareMerchantId) {
        const payments = await listPayments(
          location.squareMerchantId,
          ninetyDaysAgo,
          undefined,
          location.squareAccessToken ?? undefined
        );
        console.log(`   💳 Payments: ${payments.length} fetched`);
      }
    } catch (err) {
      console.log(`   ⚠️  Payment fetch error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 4. Pull weather data
  console.log('\n🌤️  Step 4: Pulling weather data...');
  for (const loc of dbLocations) {
    try {
      await snapshotWeather(loc.id);
      console.log(`   ✅ Weather snapshot for ${loc.name}`);
    } catch (err) {
      console.log(`   ⚠️  Weather fetch error for ${loc.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 5. Run AI analysis
  console.log('\n🧠 Step 5: Running AI analysis...');
  for (const loc of dbLocations) {
    try {
      const result = await analyzeLocation(loc.id);
      console.log(`   ✅ ${loc.name}: ${result.patternsFound} patterns, ${result.recommendationsGenerated} recommendations`);
    } catch (err) {
      console.log(`   ⚠️  Analysis error for ${loc.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 6. Print summary
  console.log('\n📊 Summary');
  console.log('══════════\n');

  for (const loc of dbLocations) {
    const orderCount = await prisma.order.count({ where: { locationId: loc.id } });
    const menuCount = await prisma.menuItem.count({ where: { locationId: loc.id } });
    const patternCount = await prisma.aIPattern.count({ where: { locationId: loc.id } });
    const recCount = await prisma.recommendation.count({ where: { locationId: loc.id, status: 'active' } });
    const weatherCount = await prisma.weatherSnapshot.count({ where: { locationId: loc.id } });

    console.log(`📍 ${loc.name}`);
    console.log(`   Menu items:       ${menuCount}`);
    console.log(`   Orders:           ${orderCount}`);
    console.log(`   Weather snapshots:${weatherCount}`);
    console.log(`   AI patterns:      ${patternCount}`);
    console.log(`   Recommendations:  ${recCount}`);

    // Top patterns
    const topPatterns = await prisma.aIPattern.findMany({
      where: { locationId: loc.id },
      include: { menuItem: true },
      orderBy: { liftPercent: 'desc' },
      take: 5,
    });

    if (topPatterns.length > 0) {
      console.log(`   Top patterns:`);
      for (const p of topPatterns) {
        console.log(
          `     • ${p.menuItem.name}: ${p.patternType} [${p.triggerCondition}] → +${p.liftPercent.toFixed(0)}% lift (${p.confidence.toFixed(1)} confidence)`
        );
      }
    }

    // Active recommendations
    const activeRecs = await prisma.recommendation.findMany({
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
    await prisma.$disconnect();
  });
