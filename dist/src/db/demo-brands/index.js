"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBrandConfig = getBrandConfig;
exports.listBrands = listBrands;
const lees_donuts_1 = __importDefault(require("./lees-donuts"));
const brandRegistry = {
    'lees-donuts': lees_donuts_1.default,
};
function getBrandConfig(brandSlug) {
    return brandRegistry[brandSlug] ?? null;
}
function listBrands() {
    return Object.keys(brandRegistry);
}
//# sourceMappingURL=index.js.map