import { describe, expect, it } from "vitest";
import { evaluateTierGate } from "../soroban.service";

describe("score gatekeeper", () => {
  it("allows an attested tier at or above the requested minimum", () => {
    expect(
      evaluateTierGate({ score: 610, tier: 2, updatedAt: 1_000 }, "B")
    ).toEqual({
      allowed: true,
      tier: "B",
      tierCode: 2,
      minimumTier: "B",
      minimumTierCode: 2,
    });

    expect(
      evaluateTierGate({ score: 790, tier: 3, updatedAt: 1_000 }, "B").allowed
    ).toBe(true);
  });

  it("rejects lower or malformed on-chain tiers", () => {
    const below = evaluateTierGate(
      { score: 420, tier: 1, updatedAt: 1_000 },
      "B"
    );
    expect(below.allowed).toBe(false);
    expect(below.tier).toBe("C");

    const malformed = evaluateTierGate(
      { score: 850, tier: 99, updatedAt: 1_000 },
      "C"
    );
    expect(malformed.allowed).toBe(false);
    expect(malformed.tier).toBe("REJECTED");
    expect(malformed.tierCode).toBe(0);
  });
});
