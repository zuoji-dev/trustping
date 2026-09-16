"use client";

import { useStats } from "@/lib/hooks/useTrustPing";

export function StatsBar() {
  const { data: stats } = useStats();

  const total = stats?.total_checks ?? 0;
  const passed = stats?.total_checks_passed ?? 0;
  const uptime = total > 0 ? Math.round((passed * 100) / total) : null;

  const items = [
    { label: "SLA listings", value: stats?.listings ?? "–" },
    { label: "Coverages sold", value: stats?.coverages ?? "–" },
    { label: "Consensus checks", value: total || "–" },
    {
      label: "Network uptime",
      value: uptime === null ? "–" : `${uptime}%`,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="brand-card px-4 py-3 text-center"
        >
          <div className="text-xl md:text-2xl font-bold text-accent">
            {item.value}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}
