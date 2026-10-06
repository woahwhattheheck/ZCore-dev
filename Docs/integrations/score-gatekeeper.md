# Score Gatekeeper precheck

Issue #28 uses the server-side precheck path until the score-registry deployment tracked by #16 is available. The gate reads the existing Soroban score record and compares its canonical tier code; it does not recalculate credit scores or submit a lending transaction.

## Endpoint

```http
GET /api/user/{wallet}/tier?minTier=B
```

`minTier` accepts `A`, `B`, or `C` and defaults to `B`. The tier ordering is the existing score-registry encoding:

| Code | Tier |
| ---: | --- |
| 0 | REJECTED |
| 1 | C |
| 2 | B |
| 3 | A |

A wallet at or above the requested tier receives HTTP 200 with `allowed: true`.

A wallet below the requested tier receives HTTP 403 with `allowed: false` and a clear minimum-tier error. Unknown contract tier values normalize to `REJECTED` and fail closed.

If the score registry is not configured, the RPC read fails, or no attested score is available, the endpoint returns HTTP 503. Protocol consumers should treat that result as not eligible rather than falling back to an off-chain score.

## Example

```bash
curl "http://localhost:3000/api/user/G.../tier?minTier=B"
```

Allowed response:

```json
{
  "success": true,
  "data": {
    "walletAddress": "G...",
    "score": 610,
    "allowed": true,
    "tier": "B",
    "tierCode": 2,
    "minimumTier": "B",
    "minimumTierCode": 2,
    "updatedAt": 1791267000,
    "validUntil": 1791871800,
    "source": "soroban"
  }
}
```

Below-threshold response uses the same data shape with HTTP 403 and `success: false`.

## Mock score-registry

For CI or local integration work, deploy the test-only contract in `Contracts/mock-score-registry/` and point the server test process at that contract with the existing `withMockContractId(id)` helper. The endpoint calls `readOnChainScore`, so it follows the same effective contract ID path as other score-registry reads.

The mock is test-only. Do not deploy it to mainnet.

## Lending integration

A lending adapter can call the precheck immediately before constructing or submitting a gated transaction:

1. request the wallet tier with the protocol's minimum;
2. continue only on HTTP 200 with `allowed: true`;
3. stop on HTTP 403;
4. fail closed on HTTP 503 or other read errors.

This keeps scoring authority in the existing score registry and avoids duplicating ZCore scoring logic in each protocol.
