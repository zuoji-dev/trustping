"use client";

import { useState } from "react";
import { Activity, ShieldCheck, RefreshCw, ExternalLink, ArrowDownToLine } from "lucide-react";
import { useListings, useCoverages, useBuyCoverage, useRunCheck, useSettle, useChecks } from "@/lib/hooks/useTrustPing";
import { useWallet } from "@/lib/genlayer/wallet";
import { formatGen } from "@/lib/contracts/TrustPing";
import type { Coverage, Listing } from "@/lib/contracts/types";
import { success, error } from "@/lib/utils/toast";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { AddressDisplay } from "./AddressDisplay";

function UptimeBadge({ listing }: { listing: Listing }) {
  if (listing.checks_done === 0) {
    return <Badge variant="outline">no checks yet</Badge>;
  }
  const pct = Math.round((listing.checks_passed * 100) / listing.checks_done);
  const tone =
    pct >= 99 ? "default" : pct >= 90 ? "secondary" : "destructive";
  return <Badge variant={tone as any}>{pct}% uptime</Badge>;
}

function BuyDialog({
  listing,
  open,
  onOpenChange,
}: {
  listing: Listing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { address } = useWallet();
  const buy = useBuyCoverage();
  const [periods, setPeriods] = useState("3");

  const periodsNum = Math.max(1, Math.min(100, parseInt(periods || "0", 10) || 0));
  const totalAtto = listing
    ? BigInt(listing.price_per_period) * BigInt(periodsNum || 1)
    : 0n;

  if (!listing) return null;

  const handleBuy = async () => {
    if (!address) {
      error("Connect your wallet first");
      return;
    }
    if (!periodsNum || periodsNum < 1) {
      error("Enter a number of periods (1–100)");
      return;
    }
    try {
      const result = await buy.mutateAsync({
        listingId: listing.id,
        periods: periodsNum,
        pricePerPeriodAtto: listing.price_per_period,
      });
      success(`Coverage purchased`, {
        description: "View transaction ↗",
        action: undefined,
      });
      window.open(result.explorerUrl, "_blank");
      onOpenChange(false);
    } catch (err: any) {
      error(String(err?.message ?? err).slice(0, 200));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="brand-card border-2 max-w-md">
        <DialogHeader>
          <DialogTitle>Buy coverage — {listing.name}</DialogTitle>
          <DialogDescription>
            Pre-pay monitoring periods into escrow. Every failed check refunds
            that period&apos;s price to you plus a penalty taken from the
            provider&apos;s bond.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="brand-card p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Endpoint</span>
              <a
                className="font-mono text-xs text-accent hover:underline truncate max-w-[220px]"
                href={listing.endpoint}
                target="_blank"
                rel="noopener noreferrer"
              >
                {listing.endpoint}
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Price / period</span>
              <span>{formatGen(listing.price_per_period)} GEN</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider bond</span>
              <span>{formatGen(listing.bond)} GEN</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="periods">Periods to purchase (1–100)</Label>
            <Input
              id="periods"
              type="number"
              min={1}
              max={100}
              value={periods}
              onChange={(e) => setPeriods(e.target.value)}
            />
          </div>

          <div className="flex justify-between text-sm font-semibold">
            <span>Total escrowed</span>
            <span className="text-accent">{formatGen(totalAtto)} GEN</span>
          </div>

          <Button
            onClick={handleBuy}
            variant="gradient"
            className="w-full"
            disabled={buy.isPending || !address}
          >
            {buy.isPending
              ? "Confirming…"
              : address
                ? "Buy coverage"
                : "Connect wallet first"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Marketplace() {
  const { data: listings = [], isLoading } = useListings();
  const [buying, setBuying] = useState<Listing | null>(null);

  if (isLoading) {
    return (
      <div className="text-center text-muted-foreground py-12">
        Loading listings…
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="brand-card text-center py-12">
        <Activity className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">
          No SLA listings yet. Be the first provider in the Provider tab.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {listings.map((listing) => (
          <div key={listing.id} className="brand-card p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-lg leading-tight">
                  {listing.name}
                </div>
                <a
                  className="text-xs font-mono text-muted-foreground hover:text-accent truncate block max-w-[240px]"
                  href={listing.endpoint}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {listing.endpoint} ↗
                </a>
              </div>
              <UptimeBadge listing={listing} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Price / period</div>
                <div className="font-semibold">{formatGen(listing.price_per_period)} GEN</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Provider bond</div>
                <div className="font-semibold">{formatGen(listing.bond)} GEN</div>
              </div>
              <div className="col-span-2">
                <div className="text-muted-foreground text-xs">Provider</div>
                <AddressDisplay address={listing.provider} maxLength={16} />
              </div>
            </div>

            <div className="flex items-center justify-between mt-auto pt-2">
              <span className="text-xs text-muted-foreground">
                {listing.checks_done} checks · {listing.checks_passed} passed
              </span>
              <Button
                size="sm"
                variant={listing.active ? "gradient" : "outline"}
                disabled={!listing.active}
                onClick={() => setBuying(listing)}
              >
                <ShieldCheck className="w-4 h-4 mr-1.5" />
                {listing.active ? "Buy coverage" : "Inactive"}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <BuyDialog listing={buying} open={!!buying} onOpenChange={(o) => !o && setBuying(null)} />
    </>
  );
}
