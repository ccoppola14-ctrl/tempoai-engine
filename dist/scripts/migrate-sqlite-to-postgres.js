"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Migrate all data from the existing SQLite database to PostgreSQL.
 *
 * Prerequisites:
 *   1. PostgreSQL is running and DATABASE_URL is set in .env
 *   2. Prisma schema has been switched to postgresql provider
 *   3. Run `npx prisma db push` against the Postgres DB first to create tables
 *
 * Usage:
 *   npx ts-node scripts/migrate-sqlite-to-postgres.ts
 */
require("dotenv/config");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const client_1 = require("@prisma/client");
const path_1 = __importDefault(require("path"));
const SQLITE_PATH = process.env.SQLITE_PATH || path_1.default.resolve(__dirname, '../prisma/dev.db');
const prisma = new client_1.PrismaClient();
async function main() {
    console.log(`Reading SQLite database from: ${SQLITE_PATH}`);
    const sqlite = new better_sqlite3_1.default(SQLITE_PATH, { readonly: true });
    function readAll(table) {
        return sqlite.prepare(`SELECT * FROM ${table}`).all();
    }
    // ─── Organizations (no foreign keys) ────────────────────
    const organizations = readAll('Organization');
    console.log(`Migrating ${organizations.length} organizations...`);
    for (const row of organizations) {
        await prisma.organization.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                name: row.name,
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.updatedAt),
            },
        });
    }
    // ─── Users (depends on Organization) ───────────────────
    const users = readAll('User');
    console.log(`Migrating ${users.length} users...`);
    for (const row of users) {
        await prisma.user.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                email: row.email,
                passwordHash: row.passwordHash,
                name: row.name,
                role: row.role,
                organizationId: row.organizationId,
                resetToken: row.resetToken,
                resetTokenExpiry: row.resetTokenExpiry ? new Date(row.resetTokenExpiry) : null,
                emailVerified: Boolean(row.emailVerified),
                verificationToken: row.verificationToken,
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.updatedAt),
            },
        });
    }
    // ─── SquareMerchant (no foreign keys) ──────────────────
    const squareMerchants = readAll('SquareMerchant');
    console.log(`Migrating ${squareMerchants.length} Square merchants...`);
    for (const row of squareMerchants) {
        await prisma.squareMerchant.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                merchantId: row.merchantId,
                accessToken: row.accessToken,
                refreshToken: row.refreshToken,
                expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
                name: row.name,
                email: row.email,
                locations: row.locations,
                plan: row.plan,
                active: Boolean(row.active),
                stripeCustomerId: row.stripeCustomerId,
                stripeSubscriptionId: row.stripeSubscriptionId,
                billingPlan: row.billingPlan,
                billingStatus: row.billingStatus,
                installedAt: new Date(row.installedAt),
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.updatedAt),
            },
        });
    }
    // ─── CloverMerchant (no foreign keys) ──────────────────
    const cloverMerchants = readAll('CloverMerchant');
    console.log(`Migrating ${cloverMerchants.length} Clover merchants...`);
    for (const row of cloverMerchants) {
        await prisma.cloverMerchant.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                merchantId: row.merchantId,
                accessToken: row.accessToken,
                name: row.name,
                plan: row.plan,
                active: Boolean(row.active),
                stripeCustomerId: row.stripeCustomerId,
                stripeSubscriptionId: row.stripeSubscriptionId,
                billingPlan: row.billingPlan,
                billingStatus: row.billingStatus,
                installedAt: new Date(row.installedAt),
                uninstalledAt: row.uninstalledAt ? new Date(row.uninstalledAt) : null,
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.updatedAt),
            },
        });
    }
    // ─── Locations (depends on Organization) ───────────────
    const locations = readAll('Location');
    console.log(`Migrating ${locations.length} locations...`);
    for (const row of locations) {
        await prisma.location.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                organizationId: row.organizationId,
                name: row.name,
                address: row.address,
                lat: row.lat,
                lng: row.lng,
                timezone: row.timezone,
                squareMerchantId: row.squareMerchantId,
                squareAccessToken: row.squareAccessToken,
                cloverMerchantId: row.cloverMerchantId,
                cloverApiToken: row.cloverApiToken,
                contactEmail: row.contactEmail,
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.updatedAt),
            },
        });
    }
    // ─── MenuItems (depends on Location) ───────────────────
    const menuItems = readAll('MenuItem');
    console.log(`Migrating ${menuItems.length} menu items...`);
    for (const row of menuItems) {
        await prisma.menuItem.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                squareItemId: row.squareItemId,
                cloverItemId: row.cloverItemId,
                name: row.name,
                category: row.category,
                price: row.price,
                active: Boolean(row.active),
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.updatedAt),
            },
        });
    }
    // ─── Orders (depends on Location) ──────────────────────
    const orders = readAll('Order');
    console.log(`Migrating ${orders.length} orders...`);
    for (const row of orders) {
        await prisma.order.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                squareOrderId: row.squareOrderId,
                cloverOrderId: row.cloverOrderId,
                timestamp: new Date(row.timestamp),
                total: row.total,
                itemCount: row.itemCount,
                createdAt: new Date(row.createdAt),
            },
        });
    }
    // ─── OrderItems (depends on Order, MenuItem) ───────────
    const orderItems = readAll('OrderItem');
    console.log(`Migrating ${orderItems.length} order items...`);
    for (const row of orderItems) {
        await prisma.orderItem.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                orderId: row.orderId,
                menuItemId: row.menuItemId,
                quantity: row.quantity,
                amount: row.amount,
            },
        });
    }
    // ─── WeatherSnapshots (depends on Location) ────────────
    const weatherSnapshots = readAll('WeatherSnapshot');
    console.log(`Migrating ${weatherSnapshots.length} weather snapshots...`);
    for (const row of weatherSnapshots) {
        await prisma.weatherSnapshot.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                timestamp: new Date(row.timestamp),
                temperature: row.temperature,
                conditions: row.conditions,
                precipitation: row.precipitation,
                humidity: row.humidity,
                windSpeed: row.windSpeed,
            },
        });
    }
    // ─── AIPatterns (depends on Location, MenuItem) ────────
    const aiPatterns = readAll('AIPattern');
    console.log(`Migrating ${aiPatterns.length} AI patterns...`);
    for (const row of aiPatterns) {
        await prisma.aIPattern.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                menuItemId: row.menuItemId,
                patternType: row.patternType,
                triggerCondition: row.triggerCondition,
                baselineSales: row.baselineSales,
                conditionSales: row.conditionSales,
                liftPercent: row.liftPercent,
                confidence: row.confidence,
                dataPoints: row.dataPoints,
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.updatedAt),
            },
        });
    }
    // ─── Recommendations (depends on Location, MenuItem) ───
    const recommendations = readAll('Recommendation');
    console.log(`Migrating ${recommendations.length} recommendations...`);
    for (const row of recommendations) {
        await prisma.recommendation.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                menuItemId: row.menuItemId,
                type: row.type,
                triggerType: row.triggerType,
                triggerCondition: row.triggerCondition,
                currentlyActive: Boolean(row.currentlyActive),
                expectedLift: row.expectedLift,
                confidence: row.confidence,
                dataPoints: row.dataPoints,
                message: row.message,
                channels: row.channels,
                status: row.status,
                appliedAt: row.appliedAt ? new Date(row.appliedAt) : null,
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.updatedAt),
            },
        });
    }
    // ─── SyncLogs (depends on Location) ────────────────────
    const syncLogs = readAll('SyncLog');
    console.log(`Migrating ${syncLogs.length} sync logs...`);
    for (const row of syncLogs) {
        await prisma.syncLog.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                source: row.source,
                status: row.status,
                recordsProcessed: row.recordsProcessed,
                error: row.error,
                timestamp: new Date(row.timestamp),
            },
        });
    }
    // ─── Alerts (depends on Location) ──────────────────────
    const alerts = readAll('Alert');
    console.log(`Migrating ${alerts.length} alerts...`);
    for (const row of alerts) {
        await prisma.alert.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                type: row.type,
                severity: row.severity,
                title: row.title,
                message: row.message,
                data: row.data,
                createdAt: new Date(row.createdAt),
                acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt) : null,
            },
        });
    }
    // ─── DailySummaries (depends on Location) ──────────────
    const dailySummaries = readAll('DailySummary');
    console.log(`Migrating ${dailySummaries.length} daily summaries...`);
    for (const row of dailySummaries) {
        await prisma.dailySummary.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                date: row.date,
                totalSales: row.totalSales,
                orderCount: row.orderCount,
                topItems: row.topItems,
                laborCostPct: row.laborCostPct,
                prevWeekSales: row.prevWeekSales,
                prevWeekOrders: row.prevWeekOrders,
                changePercent: row.changePercent,
                weatherNote: row.weatherNote,
                summary: row.summary,
                createdAt: new Date(row.createdAt),
            },
        });
    }
    // ─── Forecasts ─────────────────────────────────────────
    const forecasts = readAll('Forecast');
    console.log(`Migrating ${forecasts.length} forecasts...`);
    for (const row of forecasts) {
        await prisma.forecast.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                date: row.date,
                predictedSales: row.predictedSales,
                predictedOrders: row.predictedOrders,
                confidence: row.confidence,
                factors: row.factors,
                createdAt: new Date(row.createdAt),
            },
        });
    }
    // ─── IngredientCosts ───────────────────────────────────
    const ingredientCosts = readAll('IngredientCost');
    console.log(`Migrating ${ingredientCosts.length} ingredient costs...`);
    for (const row of ingredientCosts) {
        await prisma.ingredientCost.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                menuItemId: row.menuItemId,
                ingredientName: row.ingredientName,
                cost: row.cost,
                unit: row.unit,
                quantity: row.quantity,
                updatedAt: new Date(row.updatedAt),
            },
        });
    }
    // ─── Reviews ───────────────────────────────────────────
    const reviews = readAll('Review');
    console.log(`Migrating ${reviews.length} reviews...`);
    for (const row of reviews) {
        await prisma.review.upsert({
            where: { id: row.id },
            update: {},
            create: {
                id: row.id,
                locationId: row.locationId,
                platform: row.platform,
                rating: row.rating,
                reviewerName: row.reviewerName,
                reviewText: row.reviewText,
                responseText: row.responseText,
                respondedAt: row.respondedAt ? new Date(row.respondedAt) : null,
                createdAt: new Date(row.createdAt),
            },
        });
    }
    sqlite.close();
    await prisma.$disconnect();
    console.log('\nMigration complete!');
}
main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
//# sourceMappingURL=migrate-sqlite-to-postgres.js.map