import type { Request, Response, NextFunction } from 'express';
export declare function requestLogger(req: Request, _res: Response, next: NextFunction): void;
export declare function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void;
export declare function demoGuard(_req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=middleware.d.ts.map