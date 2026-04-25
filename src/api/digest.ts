import { Router, type Request, type Response } from "express";
import { authMiddleware } from "./middleware/auth";
import { logger } from "../utils/logger";

const digestRouter = Router();

const SERVICE_DISABLED = {
  error: "Digest service temporarily disabled",
  message: "Schema migration required for digest preferences. Contact admin to enable."
};

// All digest endpoints temporarily disabled
digestRouter.get("/preferences", authMiddleware, (_req: Request, res: Response) => {
  logger.warn("Digest", "Preferences endpoint called but service disabled");
  res.status(503).json(SERVICE_DISABLED);
});

digestRouter.put("/preferences", authMiddleware, (_req: Request, res: Response) => {
  logger.warn("Digest", "Update preferences endpoint called but service disabled");
  res.status(503).json(SERVICE_DISABLED);
});

digestRouter.post("/test", authMiddleware, (_req: Request, res: Response) => {
  logger.warn("Digest", "Test endpoint called but service disabled");
  res.status(503).json(SERVICE_DISABLED);
});

digestRouter.post("/run", authMiddleware, (_req: Request, res: Response) => {
  logger.warn("Digest", "Run endpoint called but service disabled");
  res.status(503).json(SERVICE_DISABLED);
});

export default digestRouter;
