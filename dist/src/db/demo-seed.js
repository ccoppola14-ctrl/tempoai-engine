"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDemoOrganization = seedDemoOrganization;
exports.clearDemoData = clearDemoData;
exports.swapDemoBrand = swapDemoBrand;
exports.getDemoStatus = getDemoStatus;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const client_1 = __importDefault(require("./client"));
// ─── Constants ────────────────────────────────────────────
const DEMO_ORG_ID = 'demo-org-lees-donuts-v2';
const DEMO_USER_EMAIL = 'demo@usetempoai.com';
const DAYS_OF_DATA = 3;
// ─── Deterministic RNG ───────────────────────────────────
let _seed = 2024;
function seededRandom() {
    _seed = (_seed * 16807 + 0) % 2147483647;
    return (_seed - 1) / 2147483646;
}
function randomBetween(min, max) {
    return min + seededRandom() * (max - min);
}
function randomInt(min, max) {
    return Math.floor(randomBetween(min, max + 1));
}
function pick(arr) {
    return arr[Math.floor(seededRandom() * arr.length)];
}
// ═══════════════════════════════════════════════════════════
// MAIN SEED FUNCTION
// ═══════════════════════════════════════════════════════════
async function seedDemoOrganization(brandConfig) {
    console.log('[seedDemo] Starting...');
    // Reset RNG
    _seed = 2024;
    // 1. Clear existing demo data
    console.log('[seedDemo] Clearing...');
    await clearDemoData();
    // 2. Create demo org
    console.log('[seedDemo] Creating org...');
    const org = await client_1.default.organization.create({
        data: { id: DEMO_ORG_ID, name: brandConfig.brandName, isDemo: true },
    });
    // 3. Create demo user
    console.log('[seedDemo] Creating user...');
    const tempPassword = `demo-${crypto_1.default.randomUUID().slice(0, 8)}`;
    const passwordHash = await bcryptjs_1.default.hash(tempPassword, 12);
    await client_1.default.user.create({
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
    // 4. Create all locations
    console.log(`[seedDemo] Creating ${brandConfig.locations.length} locations...`);
    const locationCount = brandConfig.locations.length;
    const locationRecords = [];
    for (let i = 0; i < locationCount; i++) {
        const loc = brandConfig.locations[i];
        const locationId = `demo2-loc-${i.toString().padStart(2, '0')}`;
        const record = await client_1.default.location.create({
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
    const allMenuItems = new Map();
    for (const location of locationRecords) {
        const items = [];
        for (let i = 0; i < brandConfig.menuItems.length; i++) {
            const mi = brandConfig.menuItems[i];
            const menuItemId = `demo2-mi-${location.id}-${i.toString().padStart(2, '0')}`;
            await client_1.default.menuItem.create({
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
        const menuItems = allMenuItems.get(location.id);
        for (let daysAgo = 0; daysAgo < DAYS_OF_DATA; daysAgo++) {
            const date = new Date(now);
            date.setDate(date.getDate() - daysAgo);
            // Generate 15-25 orders per day per location (keeps seed fast across 11 locations)
            const ordersToday = randomInt(15, 25);
            for (let o = 0; o < ordersToday; o++) {
                const orderId = `demo2-order-${location.id}-${daysAgo}-${o}`;
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
                        id: `demo2-oi-${orderId}-${j}`,
                        orderId,
                        menuItemId: item.id,
                        quantity: qty,
                        amount: Math.round(amount * 100) / 100,
                    });
                }
                await client_1.default.order.create({
                    data: {
                        id: orderId,
                        locationId: location.id,
                        timestamp: orderTime,
                        total: Math.round(total * 100) / 100,
                        itemCount: orderItemData.reduce((s, x) => s + x.quantity, 0),
                    },
                });
                await client_1.default.orderItem.createMany({ data: orderItemData });
                totalOrders++;
            }
        }
    }
    // 7. Create franchise owner (Cameron Jarvis — OWNER, sees all 11 locations)
    console.log('[seedDemo] Creating franchise accounts...');
    const ownerPassword = `demo-${crypto_1.default.randomUUID().slice(0, 8)}`;
    const ownerPasswordHash = await bcryptjs_1.default.hash(ownerPassword, 12);
    await client_1.default.user.create({
        data: {
            id: 'demo2-user-cameron',
            email: 'cameron@leesdonuts.com',
            passwordHash: ownerPasswordHash,
            name: 'Cameron Jarvis',
            role: 'OWNER',
            organizationId: org.id,
            emailVerified: true,
        },
    });
    console.log('  - Cameron Jarvis (OWNER) — cameron@leesdonuts.com');
    // 8. Create sample franchisee (MANAGER — only Granville Island)
    const managerPassword = `demo-${crypto_1.default.randomUUID().slice(0, 8)}`;
    const managerPasswordHash = await bcryptjs_1.default.hash(managerPassword, 12);
    const granvilleManager = await client_1.default.user.create({
        data: {
            id: 'demo2-user-granville-mgr',
            email: 'granville@leesdonuts.com',
            passwordHash: managerPasswordHash,
            name: 'Granville Island Manager',
            role: 'MANAGER',
            organizationId: org.id,
            emailVerified: true,
        },
    });
    // Assign to Granville Island location (index 0 → demo2-loc-00)
    await client_1.default.userLocation.create({
        data: {
            id: 'demo2-ul-granville',
            userId: granvilleManager.id,
            locationId: 'demo2-loc-00',
        },
    });
    console.log('  - Granville Island Manager (MANAGER) — granville@leesdonuts.com → Granville Island only');
    console.log(`[seedDemo] Done! ${totalOrders} orders created.`);
    return {
        organizationId: org.id,
        locationCount: locationRecords.length,
        menuItemCount,
        orderCount: totalOrders,
        demoUserEmail: DEMO_USER_EMAIL,
        demoUserPassword: tempPassword,
        ownerEmail: 'cameron@leesdonuts.com',
        ownerPassword,
        managerEmail: 'granville@leesdonuts.com',
        managerPassword,
    };
}
// ═══════════════════════════════════════════════════════════
// CLEAR FUNCTION
// ═══════════════════════════════════════════════════════════
async function clearDemoData() {
    console.log('[clearDemo] Finding demo orgs...');
    const demoOrgs = await client_1.default.organization.findMany({
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
    const locations = await client_1.default.location.findMany({
        where: { organizationId: { in: orgIds } },
        select: { id: true },
    });
    const locationIds = locations.map((l) => l.id);
    // Get order IDs for these locations first
    const orders = await client_1.default.order.findMany({
        where: { locationId: { in: locationIds } },
        select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    // Delete UserLocation assignments for users in demo orgs
    const demoUsers = await client_1.default.user.findMany({
        where: { organizationId: { in: orgIds } },
        select: { id: true },
    });
    const demoUserIds = demoUsers.map((u) => u.id);
    if (demoUserIds.length > 0) {
        await client_1.default.userLocation.deleteMany({ where: { userId: { in: demoUserIds } } });
    }
    if (locationIds.length > 0) {
        // Delete in correct order (child records first)
        if (orderIds.length > 0) {
            await client_1.default.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
        }
        await client_1.default.order.deleteMany({ where: { locationId: { in: locationIds } } });
        await client_1.default.menuItem.deleteMany({ where: { locationId: { in: locationIds } } });
        await client_1.default.weatherSnapshot.deleteMany({ where: { locationId: { in: locationIds } } });
        await client_1.default.dailySummary.deleteMany({ where: { locationId: { in: locationIds } } });
        await client_1.default.alert.deleteMany({ where: { locationId: { in: locationIds } } });
        await client_1.default.location.deleteMany({ where: { organizationId: { in: orgIds } } });
    }
    await client_1.default.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await client_1.default.organization.deleteMany({ where: { id: { in: orgIds } } });
    console.log('[clearDemo] Done');
    return { deleted: true };
}
// ═══════════════════════════════════════════════════════════
// SWAP BRAND
// ═══════════════════════════════════════════════════════════
async function swapDemoBrand(brandSlug) {
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
async function getDemoStatus() {
    const demoOrg = await client_1.default.organization.findFirst({
        where: { isDemo: true },
        include: { locations: true, users: true },
    });
    if (!demoOrg) {
        return { active: false, locationCount: 0, menuItemCount: 0, orderCount: 0 };
    }
    const locationIds = demoOrg.locations.map((l) => l.id);
    const menuItemCount = locationIds.length > 0
        ? await client_1.default.menuItem.count({ where: { locationId: { in: locationIds } } })
        : 0;
    const orderCount = locationIds.length > 0
        ? await client_1.default.order.count({ where: { locationId: { in: locationIds } } })
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
//# sourceMappingURL=demo-seed.js.map