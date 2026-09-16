export interface Listing {
  id: string;
  provider: string;
  name: string;
  endpoint: string;
  price_per_period: string; // atto GEN
  bond: string; // atto GEN
  active: boolean;
  created_at: string;
  checks_done: number;
  checks_passed: number;
  uptime_bps: number; // -1 when no checks yet
}

export interface Coverage {
  id: string;
  listing_id: string;
  buyer: string;
  periods: number;
  checks_done: number;
  checks_failed: number;
  penalties: string; // atto GEN
  status: "active" | "settled";
  started_at: string;
  updated_at: string;
}

export interface CheckResult {
  coverage_id: string;
  period: number;
  up: boolean;
  status_class: string;
  checked_by: string;
  checked_at: string;
}

export interface TrustPingStats {
  listings: number;
  coverages: number;
  total_checks: number;
  total_checks_passed: number;
}
