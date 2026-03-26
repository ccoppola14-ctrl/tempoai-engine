-- Kill any stuck delete queries first
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE datname='tempoai' AND state='active' AND query LIKE '%DELETE%' AND pid != pg_backend_pid();

-- Nuclear cleanup: drop all demo data regardless of FK constraints
-- Temporarily disable triggers to avoid FK cascade issues
SET session_replication_role = 'replica';

DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "locationId" LIKE 'demo%');
DELETE FROM "Order" WHERE "locationId" LIKE 'demo%';
DELETE FROM "WeatherSnapshot" WHERE "locationId" LIKE 'demo%';
DELETE FROM "DailySummary" WHERE "locationId" LIKE 'demo%';
DELETE FROM "Alert" WHERE "locationId" LIKE 'demo%';
DELETE FROM "AIPattern" WHERE "locationId" LIKE 'demo%';
DELETE FROM "Recommendation" WHERE "locationId" LIKE 'demo%';
DELETE FROM "SyncLog" WHERE "locationId" LIKE 'demo%';
DELETE FROM "StaffShift" WHERE "locationId" LIKE 'demo%';
DELETE FROM "LaborRecommendation" WHERE "locationId" LIKE 'demo%';
DELETE FROM "LaborTarget" WHERE "locationId" LIKE 'demo%';
DELETE FROM "MenuItem" WHERE "locationId" LIKE 'demo%';
DELETE FROM "Location" WHERE id LIKE 'demo%';
DELETE FROM "User" WHERE email = 'demo@usetempoai.com';
DELETE FROM "User" WHERE "organizationId" LIKE 'demo%';
DELETE FROM "Organization" WHERE id LIKE 'demo%';

-- Re-enable triggers
SET session_replication_role = 'origin';
