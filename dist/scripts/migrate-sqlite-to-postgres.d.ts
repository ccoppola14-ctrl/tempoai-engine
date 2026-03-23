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
import 'dotenv/config';
//# sourceMappingURL=migrate-sqlite-to-postgres.d.ts.map