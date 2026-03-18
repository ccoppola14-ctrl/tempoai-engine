#!/bin/bash
set -e

# Generate Prisma client
npx prisma generate

# Push schema to DB
npx prisma db push --skip-generate

# Check if we have data
COUNT=$(node -e "
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaClient } = require('@prisma/client');
const adapter = new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' });
const prisma = new PrismaClient({ adapter });
prisma.order.count().then(c => { console.log(c); prisma.\$disconnect(); });
")

if [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
  echo "No data found, seeding..."
  node scripts/seed-local-orders.js
fi

# Start the server
node dist/index.js
