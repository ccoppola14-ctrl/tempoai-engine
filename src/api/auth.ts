import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db/client';
import { authMiddleware, requireOwnerOrAbove } from './middleware/auth';
import { sendWelcomeEmail, sendNewLeadNotification, sendPasswordResetEmail, sendVerificationEmail } from '../services/email';
import { logger } from '../utils/logger';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'tempoai-dev-secret';

function signToken(user: { id: string; email: string; role: string; organizationId: string | null }): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, organizationId: user.organizationId },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
}

function sanitizeUser(user: { id: string; email: string; name: string; role: string; organizationId: string | null; createdAt: Date }) {
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
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, organizationId } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name are required' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        organizationId: organizationId || null,
      },
    });

    const token = signToken(user);
    res.status(201).json({ user: sanitizeUser(user), token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /login ─────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken(user);
    res.json({ user: sanitizeUser(user), token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── GET /me ─────────────────────────────────────────────
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
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
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ─── Helper: generate readable temp password ────────────────────
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `tempo-${part()}-${part()}`;
}

// ─── POST /signup (get-started form → auto account creation) ────
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, restaurant, locations, pos, notes } = req.body;

    if (!name || !email || !restaurant) {
      res.status(400).json({ error: 'Name, email, and restaurant name are required' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const verificationToken = crypto.randomUUID();

    // Create organization
    const org = await prisma.organization.create({
      data: { name: restaurant },
    });

    // Create user
    const user = await prisma.user.create({
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
    sendWelcomeEmail(email, name, tempPassword, verificationToken).catch((err) =>
      logger.error('Email', 'Failed to send welcome email', err),
    );

    // Send lead notification to Chuck (non-blocking)
    sendNewLeadNotification({
      name,
      email,
      phone: phone || '',
      restaurant,
      locations: locations || '1',
      pos: pos || 'Unknown',
      notes: notes || '',
    }).catch((err) => logger.error('Email', 'Failed to send lead notification', err));

    logger.info('Signup', `New account created: ${email} (org: ${restaurant})`);
    res.status(201).json({ success: true, userId: user.id, organizationId: org.id });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// ─── POST /forgot-password ──────────────────────────────────────
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    // Always return success to prevent email enumeration
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.json({ success: true });
      return;
    }

    const resetToken = crypto.randomUUID();
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    await sendPasswordResetEmail(email, user.name, resetToken);

    logger.info('Auth', `Password reset requested for ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ─── POST /reset-password ───────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response) => {
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

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gte: new Date() },
      },
    });

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    logger.info('Auth', `Password reset completed for ${user.email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ─── POST /verify-email ─────────────────────────────────────────
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: 'Verification token is required' });
      return;
    }

    const user = await prisma.user.findFirst({
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

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationToken: null,
      },
    });

    logger.info('Auth', `Email verified for ${user.email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// ─── POST /invite ────────────────────────────────────────
router.post('/invite', authMiddleware, requireOwnerOrAbove, async (req: Request, res: Response) => {
  try {
    const { email, name, role, locationIds, organizationId: bodyOrgId } = req.body as {
      email?: string;
      name?: string;
      role?: string;
      locationIds?: string[];
      organizationId?: string;
    };

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

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    // Determine org: ADMIN can specify, OWNER uses their own
    const orgId = req.user!.role === 'ADMIN' && bodyOrgId
      ? bodyOrgId
      : req.user!.organizationId;

    if (!orgId) {
      res.status(400).json({ error: 'No organization context available' });
      return;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
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
        await prisma.userLocation.create({
          data: { userId: user.id, locationId },
        });
      }
    }

    logger.info('Auth', `User invited: ${email} (role: ${role}) by ${req.user!.email}`);
    res.status(201).json({ user: sanitizeUser(user), tempPassword });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Invite failed' });
  }
});

export default router;
