"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = __importDefault(require("../db/client"));
const auth_1 = require("./middleware/auth");
const email_1 = require("../services/email");
const logger_1 = require("../utils/logger");
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
// ─── Helper: generate readable temp password ────────────────────
function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const part = () => Array.from({ length: 4 }, () => chars[crypto_1.default.randomInt(chars.length)]).join('');
    return `tempo-${part()}-${part()}`;
}
// ─── POST /signup (get-started form → auto account creation) ────
router.post('/signup', async (req, res) => {
    try {
        const { name, email, phone, restaurant, locations, pos, notes } = req.body;
        if (!name || !email || !restaurant) {
            res.status(400).json({ error: 'Name, email, and restaurant name are required' });
            return;
        }
        const existing = await client_1.default.user.findUnique({ where: { email } });
        if (existing) {
            res.status(409).json({ error: 'An account with this email already exists' });
            return;
        }
        const tempPassword = generateTempPassword();
        const passwordHash = await bcryptjs_1.default.hash(tempPassword, 12);
        const verificationToken = crypto_1.default.randomUUID();
        // Create organization
        const org = await client_1.default.organization.create({
            data: { name: restaurant },
        });
        // Create user
        const user = await client_1.default.user.create({
            data: {
                email,
                passwordHash,
                name,
                organizationId: org.id,
                emailVerified: false,
                verificationToken,
            },
        });
        // Send welcome email (non-blocking)
        (0, email_1.sendWelcomeEmail)(email, name, tempPassword, verificationToken).catch((err) => logger_1.logger.error('Email', 'Failed to send welcome email', err));
        // Send lead notification to Chuck (non-blocking)
        (0, email_1.sendNewLeadNotification)({
            name,
            email,
            phone: phone || '',
            restaurant,
            locations: locations || '1',
            pos: pos || 'Unknown',
            notes: notes || '',
        }).catch((err) => logger_1.logger.error('Email', 'Failed to send lead notification', err));
        logger_1.logger.info('Signup', `New account created: ${email} (org: ${restaurant})`);
        res.status(201).json({ success: true, userId: user.id, organizationId: org.id });
    }
    catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Signup failed' });
    }
});
// ─── POST /forgot-password ──────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            res.status(400).json({ error: 'Email is required' });
            return;
        }
        // Always return success to prevent email enumeration
        const user = await client_1.default.user.findUnique({ where: { email } });
        if (!user) {
            res.json({ success: true });
            return;
        }
        const resetToken = crypto_1.default.randomUUID();
        const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await client_1.default.user.update({
            where: { id: user.id },
            data: { resetToken, resetTokenExpiry },
        });
        await (0, email_1.sendPasswordResetEmail)(email, user.name, resetToken);
        logger_1.logger.info('Auth', `Password reset requested for ${email}`);
        res.json({ success: true });
    }
    catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Failed to process request' });
    }
});
// ─── POST /reset-password ───────────────────────────────────────
router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            res.status(400).json({ error: 'Token and password are required' });
            return;
        }
        if (password.length < 8) {
            res.status(400).json({ error: 'Password must be at least 8 characters' });
            return;
        }
        const user = await client_1.default.user.findFirst({
            where: {
                resetToken: token,
                resetTokenExpiry: { gte: new Date() },
            },
        });
        if (!user) {
            res.status(400).json({ error: 'Invalid or expired reset token' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        await client_1.default.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetToken: null,
                resetTokenExpiry: null,
            },
        });
        logger_1.logger.info('Auth', `Password reset completed for ${user.email}`);
        res.json({ success: true });
    }
    catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});
// ─── POST /verify-email ─────────────────────────────────────────
router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            res.status(400).json({ error: 'Verification token is required' });
            return;
        }
        const user = await client_1.default.user.findFirst({
            where: { verificationToken: token },
        });
        if (!user) {
            res.status(400).json({ error: 'Invalid verification token' });
            return;
        }
        if (user.emailVerified) {
            res.json({ success: true, alreadyVerified: true });
            return;
        }
        await client_1.default.user.update({
            where: { id: user.id },
            data: {
                emailVerified: true,
                verificationToken: null,
            },
        });
        logger_1.logger.info('Auth', `Email verified for ${user.email}`);
        res.json({ success: true });
    }
    catch (err) {
        console.error('Verify email error:', err);
        res.status(500).json({ error: 'Failed to verify email' });
    }
});
// ─── POST /invite ────────────────────────────────────────
router.post('/invite', auth_1.authMiddleware, auth_1.requireOwnerOrAbove, async (req, res) => {
    try {
        const { email, name, role, locationIds, organizationId: bodyOrgId } = req.body;
        if (!email || !name || !role) {
            res.status(400).json({ error: 'email, name, and role are required' });
            return;
        }
        if (role !== 'OWNER' && role !== 'MANAGER') {
            res.status(400).json({ error: 'role must be OWNER or MANAGER' });
            return;
        }
        if (role === 'MANAGER' && (!locationIds || locationIds.length === 0)) {
            res.status(400).json({ error: 'locationIds is required for MANAGER role' });
            return;
        }
        const existing = await client_1.default.user.findUnique({ where: { email } });
        if (existing) {
            res.status(409).json({ error: 'An account with this email already exists' });
            return;
        }
        // Determine org: ADMIN can specify, OWNER uses their own
        const orgId = req.user.role === 'ADMIN' && bodyOrgId
            ? bodyOrgId
            : req.user.organizationId;
        if (!orgId) {
            res.status(400).json({ error: 'No organization context available' });
            return;
        }
        const tempPassword = generateTempPassword();
        const passwordHash = await bcryptjs_1.default.hash(tempPassword, 12);
        const user = await client_1.default.user.create({
            data: {
                email,
                passwordHash,
                name,
                role,
                organizationId: orgId,
                emailVerified: true,
            },
        });
        // Create UserLocation assignments for MANAGER
        if (role === 'MANAGER' && locationIds) {
            for (const locationId of locationIds) {
                await client_1.default.userLocation.create({
                    data: { userId: user.id, locationId },
                });
            }
        }
        logger_1.logger.info('Auth', `User invited: ${email} (role: ${role}) by ${req.user.email}`);
        res.status(201).json({ user: sanitizeUser(user), tempPassword });
    }
    catch (err) {
        console.error('Invite error:', err);
        res.status(500).json({ error: 'Invite failed' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map