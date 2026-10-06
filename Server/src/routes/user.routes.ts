import { Router } from "express";
import {
  getProfile,
  getScore,
  getCreditHistory,
  getScoreHistory,
  getUserBreakdown,
  requestScoring,
} from "../controllers/user.controller";
import {
  attestScore,
  getOnChainScore,
  getTierGate,
} from "../controllers/contracts.controller";
import { validate, validateParams, validateQuery } from "../middleware/validation.middleware";
import { validateLenderKey } from "../middleware/lender-auth.middleware";
import { requireWalletSession } from "../middleware/session.middleware";
import {
  createRateLimiter,
  headerApiKey,
} from "../middleware/rate-limit.middleware";
import {
  ScoringRequestSchema,
  SignedAuthSchema,
  WalletParamSchema,
  PaginationQuerySchema,
  ScoreHistoryQuerySchema,
  TierGateQuerySchema,
} from "../middleware/schemas";

const router = Router();

const lenderScoreRateLimit = createRateLimiter({
  name: "lender_score",
  limit: 60,
  windowSec: 60,
  keyGenerator: headerApiKey,
});

router.post("/request", validate(ScoringRequestSchema), requestScoring);
router.get("/:wallet/on-chain", validateParams(WalletParamSchema), getOnChainScore);
router.get(
  "/:wallet/tier",
  validateParams(WalletParamSchema),
  validateQuery(TierGateQuerySchema),
  getTierGate
);
router.post(
  "/:wallet/attest",
  validateParams(WalletParamSchema),
  requireWalletSession,
  validate(SignedAuthSchema),
  attestScore
);
router.get(
  "/:wallet/score",
  validateParams(WalletParamSchema),
  lenderScoreRateLimit,
  validateLenderKey,
  getScore
);
router.get(
  "/:wallet/breakdown",
  validateParams(WalletParamSchema),
  requireWalletSession,
  getUserBreakdown
);
router.get(
  "/:wallet/history",
  validateParams(WalletParamSchema),
  validateQuery(PaginationQuerySchema),
  requireWalletSession,
  getCreditHistory
);
router.get(
  "/:wallet/score-history",
  validateParams(WalletParamSchema),
  validateQuery(ScoreHistoryQuerySchema),
  requireWalletSession,
  getScoreHistory
);
router.get(
  "/:wallet/profile",
  validateParams(WalletParamSchema),
  requireWalletSession,
  getProfile
);

export default router;
