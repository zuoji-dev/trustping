"use client";

import { useState } from "react";
import { Plus, Ban, Coins, Globe, ServerCog } from "lucide-react";
import { useListings, useCreateListing, useDeactivateListing, useCancelListing } from "@/lib/hooks/useTrustPing";
import { useWallet } from "@/lib/genlayer/wallet";
import { formatGen } from "@/lib/contracts/TrustPing";
import { success, error } from "@/lib/utils/toast";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { AddressDisplay } from "./AddressDisplay";

const URL_PATTERN = /^https?:\/\/.+/;

export function ProviderPanel() {
  const { address } = useWallet();
  const { data: listings = [] } = useListings();
  const createListing = useCreateListing();
  const deactivateListing = useDeactivateListing();
  const cancelListing = useCancelListing();

  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("https://");
  const [price, setPrice] = useState("0.1");
  const [bond, setBond] = useState("5");

  const mine = address
    ? listings.filter((l) => l.provider.toLowerCase() === address.toLowerCase())
    : [];

  const handleCreate = async () => {
    if (!address) {
      error("Connect your wallet first");
      return;
    }
    if (!name.trim()) {
      error("Give your service a name");
      return;
    }
    if (!URL_PATTERN.test(endpoint.trim())) {
      error("Endpoint must be an http(s) URL");
      return;
    }
    const priceNum = parseFloat(price);
    const bondNum = parseFloat(bond);
    if (!(priceNum > 0)) {
      error("Price per period must be positive");
      return;
    }
    if (!(bondNum > 0)) {
      error("Bond must be positive — it backs your SLA");
      return;
    }
    try {
      const result = await createListing.mutateAsync({
        name: name.trim(),
        endpoint: endpoint.trim(),
        pricePerPeriodGen: price,
        bondGen: bond,
      });
      success("SLA listing created", { description: "View transaction ↗" });
      window.open(result.explorerUrl, "_blank");
      setName("");
      setEndpoint("https://");
    } catch (err: any) {
      error(String(err?.message ?? err).slice(0, 240));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Create listing form */}
      <div className="lg:col-span-5">
        <div className="brand-card p-6 space-y-4">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <ServerCog className="w-5 h-5 text-accent" />
              List an SLA
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Post a bond, name the endpoint your agents serve, and set the
              price per monitoring period. Failed checks refund buyers from
              escrow and fine your bond.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="svc-name">Service name</Label>
            <Input
              id="svc-name"
              placeholder="My Agent API"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="svc-endpoint">Endpoint to probe</Label>
            <Input
              id="svc-endpoint"
              placeholder="https://api.example.com/health"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              maxLength={256}
            />
            <p className="text-[11px] text-muted-foreground">
              Validators fetch this URL and consensus on the HTTP status.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="svc-price">Price / period (GEN)</Label>
              <Input
                id="svc-price"
                type="number"
                step="0.01"
                min="0.001"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="svc-bond">Bond (GEN)</Label>
              <Input
                id="svc-bond"
                type="number"
                step="0.5"
                min="0.001"
                value={bond}
                onChange={(e) => setBond(e.target.value)}
              />
            </div>
          </div>

          <Button
            onClick={handleCreate}
            variant="gradient"
            className="w-full"
            disabled={createListing.isPending}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {createListing.isPending ? "Confirming…" : "Create listing"}
          </Button>
        </div>
      </div>

      {/* My listings */}
      <div className="lg:col-span-7 space-y-4">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Globe className="w-5 h-5 text-accent" />
          My listings
        </h3>

        {!address && (
          <div className="brand-card text-center py-10 text-muted-foreground">
            Connect your wallet to manage your SLA listings.
          </div>
        )}

        {address && mine.length === 0 && (
          <div className="brand-card text-center py-10 text-muted-foreground">
            You have no listings yet. Create one to start selling coverage.
          </div>
        )}

        {mine.map((listing) => (
          <div key={listing.id} className="brand-card p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{listing.name}</div>
                <a
                  className="text-xs font-mono text-muted-foreground hover:text-accent"
                  href={listing.endpoint}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {listing.endpoint} ↗
                </a>
              </div>
              <div className="flex gap-1.5">
                <Badge variant={listing.active ? "default" : "secondary"}>
                  {listing.active ? "active" : "inactive"}
                </Badge>
                {listing.checks_done > 0 && (
                  <Badge variant="outline">
                    {Math.round(
                      (listing.checks_passed * 100) / listing.checks_done
                    )}
                    % uptime
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span>
                <span className="text-muted-foreground">Price:</span>{" "}
                {formatGen(listing.price_per_period)} GEN
              </span>
              <span>
                <span className="text-muted-foreground">Bond held:</span>{" "}
                <span className="text-accent font-semibold">
                  {formatGen(listing.bond)} GEN
                </span>
              </span>
              <span className="text-muted-foreground">
                {listing.checks_done} checks · {listing.checks_passed} passed
              </span>
            </div>

            <div className="flex gap-2 pt-1">
              {listing.active && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deactivateListing.isPending}
                  onClick={async () => {
                    try {
                      const r = await deactivateListing.mutateAsync(listing.id);
                      success("Listing deactivated");
                      window.open(r.explorerUrl, "_blank");
                    } catch (err: any) {
                      error(String(err?.message ?? err).slice(0, 200));
                    }
                  }}
                >
                  <Ban className="w-4 h-4 mr-1.5" />
                  Deactivate
                </Button>
              )}
              {Number(listing.bond) > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancelListing.isPending}
                  onClick={async () => {
                    try {
                      const r = await cancelListing.mutateAsync(listing.id);
                      success("Bond returned");
                      window.open(r.explorerUrl, "_blank");
                    } catch (err: any) {
                      error(String(err?.message ?? err).slice(0, 200));
                    }
                  }}
                  title="Return the bond — only possible when no active coverages exist"
                >
                  <Coins className="w-4 h-4 mr-1.5" />
                  Return bond
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
