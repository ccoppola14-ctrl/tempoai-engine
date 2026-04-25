import { PrismaClient } from '@prisma/client';

// SQLite doesn't require an adapter - Prisma connects directly
const prisma = new PrismaClient();

export default prisma;
