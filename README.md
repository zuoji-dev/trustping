# TrustPing — SLA escrow, settled by consensus

**TrustPing** is trustless SLA (service-level agreement) enforcement for AI
agent services, built on [GenLayer](https://genlayer.com) and deployed on
**Studio Next** (Consensus v0.6).

Agent API providers post a **GEN bond** and list an SLA for an HTTP endpoint.
Buyers pre-pay monitoring periods into **on-chain escrow**. Anyone can trigger
a check — permissionless keeper — and **GenLayer validators independently
re-fetch the endpoint** and reach consensus on whether the service was up.
Passed periods pay the provider; failed periods refund the buyer **plus a
penalty taken from the provider's bond**.

> Why GenLayer: "my API is always online" is the provider's own claim. A
> centralized monitor just moves the trust. Here, multiple validators each
> probe the endpoint themselves, agree on the verdict through consensus, and
> the contract moves money automatically on that verdict. Disagreements force
> leader rotation; appeals use GenLayer's native v0.6 mechanism.

**Live contract (Studio Next / chain 61997):**
`0xE90E0960AB1c18DA979730f8f3c1802Ad41782CB`
→ [explorer](https://explorer-studio-dev.genlayer.com/address/0xE90E0960AB1c18DA979730f8f3c1802Ad41782CB)

---

## Verify it in 5 minutes

1. `cd frontend && npm ci && cp .env.example .env && npm run dev`
   (the contract address is already filled in).
2. Open http://localhost:3000 with MetaMask on the Studio Next network
   (RPC `https://studio-next.genlayer.com/api`, chain id `61997`).
3. The **Marketplace** tab lists live SLAs with on-chain uptime stats.
4. **Buy coverage** on a listing (e.g. 3 periods × 0.1 GEN) — the GEN goes
   into contract escrow.
5. Open the **Coverages** tab and hit **Run check**: validators fetch the
   endpoint, consensus agrees on `up` / `200xx`, and the verdict is stored
   on-chain. No checker is trusted — every verdict is a consensus decision.
6. After the last period, **Settle** splits the escrow. To see the breach
   path, buy coverage on a listing whose endpoint 404s: failed checks refund
   the buyer and fine the provider's bond.

`node scripts/smoke.mjs 0xE90E0960AB1c18DA979730f8f3c1802Ad41782CB` runs the
same flow headless with an ephemeral faucet-funded account.

## Consensus design (the part that matters)

Every check is a non-deterministic web probe (`gl.nondet.web.get`). The
leader's answer is **never trusted by itself**:

- **Leader** fetches the endpoint and derives stable decision fields:
  `up` (2xx/3xx), `status_class` (`"200xx"`, `"404xx"`, …).
- **Validator** re-runs the same probe in its own context and compares the
  derived fields. `up` and `status_class` must match exactly; raw latency is
  deliberately kept out of consensus (timing jitter across validators would
  destabilize agreement).
- **Errors are classified**: network-level probe failures raise
  `[TRANSIENT]` errors; a validator agrees with a leader error only when
  both hit transient failures. Any substantive disagreement returns `False`,
  forcing leader rotation.
- Bond **penalties** (half a period's price per failed check, capped by the
  bond) accumulate to the buyer's refund — the bond is real collateral, not
  decoration.

Contract boundary:

| Owns | Details |
|---|---|
| **Frontend** | UI, wallet, client-side latency display, tx status, caching |
| **Contract** | Escrow accounting, bond penalties, verdict storage, settlement splits |
| **Evidence source** | The endpoint itself — validators re-fetch it; nothing is trusted |

## Repo layout

```
contracts/sla_escrow.py        TrustPingEscrow intelligent contract
tests/direct/                  25 fast in-memory tests (mocked HTTP probes)
tests/integration/             Full-consensus tests on Studio Devnet
scripts/smoke.mjs              Headless end-to-end lifecycle on studio-next
frontend/                      Next.js 15 app (Transaction Kit RC2 / genlayer-js 2.0 RC)
deploy/deployScript.ts         Deployment script (genlayer-js)
```

## Development

Requires Node ≥ 18, Python ≥ 3.12.

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # Linux/macOS: .venv/bin/pip
npm ci                                            # root + frontend workspace

# Lint the contract (every check must pass; SDK validation loads the runner)
.venv/Scripts/genvm-lint check contracts/sla_escrow.py

# Fast direct tests — mocked web, leader path, escrow math
.venv/Scripts/python -m pytest tests/direct/ -v

# Full consensus integration tests on Studio Next (real validators, minutes)
.venv/Scripts/gltest tests/integration/test_sla_escrow.py -v -s

# Headless lifecycle demo (uses the studio-dev faucet to fund a temp account)
node scripts/smoke.mjs <contractAddress>

# Deploy
genlayer network set studio-dev
genlayer deploy --contract contracts/sla_escrow.py \
  --fees '{"distribution":{"leaderTimeunitsAllocation":"100","validatorTimeunitsAllocation":"200","appealRounds":"0","executionBudgetPerRound":"25000000000000000","executionConsumed":"0","totalMessageFees":"0","rotations":["3"],"maxPriceGenPerTimeUnit":"2","storageFeeMaxGasPrice":"300000000","receiptFeeMaxGasPrice":"300000000"}}' \
  --fee-value 100000000000010352
```

### v0.6 notes (fees)

Studio Next charges consensus fees. Every deploy/write carries a fee deposit
estimated from the network (`estimate_transaction_fees_for_write` /
`estimateTransactionFeesForWrite`) and the returned `distribution`,
`feeValue` **and** `messageAllocations` are submitted unchanged. Message
allocations matter for `settle`, which emits transfer child messages.
Frontend reads happen through `readContract` (no deposit); writes sign via
MetaMask through the genlayer-js provider bridge.

### Windows note

`genlayer-test <= 0.30` has a Windows-only bug: the direct runner deletes its
stdin temp file while fd 0 still references it (`PermissionError`). This repo
patches the installed `gltest/direct/loader.py` locally (deferred `atexit`
unlink). Linux/macOS are unaffected.

## Track

**Agent Tank → Agentic Commerce Infrastructure** ("SLA and uptime
enforcement — API escrow that releases against … decentralized monitoring").

## License

MIT
