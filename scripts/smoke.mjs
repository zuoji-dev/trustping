/**
 * End-to-end smoke test for TrustPingEscrow on GenLayer Studio Devnet.
 *
 * Uses an ephemeral account funded through the studio dev faucet
 * (sim_fundAccount). Exercises the full lifecycle against the REAL
 * network: create_listing (bonded) -> buy_coverage (escrowed) ->
 * run_check (real validator consensus probe) -> settle (escrow split).
 *
 * Usage: node scripts/smoke.mjs [contractAddress]
 * Env: TP_PRIVATE_KEY (optional — otherwise a fresh account is created),
 *      TP_RPC (optional — defaults to the studio-dev RPC),
 *      TP_ENDPOINT (optional — defaults to https://example.com)
 */

import {
  createClient,
  createAccount,
  isSuccessful,
} from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const RPC = process.env.TP_RPC ?? "https://studio-next.genlayer.com/api";
const EXPLORER = "https://explorer-studio-dev.genlayer.com";
const CONTRACT = process.argv[2] ?? process.env.TP_CONTRACT_ADDRESS;
const ENDPOINT = process.env.TP_ENDPOINT ?? "https://example.com";

const GEN = 10n ** 18n;
const BOND = 5n * GEN;
const PRICE = 10n ** 17n; // 0.1 GEN per period
const PERIODS = 3;

const FEES = {
  distribution: {
    leaderTimeunitsAllocation: "100",
    validatorTimeunitsAllocation: "200",
    appealRounds: "0",
    executionBudgetPerRound: "25000000000000000",
    executionConsumed: "0",
    totalMessageFees: "0",
    rotations: ["3"],
    maxPriceGenPerTimeUnit: "2",
    storageFeeMaxGasPrice: "300000000",
    receiptFeeMaxGasPrice: "300000000",
  },
};

const log = (...a) => console.log(...a);
const j = (o) => JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v));
const short = (s) => `${s.slice(0, 10)}…${s.slice(-6)}`;

async function fund(address, amount) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sim_fundAccount",
      params: [address, `0x${amount.toString(16)}`],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`faucet: ${json.error.message}`);
  return json.result;
}

function estimateFees(client) {
  if (typeof client.estimateTransactionFeesForWrite === "function") {
    return (w) => client.estimateTransactionFeesForWrite(w);
  }
  return (w) => client.estimateTransactionFees(w);
}

async function write(client, fees, { address, functionName, args, value }) {
  const estimate = await fees({ address, functionName, args, value });
  const hash = await client.writeContract({
    address,
    functionName,
    args,
    ...(value !== undefined ? { value } : {}),
    fees: {
      distribution: estimate.distribution,
      feeValue: estimate.feeValue,
      ...(estimate.messageAllocations?.length
        ? { messageAllocations: estimate.messageAllocations }
        : {}),
    },
  });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    waitUntil: "decided",
    retries: 100,
  });
  return { hash, receipt };
}

function assertOk(receipt, label) {
  if (!isSuccessful(receipt)) {
    throw new Error(
      `${label} not successful: status=${receipt?.statusName ?? receipt?.status} exec=${receipt?.txExecutionResultName ?? receipt?.txExecutionResult} :: ${j(receipt).slice(0, 900)}`,
    );
  }
  log(`  ✓ ${label} (${receipt?.statusName ?? receipt?.status}, ${receipt?.txExecutionResultName ?? "?"})`);
}

async function read(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args });
}

async function main() {
  if (!CONTRACT) {
    throw new Error(
      "Usage: node scripts/smoke.mjs <contractAddress> (or set TP_CONTRACT_ADDRESS)",
    );
  }

  const account = process.env.TP_PRIVATE_KEY
    ? createAccount(process.env.TP_PRIVATE_KEY)
    : createAccount();
  log(`account: ${account.address}`);

  await fund(account.address, 50n * GEN);
  log("funded 50 GEN from the studio-dev faucet");

  const client = createClient({ chain: studioDevnet, account });
  const fees = estimateFees(client);

  // 1. Provider creates a bonded SLA listing
  let { hash: h1, receipt: r1 } = await write(client, fees, {
    address: CONTRACT,
    functionName: "create_listing",
    args: ["Example.com API", ENDPOINT, PRICE],
    value: BOND,
  });
  log(`  create_listing tx: ${EXPLORER}/tx/${h1}`);
  assertOk(r1, "create_listing");

  const listings = await read(client, CONTRACT, "get_listings");
  const listingId = Object.keys(listings).at(-1);
  log(`  listing ${listingId}:`, j(listings[listingId]));

  // 2. Buyer purchases coverage (escrowed)
  const { hash: h2, receipt: r2 } = await write(client, fees, {
    address: CONTRACT,
    functionName: "buy_coverage",
    args: [listingId, PERIODS],
    value: PRICE * BigInt(PERIODS),
  });
  log(`  buy_coverage tx: ${EXPLORER}/tx/${h2}`);
  assertOk(r2, "buy_coverage");

  const coverages = await read(client, CONTRACT, "get_coverages");
  const coverageId = Object.keys(coverages).at(-1);
  log(`  coverage ${coverageId}:`, j(coverages[coverageId]));

  // 3. Permissionless keeper runs a consensus probe against the endpoint
  log(`  probing ${ENDPOINT} through validator consensus …`);
  const { hash: h3, receipt: r3 } = await write(client, fees, {
    address: CONTRACT,
    functionName: "run_check",
    args: [coverageId],
  });
  log(`  run_check tx: ${EXPLORER}/tx/${h3}`);
  assertOk(r3, "run_check");

  const checks = await read(client, CONTRACT, "get_checks", [coverageId]);
  log(`  checks:`, j(checks));

  // 4. Settle: escrow split by consensus results
  for (let i = checks.length; i < PERIODS; i++) {
    await write(client, fees, { address: CONTRACT, functionName: "run_check", args: [coverageId] });
  }
  const { hash: h4, receipt: r4 } = await write(client, fees, {
    address: CONTRACT,
    functionName: "settle",
    args: [coverageId],
  });
  log(`  settle tx: ${EXPLORER}/tx/${h4}`);
  assertOk(r4, "settle");

  const finalCoverage = await read(client, CONTRACT, "get_coverage", [coverageId]);
  const stats = await read(client, CONTRACT, "get_stats");
  log("coverage after settle:", j(finalCoverage));
  log("stats:", j(stats));
  log(`\nDone. Contract ${short(CONTRACT)} at ${EXPLORER}/address/${CONTRACT}`);
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e?.message ?? e);
  process.exit(1);
});
