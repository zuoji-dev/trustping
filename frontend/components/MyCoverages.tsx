"use client";

import { useState } from "react";
import { Radar, Flag, XCircle, History, ExternalLink } from "lucide-react";
import { useCoverages, useListings, useRunCheck, useSettle, useCancelCoverage, useChecks } from "@/lib/hooks/useTrustPing";
import { useWallet } from "@/lib/genlayer/wallet";
import { formatGen } from "@/lib/contracts/TrustPing";
import type { Coverage } from "@/lib/contracts/types";
import { success, error } from "@/lib/utils/toast";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { AddressDisplay } from "./AddressDisplay";

function ChecksHistory({ coverageId }: { coverageId: string }) {
  const { data: checks = [] } = useChecks(coverageId);

  if (checks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground px-1 py-2">
        No checks recorded yet — anyone can trigger the first probe.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1.5 pr-3">#</th>
            <th className="py-1.5 pr-3">Verdict</th>
            <th className="py-1.5 pr-3">Status</th>
            <th className="py-1.5 pr-3">Checked by</th>
            <th className="py-1.5 pr-3">When</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.period} className="border-t border-white/5">
              <td className="py-1.5 pr-3 font-mono">{check.period}</td>
              <td className="py-1.5 pr-3">
                {check.up ? (
                  <Badge variant="default" className="text-[10px]">UP</Badge>
                ) : (
                  <Badge variant="destructive" className="text-[10px]">DOWN</Badge>
                )}
              </td>
              <td className="py-1.5 pr-3 font-mono">{check.status_class}</td>
              <td className="py-1.5 pr-3">
                <AddressDisplay address={check.checked_by} maxLength={10} />
              </td>
              <td className="py-1.5 pr-3 text-muted-foreground">
                {check.checked_at?.replace("T", " ").slice(0, 19)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageCard({ coverage }: { coverage: Coverage }) {
  const { data: listings = [] } = useListings();
  const { address } = useWallet();
  const runCheck = useRunCheck();
  const settle = useSettle();
  const cancelCoverage = useCancelCoverage();
  const [showHistory, setShowHistory] = useState(false);

  const listing = listings.find((l) => l.id === coverage.listing_id);
  const isBuyer = address && coverage.buyer.toLowerCase() === address.toLowerCase();
  const allChecked = coverage.checks_done >= coverage.periods;
  const isSettled = coverage.status === "settled";

  const doAction = async (
    fn: () => Promise<{ hash: string; explorerUrl: string }>,
    label: string
  ) => {
    try {
      const result = await fn();
      success(label, { description: "View transaction ↗" });
      window.open(result.explorerUrl, "_blank");
    } catch (err: any) {
      error(String(err?.message ?? err).slice(0, 220));
    }
  };

  return (
    <div className="brand-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {coverage.id} · {listing?.name ?? coverage.listing_id}
          </div>
          <div className="text-xs text-muted-foreground">
            buyer <AddressDisplay address={coverage.buyer} maxLength={12} />
          </div>
        </div>
        <div className="flex gap-1.5">
          {isSettled ? (
            <Badge variant="secondary">settled</Badge>
          ) : (
            <Badge variant={allChecked ? "default" : "outline"}>
              {coverage.checks_done}/{coverage.periods} checked
            </Badge>
          )}
          {coverage.checks_failed > 0 && (
            <Badge variant="destructive">{coverage.checks_failed} failed</Badge>
          )}
        </div>
      </div>

      {Number(coverage.penalties) > 0 && (
        <div className="text-xs text-amber-400">
          Bond penalties to buyer: {formatGen(coverage.penalties)} GEN
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!isSettled && (
          <>
            <Button
              size="sm"
              variant="gradient"
              disabled={runCheck.isPending || allChecked}
              onClick={() =>
                doAction(() => runCheck.mutateAsync(coverage.id), "Probe recorded on-chain")
              }
              title={allChecked ? "All periods checked" : "Trigger a consensus probe"}
            >
              <Radar className="w-4 h-4 mr-1.5" />
              Run check
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={settle.isPending || !allChecked}
              onClick={() => doAction(() => settle.mutateAsync(coverage.id), "Escrow settled")}
              title={allChecked ? "Split the escrow" : "Wait until every period is checked"}
            >
              <Flag className="w-4 h-4 mr-1.5" />
              Settle
            </Button>
            {isBuyer && (
              <Button
                size="sm"
                variant="outline"
                disabled={cancelCoverage.isPending}
                onClick={() =>
                  doAction(
                    () => cancelCoverage.mutateAsync(coverage.id),
                    "Coverage cancelled — refunds sent"
                  )
                }
              >
                <XCircle className="w-4 h-4 mr-1.5" />
                Cancel
              </Button>
            )}
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowHistory((v) => !v)}
        >
          <History className="w-4 h-4 mr-1.5" />
          {showHistory ? "Hide checks" : `Checks (${coverage.checks_done})`}
        </Button>
      </div>

      {showHistory && (
        <div className="pt-1">
          <ChecksHistory coverageId={coverage.id} />
        </div>
      )}
    </div>
  );
}

export function MyCoverages() {
  const { data: coverages = [], isLoading } = useCoverages();
  const { address } = useWallet();

  const mine = address
    ? coverages.filter(
        (c) => c.buyer.toLowerCase() === address.toLowerCase()
      )
    : coverages;

  const sorted = [...mine].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return b.id.localeCompare(a.id);
  });

  if (isLoading) {
    return <div className="text-center text-muted-foreground py-12">Loading…</div>;
  }

  if (sorted.length === 0) {
    return (
      <div className="brand-card text-center py-12 text-muted-foreground">
        {address
          ? "You have no coverages yet. Buy one from the Marketplace tab."
          : "Connect your wallet to see your coverages — or browse all coverage activity below once it exists."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {sorted.map((coverage) => (
        <CoverageCard key={coverage.id} coverage={coverage} />
      ))}
    </div>
  );
}
