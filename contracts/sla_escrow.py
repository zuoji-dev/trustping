# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""TrustPing — trustless SLA escrow for AI agent services.

A provider posts a bond and lists an SLA for an HTTP endpoint. A buyer
pre-pays for N monitoring periods into escrow. Anyone (permissionless
keeper) triggers `run_check`; GenLayer validators independently probe the
endpoint and reach consensus on whether the service was up. At settlement
the escrow is split: the provider earns the price of every period that
passed, failed periods are refunded to the buyer plus a penalty taken from
the provider's bond.

Consensus design: every check is a non-deterministic web probe. The leader
fetches the endpoint and derives stable decision fields (up, status class,
wide latency bucket). The validator re-runs the same probe and compares the
derived fields — it never trusts the leader's answer. Transient network
failures agree only when both sides hit them; every substantive field
disagreement forces leader rotation.

All money values are atto GEN (1 GEN = 10^18), stored as u256.
"""

import json
from dataclasses import dataclass

import genlayer as gl
from genlayer.storage import allow as allow_storage
from genlayer.types import Address, u256

ERROR_TRANSIENT = "[TRANSIENT]"  # network-level probe failure, agree if both hit it

_MAX_ENDPOINT_LEN = 256
_MAX_NAME_LEN = 64
_MAX_PERIODS = 100


@allow_storage
@dataclass
class Listing:
    id: str
    provider: str  # provider address, hex
    name: str
    endpoint: str
    price_per_period: u256  # atto GEN earned per passed check
    bond: u256  # atto GEN collateral still held for this listing
    active: bool
    created_at: str
    checks_done: u256  # aggregate stats across all coverages
    checks_passed: u256


@allow_storage
@dataclass
class Coverage:
    id: str
    listing_id: str
    buyer: str  # buyer address, hex
    periods: u256  # total paid periods
    checks_done: u256
    checks_failed: u256
    penalties: u256  # atto GEN moved from provider bond to buyer refund
    status: str  # "active" | "settled"
    started_at: str
    updated_at: str


@allow_storage
@dataclass
class CheckResult:
    coverage_id: str
    period: u256
    up: bool
    status_class: str  # "200xx", "404xx", "50xxx", ...
    checked_by: str
    checked_at: str


class TrustPingEscrow(gl.contract.Contract):
    listings: gl.storage.TreeMap[str, Listing]
    listing_ids: gl.storage.DynArray[str]
    coverages: gl.storage.TreeMap[str, Coverage]
    coverage_ids: gl.storage.DynArray[str]
    checks: gl.storage.TreeMap[str, CheckResult]  # key: "<coverage_id>:<period>"
    next_listing_id: u256
    next_coverage_id: u256
    total_checks: u256
    total_checks_passed: u256

    def __init__(self):
        self.next_listing_id = u256(1)
        self.next_coverage_id = u256(1)
        self.total_checks = u256(0)
        self.total_checks_passed = u256(0)

    # ── internal helpers ──────────────────────────────────────────────────

    def _next_listing_id(self) -> str:
        uid = int(self.next_listing_id)
        self.next_listing_id = u256(uid + 1)
        return f"l{uid}"

    def _next_coverage_id(self) -> str:
        uid = int(self.next_coverage_id)
        self.next_coverage_id = u256(uid + 1)
        return f"c{uid}"

    def _now(self) -> str:
        try:
            return str(gl.message.datetime)
        except Exception:
            return ""

    def _sender(self) -> str:
        return gl.message.sender_address.as_hex

    def _require(self, condition: bool, message: str) -> None:
        if not condition:
            raise gl.vm.UserError(message)

    def _probe(self, endpoint: str) -> dict:
        """Consensus probe of one endpoint.

        Leader and validator each fetch the endpoint independently and
        compare derived decision fields: `up` and `status_class` must
        match exactly. The validator reruns `leader_fn()` in its own
        context — it never trusts the leader's answer.
        """

        def leader_fn() -> dict:
            try:
                res = gl.nondet.web.get(endpoint)
            except gl.vm.UserError:
                raise
            except Exception as e:  # DNS, timeout, connection refused …
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} probe network failure: {e}")
            status = int(res.status)
            up = 200 <= status < 400
            status_class = (
                f"{(status // 100) * 100}xx" if 100 <= status < 600 else "invalid"
            )
            return {"up": up, "status_class": status_class}

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                # Leader raised. Re-run: agree only on matched transient errors.
                leader_msg = getattr(leaders_res, "message", "")
                try:
                    leader_fn()
                    return False  # leader failed while validator succeeded
                except gl.vm.UserError as e:
                    vmsg = getattr(e, "message", str(e))
                    return (
                        vmsg.startswith(ERROR_TRANSIENT)
                        and leader_msg.startswith(ERROR_TRANSIENT)
                    )
                except Exception:
                    return False
            try:
                v = leader_fn()
            except gl.vm.UserError:
                return False  # validator failed while leader succeeded
            except Exception:
                return False
            l = leaders_res.calldata
            if not isinstance(l, dict):
                return False
            return bool(l.get("up")) == bool(v["up"]) and str(
                l.get("status_class")
            ) == str(v["status_class"])

        result = gl.vm.run_nondet(leader_fn, validator_fn)
        # On-chain the leader result is wrapped in gl.vm.Return; direct-mode
        # execution (leader only, as in tests) returns the raw dict.
        if isinstance(result, gl.vm.Return):
            calldata = result.calldata
        elif isinstance(result, dict):
            calldata = result
        else:
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} probe did not return a result")
        if not isinstance(calldata, dict):
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} probe returned malformed data")
        return calldata

    def _get_listing(self, listing_id: str) -> Listing:
        listing = self.listings.get(listing_id)
        self._require(listing is not None, "Listing not found")
        return listing

    def _get_coverage(self, coverage_id: str) -> Coverage:
        cov = self.coverages.get(coverage_id)
        self._require(cov is not None, "Coverage not found")
        return cov

    def _settle_active(self, cov: Coverage, listing: Listing, refund_rest: bool) -> dict:
        """Split escrow and mark coverage settled. Returns a summary dict."""
        price = int(listing.price_per_period)
        done = int(cov.checks_done)
        failed = int(cov.checks_failed)
        passed = done - failed
        periods = int(cov.periods)

        provider_earn = u256(passed * price)
        buyer_refund = u256(failed * price + int(cov.penalties))
        if refund_rest:
            buyer_refund = u256(int(buyer_refund) + (periods - done) * price)

        buyer = Address(cov.buyer)
        provider = Address(listing.provider)
        if int(provider_earn) > 0:
            gl.chain.Account(provider).emit_transfer(int(provider_earn))
        if int(buyer_refund) > 0:
            gl.chain.Account(buyer).emit_transfer(int(buyer_refund))

        cov.status = "settled"
        cov.updated_at = self._now()
        return {
            "coverage_id": cov.id,
            "provider_earn": int(provider_earn),
            "buyer_refund": int(buyer_refund),
            "checks_passed": passed,
            "checks_failed": failed,
        }

    # ── provider flows ────────────────────────────────────────────────────

    @gl.public.write.payable
    def create_listing(self, name: str, endpoint: str, price_per_period: u256) -> str:
        """Register an SLA. The attached value becomes the provider bond."""
        self._require(len(name) > 0 and len(name) <= _MAX_NAME_LEN, "Invalid name length")
        self._require(
            len(endpoint) > 0 and len(endpoint) <= _MAX_ENDPOINT_LEN,
            "Invalid endpoint length",
        )
        self._require(
            endpoint.startswith("http://") or endpoint.startswith("https://"),
            "Endpoint must be an http(s) URL",
        )
        self._require(int(price_per_period) > 0, "Price per period must be positive")
        bond = int(gl.message.value)
        self._require(bond > 0, "Bond required: attach value to create a listing")

        lid = self._next_listing_id()
        listing = Listing(
            id=lid,
            provider=self._sender(),
            name=name,
            endpoint=endpoint,
            price_per_period=u256(int(price_per_period)),
            bond=u256(bond),
            active=True,
            created_at=self._now(),
            checks_done=u256(0),
            checks_passed=u256(0),
        )
        self.listings[lid] = listing
        self.listing_ids.append(lid)
        return lid

    @gl.public.write
    def deactivate_listing(self, listing_id: str) -> None:
        """Stop selling new coverages; existing coverages keep running."""
        listing = self._get_listing(listing_id)
        self._require(gl.message.sender_address == Address(listing.provider), "Only provider")
        listing.active = False

    @gl.public.write
    def cancel_listing(self, listing_id: str) -> None:
        """Return the bond. Only allowed when no active coverage references it."""
        listing = self._get_listing(listing_id)
        self._require(gl.message.sender_address == Address(listing.provider), "Only provider")
        for cid in self.coverage_ids:
            cov = self.coverages.get(cid)
            if cov is not None and cov.listing_id == listing_id and cov.status == "active":
                raise gl.vm.UserError("Listing has active coverages")
        bond = int(listing.bond)
        self._require(bond > 0, "Bond already returned")
        listing.bond = u256(0)
        listing.active = False
        gl.chain.Account(Address(listing.provider)).emit_transfer(bond)

    # ── buyer flows ───────────────────────────────────────────────────────

    @gl.public.write.payable
    def buy_coverage(self, listing_id: str, periods: u256) -> str:
        """Pre-pay for `periods` monitoring periods into escrow."""
        listing = self._get_listing(listing_id)
        self._require(listing.active, "Listing is not active")
        n = int(periods)
        self._require(0 < n <= _MAX_PERIODS, f"Periods must be 1..{_MAX_PERIODS}")
        total = int(listing.price_per_period) * n
        self._require(
            int(gl.message.value) == total,
            f"Exact payment required: {total} atto GEN",
        )

        cid = self._next_coverage_id()
        cov = Coverage(
            id=cid,
            listing_id=listing_id,
            buyer=self._sender(),
            periods=u256(n),
            checks_done=u256(0),
            checks_failed=u256(0),
            penalties=u256(0),
            status="active",
            started_at=self._now(),
            updated_at=self._now(),
        )
        self.coverages[cid] = cov
        self.coverage_ids.append(cid)
        return cid

    # ── permissionless monitoring ─────────────────────────────────────────

    @gl.public.write
    def run_check(self, coverage_id: str) -> dict:
        """Probe the endpoint under consensus. One check consumes one period."""
        cov = self._get_coverage(coverage_id)
        self._require(cov.status == "active", "Coverage is settled")
        listing = self._get_listing(cov.listing_id)
        self._require(
            int(cov.checks_done) < int(cov.periods),
            "All periods already checked; call settle",
        )

        verdict = self._probe(listing.endpoint)

        period = int(cov.checks_done)
        up = bool(verdict.get("up"))
        result = CheckResult(
            coverage_id=coverage_id,
            period=u256(period),
            up=up,
            status_class=str(verdict.get("status_class", "")),
            checked_by=self._sender(),
            checked_at=self._now(),
        )
        self.checks[f"{coverage_id}:{period}"] = result

        cov.checks_done = u256(period + 1)
        listing.checks_done = u256(int(listing.checks_done) + 1)
        self.total_checks = u256(int(self.total_checks) + 1)
        if up:
            listing.checks_passed = u256(int(listing.checks_passed) + 1)
            self.total_checks_passed = u256(int(self.total_checks_passed) + 1)
        else:
            cov.checks_failed = u256(int(cov.checks_failed) + 1)
            # SLA breach: move half a period's price from bond to buyer refund
            penalty = int(listing.price_per_period) // 2
            penalty = min(penalty, int(listing.bond))
            if penalty > 0:
                listing.bond = u256(int(listing.bond) - penalty)
                cov.penalties = u256(int(cov.penalties) + penalty)
        cov.updated_at = self._now()

        return {
            "coverage_id": coverage_id,
            "period": period,
            "up": up,
            "status_class": result.status_class,
            "checks_done": int(cov.checks_done),
            "checks_failed": int(cov.checks_failed),
        }

    @gl.public.write
    def settle(self, coverage_id: str) -> dict:
        """Split the escrow once every period has been checked. Permissionless."""
        cov = self._get_coverage(coverage_id)
        self._require(cov.status == "active", "Coverage is settled")
        listing = self._get_listing(cov.listing_id)
        self._require(
            int(cov.checks_done) >= int(cov.periods),
            "Not all periods checked yet",
        )
        return self._settle_active(cov, listing, refund_rest=False)

    @gl.public.write
    def cancel_coverage(self, coverage_id: str) -> dict:
        """Buyer settles early: completed checks are paid out, the rest is refunded."""
        cov = self._get_coverage(coverage_id)
        self._require(cov.status == "active", "Coverage is settled")
        self._require(gl.message.sender_address == Address(cov.buyer), "Only buyer")
        listing = self._get_listing(cov.listing_id)
        return self._settle_active(cov, listing, refund_rest=True)

    # ── views ─────────────────────────────────────────────────────────────

    @gl.public.view
    def get_listing(self, listing_id: str) -> dict:
        l = self._get_listing(listing_id)
        return self._listing_dict(l)

    @gl.public.view
    def get_listings(self) -> dict:
        out = {}
        for lid in self.listing_ids:
            l = self.listings.get(lid)
            if l is not None:
                out[lid] = self._listing_dict(l)
        return out

    @gl.public.view
    def get_coverage(self, coverage_id: str) -> dict:
        return self._coverage_dict(self._get_coverage(coverage_id))

    @gl.public.view
    def get_coverages(self) -> dict:
        out = {}
        for cid in self.coverage_ids:
            c = self.coverages.get(cid)
            if c is not None:
                out[cid] = self._coverage_dict(c)
        return out

    @gl.public.view
    def get_check(self, coverage_id: str, period: u256) -> dict:
        r = self.checks.get(f"{coverage_id}:{int(period)}")
        self._require(r is not None, "Check not found")
        return self._check_dict(r)

    @gl.public.view
    def get_checks(self, coverage_id: str) -> list:
        cov = self._get_coverage(coverage_id)
        out = []
        for p in range(int(cov.checks_done)):
            r = self.checks.get(f"{coverage_id}:{p}")
            if r is not None:
                out.append(self._check_dict(r))
        return out

    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "listings": len(self.listing_ids),
            "coverages": len(self.coverage_ids),
            "total_checks": int(self.total_checks),
            "total_checks_passed": int(self.total_checks_passed),
        }

    # ── serialization helpers ─────────────────────────────────────────────

    def _listing_dict(self, l: Listing) -> dict:
        done = int(l.checks_done)
        return {
            "id": l.id,
            "provider": l.provider,
            "name": l.name,
            "endpoint": l.endpoint,
            "price_per_period": int(l.price_per_period),
            "bond": int(l.bond),
            "active": l.active,
            "created_at": l.created_at,
            "checks_done": done,
            "checks_passed": int(l.checks_passed),
            "uptime_bps": int(int(l.checks_passed) * 10000 // done) if done > 0 else -1,
        }

    def _coverage_dict(self, c: Coverage) -> dict:
        return {
            "id": c.id,
            "listing_id": c.listing_id,
            "buyer": c.buyer,
            "periods": int(c.periods),
            "checks_done": int(c.checks_done),
            "checks_failed": int(c.checks_failed),
            "penalties": int(c.penalties),
            "status": c.status,
            "started_at": c.started_at,
            "updated_at": c.updated_at,
        }

    def _check_dict(self, r: CheckResult) -> dict:
        return {
            "coverage_id": r.coverage_id,
            "period": int(r.period),
            "up": r.up,
            "status_class": r.status_class,
            "checked_by": r.checked_by,
            "checked_at": r.checked_at,
        }
