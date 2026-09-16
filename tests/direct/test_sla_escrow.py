"""Direct-mode tests for the TrustPing SLA escrow contract.

Direct mode executes the leader path only — consensus/validator behaviour
is covered by integration tests. Web probes are mocked at the HTTP
boundary. All money values are atto GEN.
"""

import pytest

from tests.direct.conftest import to_hex

PRICE = 10**18  # 1 GEN per period
BOND = 10 * 10**18  # 10 GEN bond
URL = "https://api.example.com/v1/ping"


def _mock_endpoint(vm, status=200, body="OK"):
    vm.clear_mocks()
    vm.mock_web(r"https://api\.example\.com/.*", {"status": status, "body": body})


def _create_listing(vm, provider, price=PRICE, bond=BOND, url=URL, name="Agent API"):
    vm.sender = provider
    vm.value = bond
    return vm.contract.create_listing(name, url, price)


@pytest.fixture()
def contract(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy("contracts/sla_escrow.py")
    direct_vm.contract = c
    return c


def _buy(direct_vm, contract, buyer, periods, price=PRICE):
    direct_vm.sender = buyer
    direct_vm.value = price * periods
    return contract.buy_coverage("l1", periods)


# ── listing creation ─────────────────────────────────────────────────────


def test_create_listing_stores_fields(direct_vm, contract, direct_alice):
    _create_listing(direct_vm, direct_alice)
    listing = contract.get_listing("l1")
    alice = to_hex(direct_alice)
    assert listing["provider"] == alice
    assert listing["name"] == "Agent API"
    assert listing["endpoint"] == URL
    assert listing["price_per_period"] == PRICE
    assert listing["bond"] == BOND
    assert listing["active"] is True
    assert listing["checks_done"] == 0


def test_create_listing_requires_bond(direct_vm, contract, direct_alice):
    direct_vm.sender = direct_alice
    direct_vm.value = 0
    with direct_vm.expect_revert("Bond required"):
        contract.create_listing("Agent API", URL, PRICE)


def test_create_listing_rejects_bad_url(direct_vm, contract, direct_alice):
    direct_vm.sender = direct_alice
    direct_vm.value = BOND
    with direct_vm.expect_revert("Endpoint must be an http(s) URL"):
        contract.create_listing("Agent API", "ftp://example.com", PRICE)


def test_create_listing_rejects_zero_price(direct_vm, contract, direct_alice):
    direct_vm.sender = direct_alice
    direct_vm.value = BOND
    with direct_vm.expect_revert("Price per period must be positive"):
        contract.create_listing("Agent API", URL, 0)


# ── buying coverage ──────────────────────────────────────────────────────


def test_buy_coverage_escrows_payment(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    cid = _buy(direct_vm, contract, direct_bob, 3)
    cov = contract.get_coverage(cid)
    assert cov["buyer"] == to_hex(direct_bob)
    assert cov["listing_id"] == "l1"
    assert cov["periods"] == 3
    assert cov["checks_done"] == 0
    assert cov["status"] == "active"


def test_buy_coverage_rejects_wrong_payment(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    direct_vm.value = PRICE * 3 + 1
    with direct_vm.expect_revert("Exact payment required"):
        contract.buy_coverage("l1", 3)


def test_buy_coverage_rejects_inactive_listing(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    contract.deactivate_listing("l1")
    direct_vm.sender = direct_bob
    direct_vm.value = PRICE
    with direct_vm.expect_revert("Listing is not active"):
        contract.buy_coverage("l1", 1)


def test_only_provider_can_deactivate(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only provider"):
        contract.deactivate_listing("l1")


# ── run_check (consensus probe) ──────────────────────────────────────────


def test_run_check_pass(direct_vm, contract, direct_alice, direct_bob, direct_charlie):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 2)
    _mock_endpoint(direct_vm, status=200)

    direct_vm.sender = direct_charlie  # permissionless keeper
    result = contract.run_check("c1")

    assert result["up"] is True
    assert result["status_class"] == "200xx"
    assert result["period"] == 0
    cov = contract.get_coverage("c1")
    assert cov["checks_done"] == 1
    assert cov["checks_failed"] == 0
    listing = contract.get_listing("l1")
    assert listing["checks_done"] == 1
    assert listing["checks_passed"] == 1
    assert listing["bond"] == BOND  # no penalty on pass


def test_run_check_down_5xx_applies_penalty(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 2)
    _mock_endpoint(direct_vm, status=503)

    result = contract.run_check("c1")

    assert result["up"] is False
    assert result["status_class"] == "500xx"
    cov = contract.get_coverage("c1")
    assert cov["checks_failed"] == 1
    # penalty = price // 2 moved from bond to buyer's refund pool
    assert cov["penalties"] == PRICE // 2
    listing = contract.get_listing("l1")
    assert listing["bond"] == BOND - PRICE // 2
    assert listing["checks_passed"] == 0


def test_run_check_4xx_counts_as_down(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 1)
    _mock_endpoint(direct_vm, status=404)

    result = contract.run_check("c1")
    assert result["up"] is False
    assert result["status_class"] == "400xx"


def test_run_check_past_all_periods_reverts(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 1)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")
    with direct_vm.expect_revert("All periods already checked"):
        contract.run_check("c1")


def test_run_check_on_settled_coverage_reverts(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 1)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")
    contract.settle("c1")
    with direct_vm.expect_revert("Coverage is settled"):
        contract.run_check("c1")


# ── settlement ───────────────────────────────────────────────────────────


def test_settle_splits_escrow(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 3)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")  # pass
    _mock_endpoint(direct_vm, status=500)
    contract.run_check("c1")  # fail → penalty
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")  # pass

    summary = contract.settle("c1")

    assert summary["checks_passed"] == 2
    assert summary["checks_failed"] == 1
    assert summary["provider_earn"] == 2 * PRICE
    assert summary["buyer_refund"] == PRICE + PRICE // 2  # failed period + penalty
    cov = contract.get_coverage("c1")
    assert cov["status"] == "settled"


def test_settle_requires_all_periods_checked(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 3)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")
    with direct_vm.expect_revert("Not all periods checked yet"):
        contract.settle("c1")


def test_settle_twice_reverts(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 1)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")
    contract.settle("c1")
    with direct_vm.expect_revert("Coverage is settled"):
        contract.settle("c1")


# ── early cancel ─────────────────────────────────────────────────────────


def test_cancel_coverage_refunds_remaining(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 5)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")

    summary = contract.cancel_coverage("c1")

    assert summary["provider_earn"] == PRICE
    assert summary["buyer_refund"] == 4 * PRICE
    assert contract.get_coverage("c1")["status"] == "settled"


def test_only_buyer_can_cancel_coverage(direct_vm, contract, direct_alice, direct_bob, direct_charlie):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 5)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only buyer"):
        contract.cancel_coverage("c1")


def test_cancel_coverage_refunds_penalties_from_bond(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 5)
    _mock_endpoint(direct_vm, status=500)
    contract.run_check("c1")  # fail → penalty moves to coverage

    summary = contract.cancel_coverage("c1")

    # 4 unchecked periods refunded + failed period refunded + penalty from bond
    assert summary["buyer_refund"] == 4 * PRICE + PRICE + PRICE // 2
    assert contract.get_listing("l1")["bond"] == BOND - PRICE // 2


# ── bond return ──────────────────────────────────────────────────────────


def test_cancel_listing_returns_bond(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 1)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")
    contract.settle("c1")

    direct_vm.sender = direct_alice
    contract.cancel_listing("l1")
    assert contract.get_listing("l1")["bond"] == 0
    assert contract.get_listing("l1")["active"] is False


def test_cancel_listing_blocked_with_active_coverage(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 2)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Listing has active coverages"):
        contract.cancel_listing("l1")


def test_cancel_listing_twice_reverts(direct_vm, contract, direct_alice):
    _create_listing(direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    contract.cancel_listing("l1")
    with direct_vm.expect_revert("Bond already returned"):
        contract.cancel_listing("l1")


# ── history & stats views ────────────────────────────────────────────────


def test_get_checks_returns_history_in_order(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 3)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")
    _mock_endpoint(direct_vm, status=500)
    contract.run_check("c1")

    checks = contract.get_checks("c1")
    assert [c["period"] for c in checks] == [0, 1]
    assert [c["up"] for c in checks] == [True, False]
    assert checks[1]["status_class"] == "500xx"


def test_stats_accumulate(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 2)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")
    _mock_endpoint(direct_vm, status=503)
    contract.run_check("c1")
    contract.settle("c1")

    stats = contract.get_stats()
    assert stats["listings"] == 1
    assert stats["coverages"] == 1
    assert stats["total_checks"] == 2
    assert stats["total_checks_passed"] == 1


def test_uptime_bps_computed_from_listing_stats(direct_vm, contract, direct_alice, direct_bob):
    _create_listing(direct_vm, direct_alice)
    _buy(direct_vm, contract, direct_bob, 2)
    _mock_endpoint(direct_vm, status=200)
    contract.run_check("c1")
    _mock_endpoint(direct_vm, status=500)
    contract.run_check("c1")
    listing = contract.get_listing("l1")
    assert listing["uptime_bps"] == 5000  # 1 of 2 checks passed
