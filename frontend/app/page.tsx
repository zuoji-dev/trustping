"use client";

import { useState } from "react";
import { Store, Radar, ServerCog } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { StatsBar } from "@/components/StatsBar";
import { Marketplace } from "@/components/Marketplace";
import { MyCoverages } from "@/components/MyCoverages";
import { ProviderPanel } from "@/components/ProviderPanel";

const TABS = [
  { id: "marketplace", label: "Marketplace", icon: Store },
  { id: "coverages", label: "Coverages", icon: Radar },
  { id: "provider", label: "Provider", icon: ServerCog },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function HomePage() {
  const [tab, setTab] = useState<TabId>("marketplace");

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow pt-24 pb-12 px-4 md:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Hero */}
          <div className="text-center animate-fade-in">
            <h1 className="text-3xl md:text-5xl font-bold mb-3">
              SLA escrow, settled by{" "}
              <span className="text-accent">consensus</span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
              AI agent APIs post bonds and sell uptime guarantees. GenLayer
              validators independently probe the endpoint — every check is a
              consensus decision, and escrow pays out on the verdict.
            </p>
          </div>

          <StatsBar />

          {/* Tabs */}
          <div className="flex justify-center">
            <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1 backdrop-blur">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-2 px-4 md:px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                    tab === id
                      ? "bg-accent text-accent-foreground shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Panels */}
          <div className="animate-fade-in">
            {tab === "marketplace" && <Marketplace />}
            {tab === "coverages" && <MyCoverages />}
            {tab === "provider" && <ProviderPanel />}
          </div>

          {/* How it works */}
          <div className="glass-card p-6 md:p-8 animate-fade-in">
            <h2 className="text-xl font-bold mb-4">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">1. Bond & list</div>
                <p className="text-sm text-muted-foreground">
                  A provider posts a GEN bond and lists an SLA: endpoint, price
                  per period.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">2. Buy coverage</div>
                <p className="text-sm text-muted-foreground">
                  A buyer pre-pays N monitoring periods into on-chain escrow.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">3. Consensus probe</div>
                <p className="text-sm text-muted-foreground">
                  Anyone triggers a check. Validators re-fetch the endpoint
                  themselves and agree on up/down — the leader is never
                  trusted.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">4. Settle</div>
                <p className="text-sm text-muted-foreground">
                  Passed periods pay the provider. Failed periods refund the
                  buyer plus a penalty taken from the bond. Appeals use
                  GenLayer&apos;s native mechanism.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-white/10 py-3">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-center gap-6 text-sm text-muted-foreground">
          <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
            Powered by GenLayer
          </a>
          <a href="https://studio-next.genlayer.com" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
            Studio Next
          </a>
          <a href="https://github.com/zuoji-dev/trustping" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
