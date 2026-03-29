import type { Request, Response, NextFunction } from 'express';
export interface AuthUser {
    id: string;
    email: string;
    role: string;
    organizationId: string | null;
}
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
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): void;
/**
 * Optional auth — attaches user if valid JWT present, but doesn't reject.
 */
export declare function optionalAuth(req: Request, _res: Response, next: NextFunction): void;
/**
 * Requires ADMIN role — must come after authMiddleware.
 */
export declare function requireAdmin(req: Request, res: Response, next: NextFunction): void;
/**
 * Requires ADMIN or OWNER role — blocks MANAGER.
 */
export declare function requireOwnerOrAbove(req: Request, res: Response, next: NextFunction): void;
/**
 * Get the location IDs a MANAGER user is assigned to.
 */
export declare function getUserLocationIds(userId: string): Promise<string[]>;
/**
 * Check if a user can access a specific location.
 * ADMIN: always allowed.
 * OWNER: allowed if location belongs to their org.
 * MANAGER: allowed only if they have a UserLocation record.
 */
export declare function canAccessLocation(user: AuthUser, locationId: string): Promise<boolean>;
//# sourceMappingURL=auth.d.ts.map