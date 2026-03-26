import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../../db/client';

const JWT_SECRET = process.env.JWT_SECRET || 'tempoai-dev-secret';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  organizationId: string | null;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Required auth — rejects 401 if no valid JWT.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional auth — attaches user if valid JWT present, but doesn't reject.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
    };
  } catch {
    // Invalid token — proceed without user
  }
  next();
}

/**
 * Requires ADMIN role — must come after authMiddleware.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Requires ADMIN or OWNER role — blocks MANAGER.
 */
export function requireOwnerOrAbove(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'OWNER')) {
    res.status(403).json({ error: 'Owner or admin access required' });
    return;
  }
  next();
}

/**
 * Get the location IDs a MANAGER user is assigned to.
 */
export async function getUserLocationIds(userId: string): Promise<string[]> {
  const assignments = await prisma.userLocation.findMany({
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
export async function canAccessLocation(user: AuthUser, locationId: string): Promise<boolean> {
  if (user.role === 'ADMIN') return true;

  if (user.role === 'OWNER') {
    if (!user.organizationId) return false;
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { organizationId: true },
    });
    return location?.organizationId === user.organizationId;
  }

  // MANAGER
  const assignment = await prisma.userLocation.findUnique({
    where: { userId_locationId: { userId: user.id, locationId } },
  });
  return !!assignment;
}
