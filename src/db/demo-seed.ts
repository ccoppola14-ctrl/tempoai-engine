import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from './client';
import type { DemoBrandConfig } from './demo-brands';

// ─── Constants ────────────────────────────────────────────
const DEMO_ORG_ID = 'demo-org-lees-donuts-v2';
const DEMO_USER_EMAIL = 'demo@usetempoai.com';
const DAYS_OF_DATA = 3;

// ─── Deterministic RNG ───────────────────────────────────
let _seed = 2024;
function seededRandom(): number {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed - 1) / 2147483646;
}
function randomBetween(min: number, max: number): number {
  return min + seededRandom() * (max - min);
}
function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)];
}

// ═══════════════════════════════════════════════════════════
// MAIN SEED FUNCTION
// ═══════════════════════════════════════════════════════════

export async function seedDemoOrganization(brandConfig: DemoBrandConfig): Promise<{
  organizationId: string;
  locationCount: number;
  menuItemCount: number;
  orderCount: number;
  demoUserEmail: string;
  demoUserPassword: string;
}> {
  console.log('[seedDemo] Starting...');
  
  // Reset RNG
  _seed = 2024;

  // 1. Clear existing demo data
  console.log('[seedDemo] Clearing...');
  await clearDemoData();

  // 2. Create demo org
  console.log('[seedDemo] Creating org...');
  const org = await prisma.organization.create({
    data: { id: DEMO_ORG_ID, name: brandConfig.brandName, isDemo: true },
  });

  // 3. Create demo user
  console.log('[seedDemo] Creating user...');
  const tempPassword = `demo-${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await prisma.user.create({
    data: {
      id: `demo-user-lees-donuts`,
      email: DEMO_USER_EMAIL,
      passwordHash,
      name: 'Demo User',
      role: 'OWNER',
      organizationId: org.id,
      emailVerified: true,
    },
  });

  // 4. Create locations (just first 3 for speed)
  console.log('[seedDemo] Creating 3 locations...');
  const locationCount = Math.min(3, brandConfig.locations.length);
  const locationRecords = [];
  for (let i = 0; i < locationCount; i++) {
    const loc = brandConfig.locations[i];
    const locationId = `demo-loc-${i.toString().padStart(2, '0')}`;
    const record = await prisma.location.create({
      data: {
        id: locationId,
        organizationId: org.id,
        name: loc.name,
        address: loc.address,
        lat: loc.lat,
        lng: loc.lng,
        timezone: loc.timezone,
      },
    });
    locationRecords.push(record);
    console.log(`  - ${loc.name}`);
  }

  // 5. Create menu items
  console.log('[seedDemo] Creating menu items...');
  let menuItemCount = 0;
  const allMenuItems: Map<string, Array<{id: string; name: string; category: string; price: number}>> = new Map();
  for (const location of locationRecords) {
    const items = [];
    for (let i = 0; i < brandConfig.menuItems.length; i++) {
      const mi = brandConfig.menuItems[i];
      const menuItemId = `demo-mi-${location.id}-${i.toString().padStart(2, '0')}`;
      await prisma.menuItem.create({
        data: {
          id: menuItemId,
          locationId: location.id,
          name: mi.name,
          category: mi.category,
          price: mi.price,
          active: true,
        },
      });
      items.push({ id: menuItemId, name: mi.name, category: mi.category, price: mi.price });
      menuItemCount++;
    }
    allMenuItems.set(location.id, items);
  }

  // 6. Generate minimal orders (last 3 days)
  console.log('[seedDemo] Creating orders (3 days)...');
  let totalOrders = 0;
  const now = new Date();
  
  for (let locIdx = 0; locIdx < locationRecords.length; locIdx++) {
    const location = locationRecords[locIdx];
    const menuItems = allMenuItems.get(location.id)!;
    
    for (let daysAgo = 0; daysAgo < DAYS_OF_DATA; daysAgo++) {
      const date = new Date(now);
      date.setDate(date.getDate() - daysAgo);
      
      // Generate 50-80 orders per day per location
      const ordersToday = randomInt(50, 80);
      for (let o = 0; o < ordersToday; o++) {
        const orderId = `demo-order-${location.id}-${daysAgo}-${o}`;
        const hour = randomInt(6, 21);
        const minute = randomInt(0, 59);
        const orderTime = new Date(date);
        orderTime.setHours(hour, minute, 0, 0);
        
        // 1-4 items per order
        const itemCount = pick([1, 1, 2, 2, 3, 4]);
        let total = 0;
        const orderItemData = [];
        
        for (let j = 0; j < itemCount; j++) {
          const item = pick(menuItems);
          const qty = pick([1, 1, 1, 2]);
          const amount = item.price * qty;
          total += amount;
          orderItemData.push({
            id: `demo-oi-${orderId}-${j}`,
            orderId,
            menuItemId: item.id,
            quantity: qty,
            amount: Math.round(amount * 100) / 100,
          });
        }
        
        await prisma.order.create({
          data: {
            id: orderId,
            locationId: location.id,
            timestamp: orderTime,
            total: Math.round(total * 100) / 100,
            itemCount: orderItemData.reduce((s, x) => s + x.quantity, 0),
          },
        });
        await prisma.orderItem.createMany({ data: orderItemData });
        totalOrders++;
      }
    }
  }

  console.log(`[seedDemo] Done! ${totalOrders} orders created.`);
  
  return {
    organizationId: org.id,
    locationCount: locationRecords.length,
    menuItemCount,
    orderCount: totalOrders,
    demoUserEmail: DEMO_USER_EMAIL,
    demoUserPassword: tempPassword,
  };
}

// ═══════════════════════════════════════════════════════════
// CLEAR FUNCTION
// ═══════════════════════════════════════════════════════════

export async function clearDemoData(): Promise<{ deleted: boolean }> {
  console.log('[clearDemo] Finding demo orgs...');
  const demoOrgs = await prisma.organization.findMany({
    where: { isDemo: true },
    select: { id: true },
  });

  if (demoOrgs.length === 0) {
    console.log('[clearDemo] No demo orgs found');
    return { deleted: false };
  }

  const orgIds = demoOrgs.map((o) => o.id);
  console.log(`[clearDemo] Deleting ${orgIds.length} demo org(s)...`);

  // Get location IDs
  const locations = await prisma.location.findMany({
    where: { organizationId: { in: orgIds } },
    select: { id: true },
  });
  const locationIds = locations.map((l) => l.id);

  // Get order IDs for these locations first
  const orders = await prisma.order.findMany({
    where: { locationId: { in: locationIds } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  if (locationIds.length > 0) {
    // Delete in correct order (child records first)
    if (orderIds.length > 0) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    }
    await prisma.order.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.menuItem.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.weatherSnapshot.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.dailySummary.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.alert.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.location.deleteMany({ where: { organizationId: { in: orgIds } } });
  }

  await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });

  console.log('[clearDemo] Done');
  return { deleted: true };
}

// ═══════════════════════════════════════════════════════════
// SWAP BRAND
// ═══════════════════════════════════════════════════════════

export async function swapDemoBrand(brandSlug: string): Promise<any> {
  const { getBrandConfig } = require('./demo-brands');
  const config = getBrandConfig(brandSlug);
  if (!config) {
    throw new Error(`Unknown brand: ${brandSlug}`);
  }
  return seedDemoOrganization(config);
}

// ═══════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════

export async function getDemoStatus(): Promise<any> {
  const demoOrg = await prisma.organization.findFirst({
    where: { isDemo: true },
    include: { locations: true, users: true },
  });

  if (!demoOrg) {
    return { active: false, locationCount: 0, menuItemCount: 0, orderCount: 0 };
  }

  const locationIds = demoOrg.locations.map((l) => l.id);
  const menuItemCount = locationIds.length > 0
    ? await prisma.menuItem.count({ where: { locationId: { in: locationIds } } })
    : 0;
  const orderCount = locationIds.length > 0
    ? await prisma.order.count({ where: { locationId: { in: locationIds } } })
    : 0;

  return {
    active: true,
    organization: { id: demoOrg.id, name: demoOrg.name, createdAt: demoOrg.createdAt },
    locationCount: demoOrg.locations.length,
    menuItemCount,
    orderCount,
    userEmail: demoOrg.users[0]?.email,
  };
}