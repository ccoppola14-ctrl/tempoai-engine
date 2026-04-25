"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
// SQLite with Prisma 7.5 - config loaded from prisma.config.ts
const prisma = new client_1.PrismaClient({});
exports.default = prisma;
//# sourceMappingURL=client.js.map