"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.optionalAuth = optionalAuth;
exports.requireAdmin = requireAdmin;
exports.requireOwnerOrAbove = requireOwnerOrAbove;
exports.getUserLocationIds = getUserLocationIds;
exports.canAccessLocation = canAccessLocation;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = __importDefault(require("../../db/client"));
const JWT_SECRET = process.env.JWT_SECRET || 'tempoai-dev-secret';
/**
 * Required auth — rejects 401 if no valid JWT.
 */
function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid authorization header' });
        return;
    }
    const token = header.slice(7);
    try {
        const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = {
            id: payload.id,
            email: payload.email,
            role: payload.role,
            organizationId: payload.organizationId,
        };
        next();
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
/**
 * Optional auth — attaches user if valid JWT present, but doesn't reject.
 */
function optionalAuth(req, _res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        next();
        return;
    }
    const token = header.slice(7);
    try {
        const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = {
            id: payload.id,
            email: payload.email,
            role: payload.role,
            organizationId: payload.organizationId,
        };
    }
    catch {
        // Invalid token — proceed without user
    }
    next();
}
/**
 * Requires ADMIN role — must come after authMiddleware.
 */
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'ADMIN') {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }
    next();
}
/**
 * Requires ADMIN or OWNER role — blocks MANAGER.
 */
function requireOwnerOrAbove(req, res, next) {
    if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'OWNER')) {
        res.status(403).json({ error: 'Owner or admin access required' });
        return;
    }
    next();
}
/**
 * Get the location IDs a MANAGER user is assigned to.
 */
async function getUserLocationIds(userId) {
    const assignments = await client_1.default.userLocation.findMany({
        where: { userId },
        select: { locationId: true },
    });
    return assignments.map((a) => a.locationId);
}
/**
 * Check if a user can access a specific location.
 * ADMIN: always allowed.
 * OWNER: allowed if location belongs to their org.
 * MANAGER: allowed only if they have a UserLocation record.
 */
async function canAccessLocation(user, locationId) {
    if (user.role === 'ADMIN')
        return true;
    if (user.role === 'OWNER') {
        if (!user.organizationId)
            return false;
        const location = await client_1.default.location.findUnique({
            where: { id: locationId },
            select: { organizationId: true },
        });
        return location?.organizationId === user.organizationId;
    }
    // MANAGER
    const assignment = await client_1.default.userLocation.findUnique({
        where: { userId_locationId: { userId: user.id, locationId } },
    });
    return !!assignment;
}
//# sourceMappingURL=auth.js.map