"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("./middleware/auth");
const logger_1 = require("../utils/logger");
const digestRouter = (0, express_1.Router)();
const SERVICE_DISABLED = {
    error: "Digest service temporarily disabled",
    message: "Schema migration required for digest preferences. Contact admin to enable."
};
// All digest endpoints temporarily disabled
digestRouter.get("/preferences", auth_1.authMiddleware, (_req, res) => {
    logger_1.logger.warn("Digest", "Preferences endpoint called but service disabled");
    res.status(503).json(SERVICE_DISABLED);
});
digestRouter.put("/preferences", auth_1.authMiddleware, (_req, res) => {
    logger_1.logger.warn("Digest", "Update preferences endpoint called but service disabled");
    res.status(503).json(SERVICE_DISABLED);
});
digestRouter.post("/test", auth_1.authMiddleware, (_req, res) => {
    logger_1.logger.warn("Digest", "Test endpoint called but service disabled");
    res.status(503).json(SERVICE_DISABLED);
});
digestRouter.post("/run", auth_1.authMiddleware, (_req, res) => {
    logger_1.logger.warn("Digest", "Run endpoint called but service disabled");
    res.status(503).json(SERVICE_DISABLED);
});
exports.default = digestRouter;
//# sourceMappingURL=digest.js.map