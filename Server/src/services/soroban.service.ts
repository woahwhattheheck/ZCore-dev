import {
  tierCodeToLabel,
  tierLabelToCode,
  TIER_CODE_TO_LABEL,
  ZCORE_INTERFACE_VERSION,
} from "../types/soroban/score-types";
import { getEffectiveContractId } from "../test-helpers/mock-soroban";

export interface OnChainScoreRecord {
  score: number;
  tier: number;
  updatedAt: number;
  validUntil?: number;
}

export function tierToCode(tier: string): number {
  return tierLabelToCode(tier);
}

export { tierCodeToLabel };

export function getInterfaceVersion(): number {
  return ZCORE_INTERFACE_VERSION;
}

export type GateTier = "A" | "B" | "C";

export interface TierGateDecision {
  allowed: boolean;
  tier: string;
  tierCode: number;
  minimumTier: GateTier;
  minimumTierCode: number;
}

export function evaluateTierGate(
  record: OnChainScoreRecord,
  minimumTier: GateTier
): TierGateDecision {
  const tier = tierCodeToLabel(record.tier);
  // Normalize unknown contract output through the canonical mapping so a
  // malformed tier fails closed as REJECTED instead of accidentally passing.
  const tierCode = tierLabelToCode(tier);
  const minimumTierCode = tierLabelToCode(minimumTier);

  return {
    allowed: tierCode >= minimumTierCode,
    tier,
    tierCode,
    minimumTier,
    minimumTierCode,
  };
}

async function getNetworkPassphrase(): Promise<string> {
  const { Networks } = await import("@stellar/stellar-sdk");
  return process.env.STELLAR_NETWORK === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;
}

function getRpcUrl(): string {
  return (
    process.env.SOROBAN_RPC_URL ??
    (process.env.STELLAR_NETWORK === "mainnet"
      ? "https://soroban.stellar.org"
      : "https://soroban-testnet.stellar.org")
  );
}

export function getContractConfig() {
  const contractId = getEffectiveContractId();
  if (!contractId) return null;

  return {
    contractId,
    network: process.env.STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet",
    rpcUrl: getRpcUrl(),
    tierEncoding: TIER_CODE_TO_LABEL,
    interfaceVersion: ZCORE_INTERFACE_VERSION,
  };
}

export async function readOnChainScore(
  walletAddress: string
): Promise<OnChainScoreRecord | null> {
  const contractId = getEffectiveContractId();
  if (!contractId) return null;

  try {
    const stellar = await import("@stellar/stellar-sdk");
    const { Account, Address, Contract, rpc, TransactionBuilder, nativeToScVal, scValToNative } =
      stellar;

    const server = new rpc.Server(getRpcUrl(), { allowHttp: true });
    const contract = new Contract(contractId);
    const sourceAccount = new Account(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "0"
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: await getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          "get_score",
          nativeToScVal(Address.fromString(walletAddress), { type: "address" })
        )
      )
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulated)) {
      console.error("Soroban simulation error:", simulated.error);
      return null;
    }

    const result = simulated.result?.retval;
    if (!result) return null;

    const native = scValToNative(result) as {
      score: number;
      tier: number;
      updated_at: number;
      valid_until?: number;
    };

    return {
      score: native.score,
      tier: native.tier,
      updatedAt: native.updated_at,
      validUntil: native.valid_until,
    };
  } catch (error) {
    console.error("Failed to read on-chain score:", error);
    return null;
  }
}

const DEFAULT_TTL_BY_TIER: Record<string, number> = {
  A: 30 * 24 * 60 * 60,
  B: 21 * 24 * 60 * 60,
  C: 14 * 24 * 60 * 60,
  REJECTED: 7 * 24 * 60 * 60,
};

function ttlForTier(tier: string): number {
  return DEFAULT_TTL_BY_TIER[tier] ?? DEFAULT_TTL_BY_TIER.REJECTED;
}

export async function attestScoreOnChain(
  walletAddress: string,
  score: number,
  tier: string
): Promise<{ txHash: string } | null> {
  const contractId = getEffectiveContractId();
  const oracleSecret = process.env.ORACLE_SECRET_KEY;

  if (!contractId || !oracleSecret) return null;

  try {
    const stellar = await import("@stellar/stellar-sdk");
    const {
      Address,
      Contract,
      Keypair,
      rpc,
      TransactionBuilder,
      nativeToScVal,
    } = stellar;

    const server = new rpc.Server(getRpcUrl(), { allowHttp: true });
    const oracle = Keypair.fromSecret(oracleSecret);
    const contract = new Contract(contractId);
    const tierCode = tierToCode(tier);
    const ttlSecs = ttlForTier(tier);

    const account = await server.getAccount(oracle.publicKey());

    let tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: await getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          "set_score",
          nativeToScVal(Address.fromString(walletAddress), { type: "address" }),
          nativeToScVal(score, { type: "u32" }),
          nativeToScVal(tierCode, { type: "u32" }),
          nativeToScVal(ttlSecs, { type: "u64" })
        )
      )
      .setTimeout(30)
      .build();

    tx = await server.prepareTransaction(tx);
    tx.sign(oracle);

    const response = await server.sendTransaction(tx);
    if (response.status === "ERROR") {
      console.error("Attestation tx error:", response);
      return null;
    }

    return { txHash: response.hash };
  } catch (error) {
    console.error("Failed to attest score on-chain:", error);
    return null;
  }
}

export async function attestScoreOnChainBatch(
  entries: Array<{ wallet: string; score: number; tier: string }>
): Promise<{ txHash: string } | null> {
  const contractId = getEffectiveContractId();
  const oracleSecret = process.env.ORACLE_SECRET_KEY;

  if (!contractId || !oracleSecret || entries.length === 0) return null;
  if (entries.length > 25) {
    console.error("Batch attestation exceeds max size of 25");
    return null;
  }

  try {
    const stellar = await import("@stellar/stellar-sdk");
    const {
      Address,
      Contract,
      Keypair,
      rpc,
      TransactionBuilder,
      nativeToScVal,
      xdr,
    } = stellar;

    const server = new rpc.Server(getRpcUrl(), { allowHttp: true });
    const oracle = Keypair.fromSecret(oracleSecret);
    const contract = new Contract(contractId);

    const wallets = entries.map((e) =>
      nativeToScVal(Address.fromString(e.wallet), { type: "address" })
    );
    const scores = entries.map((e) => nativeToScVal(e.score, { type: "u32" }));
    const tiers = entries.map((e) =>
      nativeToScVal(tierToCode(e.tier), { type: "u32" })
    );
    const ttlSecs = nativeToScVal(ttlForTier(entries[0].tier), { type: "u64" });

    const account = await server.getAccount(oracle.publicKey());

    let tx = new TransactionBuilder(account, {
      fee: String(100_000 + entries.length * 10_000),
      networkPassphrase: await getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          "set_scores_batch",
          xdr.ScVal.scvVec(wallets),
          xdr.ScVal.scvVec(scores),
          xdr.ScVal.scvVec(tiers),
          ttlSecs
        )
      )
      .setTimeout(30)
      .build();

    tx = await server.prepareTransaction(tx);
    tx.sign(oracle);

    const response = await server.sendTransaction(tx);
    if (response.status === "ERROR") {
      console.error("Batch attestation tx error:", response);
      return null;
    }

    return { txHash: response.hash };
  } catch (error) {
    console.error("Failed to batch attest scores on-chain:", error);
    return null;
  }
}
