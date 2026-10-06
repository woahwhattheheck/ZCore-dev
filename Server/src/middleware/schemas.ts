import { z } from "zod";

const StellarWalletSchema = z
  .string()
  .length(56, "Stellar wallet address must be 56 characters")
  .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar wallet address format");

export const RegisterSchema = z.object({
  walletAddress: StellarWalletSchema,
});

export const SignedAuthSchema = z.object({
  walletAddress: StellarWalletSchema,
  message: z.string().min(20, "Invalid challenge message"),
  signature: z.string().min(10, "Invalid signature"),
});

export const ChallengeRequestSchema = z.object({
  walletAddress: StellarWalletSchema,
});

export const LoginSchema = z.object({
  walletAddress: StellarWalletSchema,
});

export const ScoringRequestSchema = z.object({
  walletAddress: StellarWalletSchema,
  lenderId: z.string().uuid("Invalid lender ID"),
  requestedAmount: z.number().positive("Amount must be positive"),
});

export const PaymentReportSchema = z.object({
  apiKey: z.string().min(10, "Invalid API key"),
  walletAddress: StellarWalletSchema,
  amount: z.number().positive("Amount must be positive"),
  status: z.enum(["paid", "defaulted"]),
  paymentDate: z.string().datetime(),
  requestId: z.string().uuid().optional(),
});

export const ProfileDefinitionSchema = z.object({
  apiKey: z.string().min(10, "Invalid API key"),
  profiles: z.array(
    z.object({
      tier: z.enum(["A", "B", "C"]),
      minScore: z.number().min(0).max(850),
      maxAmount: z.number().positive(),
      interestRate: z.number().min(0).max(100),
    })
  ),
});

export const WalletParamSchema = z.object({
  wallet: StellarWalletSchema,
});

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ScoreHistoryQuerySchema = PaginationQuerySchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const TierGateQuerySchema = z.object({
  minTier: z.enum(["A", "B", "C"]).default("B"),
});

export const CreditEventSchema = z.object({
  apiKey: z.string().min(10, "Invalid API key"),
  eventType: z.enum([
    "escrow_completed",
    "loan_repaid",
    "tanda_round_paid",
    "tanda_cycle_completed",
  ]),
  walletAddress: StellarWalletSchema,
  amount: z.number().positive("Amount must be positive"),
  currency: z.string().default("USDC"),
  txHash: z.string().min(10, "Invalid transaction hash"),
  counterpartyWallet: StellarWalletSchema.optional(),
  timestamp: z.string().datetime(),
});

export const PlatformRegisterSchema = z.object({
  adminKey: z.string().min(8, "Invalid admin key"),
  platformId: z.string().min(3, "Platform ID must be at least 3 characters"),
  name: z.string().min(2, "Platform name required"),
  webhookUrl: z.string().url().optional(),
});
