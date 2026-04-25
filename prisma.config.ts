import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
  },
  // PostgreSQL - adapter configured in src/db/client.ts
  datasource: {
    url: env('DATABASE_URL'),
  },
});
