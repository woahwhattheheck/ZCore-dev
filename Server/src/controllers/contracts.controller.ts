import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/database";
import {
  attestScoreOnChain,
  evaluateTierGate,
  getContractConfig,
  readOnChainScore,
  tierCodeToLabel,
  type GateTier,
} from "../services/soroban.service";
import { verifyWalletSignature } from "../services/auth-challenge.service";

/**
 * @swagger
 * /api/contracts/config:
 *   get:
 *     tags: [Contracts]
 *     summary: Get Soroban score registry configuration
 */
export const getContractsConfig = (_req: Request, res: Response) => {
  const config = getContractConfig();

  if (!config) {
    return res.status(200).json({
      success: true,
      data: { enabled: false },
    });
  }

  return res.status(200).json({
    success: true,
    data: { enabled: true, ...config },
  });
};

/**
 * @swagger
 * /api/user/{wallet}/on-chain:
 *   get:
 *     tags: [Contracts]
 *     summary: Read attested score from Soroban contract
 */
export const getOnChainScore = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { wallet } = req.params;
    const record = await readOnChainScore(wallet);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: "On-chain score not available or contract not configured",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        walletAddress: wallet,
        score: record.score,
        tier: tierCodeToLabel(record.tier),
        tierCode: record.tier,
        updatedAt: record.updatedAt,
        validUntil: record.validUntil ?? null,
        source: "soroban",
      },
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @swagger
 * /api/user/{wallet}/tier:
 *   get:
 *     tags: [Contracts]
 *     summary: Check whether an attested wallet meets a minimum protocol tier
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: minTier
 *         required: false
 *         schema:
 *           type: string
 *           enum: [A, B, C]
 *           default: B
 *     responses:
 *       200:
 *         description: Wallet meets the requested minimum tier
 *       403:
 *         description: Wallet is below the requested minimum tier
 *       503:
 *         description: On-chain score is unavailable; gate fails closed
 */
export const getTierGate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { wallet } = req.params;
    const minimumTier = (req.query.minTier ?? "B") as GateTier;
    const record = await readOnChainScore(wallet);

    if (!record) {
      return res.status(503).json({
        success: false,
        error: "On-chain tier unavailable; gate fails closed",
      });
    }

    const decision = evaluateTierGate(record, minimumTier);
    const data = {
      walletAddress: wallet,
      score: record.score,
      ...decision,
      updatedAt: record.updatedAt,
      validUntil: record.validUntil ?? null,
      source: "soroban",
    };

    if (!decision.allowed) {
      return res.status(403).json({
        success: false,
        error: `Minimum tier ${minimumTier} required`,
        data,
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

/**
 * @swagger
 * /api/user/{wallet}/attest:
 *   post:
 *     tags: [Contracts]
 *     summary: Publish current score to Soroban registry (requires wallet signature)
 */
export const attestScore = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { wallet } = req.params;
    const { walletAddress, message, signature } = req.body as {
      walletAddress: string;
      message: string;
      signature: string;
    };

    if (walletAddress !== wallet) {
      return res.status(400).json({
        success: false,
        error: "Wallet address mismatch",
      });
    }

    if (!(await verifyWalletSignature(wallet, message, signature))) {
      return res.status(401).json({
        success: false,
        error: "Invalid wallet signature",
      });
    }

    const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const result = await attestScoreOnChain(wallet, user.score, user.profileTier);

    if (!result) {
      res.setHeader("Retry-After", "300");
      return res.status(503).json({
        success: false,
        error:
          "On-chain attestation unavailable. Configure SCORE_REGISTRY_CONTRACT_ID and ORACLE_SECRET_KEY.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        txHash: result.txHash,
        score: user.score,
        tier: user.profileTier,
      },
    });
  } catch (error) {
    return next(error);
  }
};
