"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = __importDefault(require("../db/client"));
const auth_1 = require("./middleware/auth");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || 'tempoai-dev-secret';
function signToken(user) {
    return jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role, organizationId: user.organizationId }, JWT_SECRET, { expiresIn: '7d' });
}
function sanitizeUser(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        createdAt: user.createdAt,
    };
}
// ─── POST /register ──────────────────────────────────────
router.post('/register', async (req, res) => {
    try {
        const { email, password, name, organizationId } = req.body;
        if (!email || !password || !name) {
            res.status(400).json({ error: 'Email, password, and name are required' });
            return;
        }
        const existing = await client_1.default.user.findUnique({ where: { email } });
        if (existing) {
            res.status(409).json({ error: 'An account with this email already exists' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const user = await client_1.default.user.create({
            data: {
                email,
                passwordHash,
                name,
                organizationId: organizationId || null,
            },
        });
        const token = signToken(user);
        res.status(201).json({ user: sanitizeUser(user), token });
    }
    catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});
// ─── POST /login ─────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ error: 'Email and password are required' });
            return;
        }
        const user = await client_1.default.user.findUnique({ where: { email } });
        if (!user) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }
        const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!valid) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }
        const token = signToken(user);
        res.json({ user: sanitizeUser(user), token });
    }
    catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});
// ─── GET /me ─────────────────────────────────────────────
router.get('/me', auth_1.authMiddleware, async (req, res) => {
    try {
        const user = await client_1.default.user.findUnique({
            where: { id: req.user.id },
            include: { organization: true },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({
            ...sanitizeUser(user),
            organization: user.organization
                ? { id: user.organization.id, name: user.organization.name }
                : null,
        });
    }
    catch (err) {
        console.error('Me error:', err);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map