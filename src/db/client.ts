import { PrismaClient } from '@prisma/client';

// SQLite with Prisma 7.5 - config loaded from prisma.config.ts
const prisma = new PrismaClient({});

export default prisma;
