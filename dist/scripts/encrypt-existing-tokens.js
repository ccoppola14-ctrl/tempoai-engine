"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = __importDefault(require("../src/db/client"));
const encryption_1 = require("../src/utils/encryption");
async function main() {
    const locations = await client_1.default.location.findMany({
        where: {
            OR: [
                { squareAccessToken: { not: null } },
                { cloverApiToken: { not: null } },
            ],
        },
    });
    let updated = 0;
    let skipped = 0;
    for (const location of locations) {
        const updates = {};
        if (location.squareAccessToken && !(0, encryption_1.isEncrypted)(location.squareAccessToken)) {
            updates.squareAccessToken = (0, encryption_1.encrypt)(location.squareAccessToken);
            console.log(`[encrypt] location ${location.id}: squareAccessToken encrypted`);
        }
        else if (location.squareAccessToken) {
            console.log(`[skip]    location ${location.id}: squareAccessToken already encrypted`);
            skipped++;
        }
        if (location.cloverApiToken && !(0, encryption_1.isEncrypted)(location.cloverApiToken)) {
            updates.cloverApiToken = (0, encryption_1.encrypt)(location.cloverApiToken);
            console.log(`[encrypt] location ${location.id}: cloverApiToken encrypted`);
        }
        else if (location.cloverApiToken) {
            console.log(`[skip]    location ${location.id}: cloverApiToken already encrypted`);
            skipped++;
        }
        if (Object.keys(updates).length > 0) {
            await client_1.default.location.update({
                where: { id: location.id },
                data: updates,
            });
            updated++;
        }
    }
    console.log(`\nDone. ${updated} location(s) updated, ${skipped} token(s) already encrypted.`);
    await client_1.default.$disconnect();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=encrypt-existing-tokens.js.map