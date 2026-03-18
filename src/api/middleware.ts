import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  logger.info('API', `${req.method} ${req.path}`);
  next();
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('API', 'Unhandled error', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
}

export function demoGuard(_req: Request, res: Response, next: NextFunction): void {
  if (process.env.DEMO_MODE === 'true') {
    // In demo mode, skip auth checks
    next();
    return;
  }
  // In production, you'd check auth tokens here
  next();
}
