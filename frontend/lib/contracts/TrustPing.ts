"use client";

import { createClient, isSuccessful } from "genlayer-js";
import { GENLAYER_CHAIN, getContractAddress } from "../genlayer/client";
import type { CheckResult, Coverage, Listing, TrustPingStats } from "./types";

const GEN = 10n ** 18n;

/** Format atto GEN as a human-readable GEN amount. */
export function formatGen(atto: string | bigint | number, decimals = 2): string {
  const value = BigInt(atto);
  const whole = value / GEN;
  const frac = (value % GEN).toString().padStart(18, "0").slice(0, decimals);
  return `${whole.toString()}${decimals > 0 && frac ? `.${frac}` : ""}`;
}

/** Parse a GEN amount string (e.g. "1.5") into atto GEN. */
export function parseGen(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error(`Invalid GEN amount: ${amount}`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  return BigInt(whole) * GEN + BigInt((frac + "000000").slice(0, 6)) * 10n ** 12n;
}

export interface TxResult {
  hash: string;
  explorerUrl: string;
}

/**
 * TrustPing SLA escrow contract bindings.
 *
 * Reads work without a wallet. Writes require MetaMask: the genlayer-js
 * client routes eth_sendTransaction through window.ethereum when the
 * account is a plain address. Payable methods pass `value` and every
 * write carries a fee deposit estimated from the network (Consensus
 * v0.6 fee model) — including the message allocations required by
 * child messages such as settlement transfers.
 */
export class TrustPing {
  private contractAddress: `0x${string}`;
  private account: string | null;

  constructor(account?: string | null) {
    const address = getContractAddress();
    if (!address) {
      throw new Error("NEXT_PUBLIC_CONTRACT_ADDRESS is not configured");
    }
    this.contractAddress = address as `0x${string}`;
    this.account = account ?? null;
  }

  private client() {
    const config: any = { chain: GENLAYER_CHAIN };
    if (this.account) {
      config.account = this.account as `0x${string}`;
    }
    return createClient(config);
  }

  /** Estimate fees for a write, passing value so payable simulations succeed. */
  private async estimate(write: {
    functionName: string;
    args: any[];
    value?: bigint;
  }) {
    const client = this.client() as any;
    if (typeof client.estimateTransactionFeesForWrite === "function") {
      return client.estimateTransactionFeesForWrite({
        address: this.contractAddress,
        ...write,
      });
    }
    return client.estimateTransactionFees({
      address: this.contractAddress,
      ...write,
    });
  }

  async write(
    functionName: string,
    args: any[] = [],
    value?: bigint
  ): Promise<TxResult> {
    const client = this.client() as any;
    const estimate = await this.estimate({ functionName, args, value });
    const hash: `0x${string}` = await client.writeContract({
      address: this.contractAddress,
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
    if (!isSuccessful(receipt)) {
      throw new Error(
        `Transaction failed (${receipt?.statusName ?? receipt?.status}, ${
          receipt?.txExecutionResultName ?? receipt?.txExecutionResult
        })`
      );
    }
    return { hash, explorerUrl: this.explorerTx(hash) };
  }

  explorerTx(hash: string): string {
    return `https://explorer-studio-dev.genlayer.com/tx/${hash}`;
  }

  explorerAddress(address: string): string {
    return `https://explorer-studio-dev.genlayer.com/address/${address}`;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  private async read<T>(functionName: string, args: any[] = []): Promise<T> {
    const client = this.client() as any;
    return client.readContract({
      address: this.contractAddress,
      functionName,
      args,
    });
  }

  private static normalizeMap<T>(raw: any): Record<string, T> {
    if (!raw) return {};
    if (raw instanceof Map) {
      return Object.fromEntries(raw.entries());
    }
    if (typeof raw === "object") return raw as Record<string, T>;
    return {};
  }

  async getListings(): Promise<Listing[]> {
    const raw = await this.read<any>("get_listings");
    return Object.values(TrustPing.normalizeMap<Listing>(raw)).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  }

  async getCoverages(): Promise<Coverage[]> {
    const raw = await this.read<any>("get_coverages");
    return Object.values(TrustPing.normalizeMap<Coverage>(raw)).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  }

  async getChecks(coverageId: string): Promise<CheckResult[]> {
    const raw = await this.read<any>("get_checks", [coverageId]);
    if (Array.isArray(raw)) return raw;
    return [];
  }

  async getStats(): Promise<TrustPingStats> {
    return this.read<TrustPingStats>("get_stats");
  }

  // ── writes ────────────────────────────────────────────────────────────

  createListing(input: {
    name: string;
    endpoint: string;
    pricePerPeriodGen: string;
    bondGen: string;
  }): Promise<TxResult> {
    return this.write(
      "create_listing",
      [input.name, input.endpoint, parseGen(input.pricePerPeriodGen)],
      parseGen(input.bondGen)
    );
  }

  buyCoverage(listingId: string, periods: number, pricePerPeriodAtto: string): Promise<TxResult> {
    return this.write(
      "buy_coverage",
      [listingId, periods],
      BigInt(pricePerPeriodAtto) * BigInt(periods)
    );
  }

  runCheck(coverageId: string): Promise<TxResult> {
    return this.write("run_check", [coverageId]);
  }

  settle(coverageId: string): Promise<TxResult> {
    return this.write("settle", [coverageId]);
  }

  cancelCoverage(coverageId: string): Promise<TxResult> {
    return this.write("cancel_coverage", [coverageId]);
  }

  deactivateListing(listingId: string): Promise<TxResult> {
    return this.write("deactivate_listing", [listingId]);
  }

  cancelListing(listingId: string): Promise<TxResult> {
    return this.write("cancel_listing", [listingId]);
  }
}
