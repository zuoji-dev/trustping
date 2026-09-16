"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { TrustPing } from "../contracts/TrustPing";
import { getContractAddress } from "../genlayer/client";
import { useWallet } from "../genlayer/wallet";
import type { CheckResult, Coverage, Listing, TrustPingStats } from "../contracts/types";

/** Hook for the TrustPing contract bound to the connected wallet (writes). */
export function useTrustPing(): TrustPing | null {
  const { address } = useWallet();
  const contractAddress = getContractAddress();
  return useMemo(() => {
    if (!contractAddress) return null;
    try {
      return new TrustPing(address);
    } catch {
      return null;
    }
  }, [contractAddress, address]);
}

/** Read-only contract instance for queries that must work without a wallet. */
export function useTrustPingReads(): TrustPing | null {
  const contractAddress = getContractAddress();
  return useMemo(() => {
    if (!contractAddress) return null;
    try {
      return new TrustPing(null);
    } catch {
      return null;
    }
  }, [contractAddress]);
}

export function useListings() {
  const contract = useTrustPingReads();
  return useQuery<Listing[], Error>({
    queryKey: ["listings"],
    queryFn: () => contract!.getListings(),
    enabled: !!contract,
    refetchInterval: 15000,
  });
}

export function useCoverages() {
  const contract = useTrustPingReads();
  return useQuery<Coverage[], Error>({
    queryKey: ["coverages"],
    queryFn: () => contract!.getCoverages(),
    enabled: !!contract,
    refetchInterval: 15000,
  });
}

export function useChecks(coverageId: string | null) {
  const contract = useTrustPingReads();
  return useQuery<CheckResult[], Error>({
    queryKey: ["checks", coverageId],
    queryFn: () => contract!.getChecks(coverageId!),
    enabled: !!contract && !!coverageId,
  });
}

export function useStats() {
  const contract = useTrustPingReads();
  return useQuery<TrustPingStats, Error>({
    queryKey: ["stats"],
    queryFn: () => contract!.getStats(),
    enabled: !!contract,
    refetchInterval: 15000,
  });
}

function useInvalidateAll() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["listings"] });
    queryClient.invalidateQueries({ queryKey: ["coverages"] });
    queryClient.invalidateQueries({ queryKey: ["checks"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  }, [queryClient]);
}

/** Generic write mutation: toasts, explorer link, cache invalidation. */
function useTrustPingWrite<TInput>(
  action: (contract: TrustPing, input: TInput) => Promise<{ hash: string; explorerUrl: string }>,
  successMessage: string
) {
  const contract = useTrustPing();
  const { address } = useWallet();
  const invalidate = useInvalidateAll();

  return useMutation({
    mutationFn: async (input: TInput) => {
      if (!contract) throw new Error("Contract address not configured");
      if (!address) throw new Error("Connect your wallet first");
      const result = await action(contract, input);
      return result;
    },
    onSuccess: (result) => {
      invalidate();
      return result;
    },
    onSettled: () => invalidate(),
  });
}

export function useCreateListing() {
  return useTrustPingWrite(
    (c, input: { name: string; endpoint: string; pricePerPeriodGen: string; bondGen: string }) =>
      c.createListing(input),
    "SLA listing created"
  );
}

export function useBuyCoverage() {
  return useTrustPingWrite(
    (c, input: { listingId: string; periods: number; pricePerPeriodAtto: string }) =>
      c.buyCoverage(input.listingId, input.periods, input.pricePerPeriodAtto),
    "Coverage purchased"
  );
}

export function useRunCheck() {
  return useTrustPingWrite(
    (c, coverageId: string) => c.runCheck(coverageId),
    "Consensus probe recorded"
  );
}

export function useSettle() {
  return useTrustPingWrite(
    (c, coverageId: string) => c.settle(coverageId),
    "Coverage settled"
  );
}

export function useCancelCoverage() {
  return useTrustPingWrite(
    (c, coverageId: string) => c.cancelCoverage(coverageId),
    "Coverage cancelled and refunded"
  );
}

export function useDeactivateListing() {
  return useTrustPingWrite(
    (c, listingId: string) => c.deactivateListing(listingId),
    "Listing deactivated"
  );
}

export function useCancelListing() {
  return useTrustPingWrite(
    (c, listingId: string) => c.cancelListing(listingId),
    "Listing cancelled, bond returned"
  );
}
