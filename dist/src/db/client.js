"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const adapter_better_sqlite3_1 = require("@prisma/adapter-better-sqlite3");
const dbPath = (process.env.DATABASE_URL || 'file:./prisma/dev.db').replace('file:', '');
const adapter = new adapter_better_sqlite3_1.PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new client_1.PrismaClient({ adapter });
exports.default = prisma;
//# sourceMappingURL=client.js.map