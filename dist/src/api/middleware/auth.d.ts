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
//# sourceMappingURL=auth.d.ts.map