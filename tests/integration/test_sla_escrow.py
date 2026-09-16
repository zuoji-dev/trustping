"""Integration tests for TrustPingEscrow on GenLayer Studio Devnet.

These run the real consensus pipeline (leader + independent validator
re-probe) against the hosted studio-next network and a real HTTP
endpoint. They are slow (minutes) and spend a small fee deposit per
transaction — that is the point: they exercise the same path production
traffic takes.

Every transaction carries a fee deposit estimated live from the network
(Consensus v0.6 fee model), including message allocations for child
messages such as settlement transfers.

Run with:
    gltest tests/integration/test_sla_escrow.py -v -s
"""

import os
import urllib.request

import pytest
from gltest import get_contract_factory, create_account, get_gl_client
from gltest.assertions import is_successful

STUDIO_DEV_RPC = os.environ.get(
    "GLTEST_STUDIO_RPC", "https://studio-next.genlayer.com/api"
)


def fund_dev_account(address: str, amount_wei: int = 50 * 10**18) -> None:
    """Fund a test account via the studio-dev simulator faucet — the RPC
    equivalent of the 💧 Fund account button in the Studio web UI."""
    payload = (
        '{"jsonrpc":"2.0","id":1,"method":"sim_fundAccount",'
        f'"params":["{address}","{hex(amount_wei)}"]}}'
    ).encode()
    req = urllib.request.Request(
        STUDIO_DEV_RPC,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "trustping-integration-test/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        body = res.read().decode()
    if "error" in body:
        raise RuntimeError(f"faucet failed: {body}")


def fees_for(contract_address, function_name, args, value: int = 0) -> dict:
    """Build a fee deposit from the network's own live estimate."""
    client = get_gl_client()
    estimate = client.estimate_transaction_fees_for_write(
        address=contract_address,
        function_name=function_name,
        args=args,
        value=value,
    )
    fees: dict = {
        "distribution": estimate.get("distribution") or {},
        "feeValue": estimate.get("feeValue"),
    }
    if estimate.get("messageAllocations"):
        fees["messageAllocations"] = estimate["messageAllocations"]
    return fees


ENDPOINT = "https://example.com"
PRICE_ATTO = 10**17  # 0.1 GEN per period
BOND_ATTO = 10**18  # 1 GEN bond

# Baseline distribution; the fee deposit itself is computed by the chain's
# FeeManager from these allocations (see _resolve_transaction_fees).
DISTRIBUTION = {
    "leaderTimeunitsAllocation": "100",
    "validatorTimeunitsAllocation": "200",
    "appealRounds": "0",
    "executionBudgetPerRound": "25000000000000000",
    "executionConsumed": "0",
    "totalMessageFees": "0",
    "rotations": ["3"],
    "maxPriceGenPerTimeUnit": "2",
    "storageFeeMaxGasPrice": "300000000",
    "receiptFeeMaxGasPrice": "300000000",
}


@pytest.fixture(scope="module")
def sla_contract():
    """Deploy a fresh TrustPingEscrow and register one probeable listing."""
    factory = get_contract_factory("TrustPingEscrow")
    contract = factory.deploy(fees={"distribution": DISTRIBUTION})

    provider = create_account()
    fund_dev_account(provider.address)
    provider_contract = contract.connect(provider)

    listing_args = ["Example.com API", ENDPOINT, PRICE_ATTO]
    tx = provider_contract.create_listing(args=listing_args).transact(
        value=BOND_ATTO,
        fees=fees_for(contract.address, "create_listing", listing_args, BOND_ATTO),
    )
    assert is_successful(tx)
    return contract


def test_listing_state_after_create(sla_contract):
    listings = sla_contract.get_listings(args=[]).call()
    assert len(listings) >= 1
    listing = next(iter(listings.values()))
    assert listing["endpoint"] == ENDPOINT
    assert listing["active"] is True
    assert int(listing["bond"]) == BOND_ATTO


def test_consensus_probe_and_settlement(sla_contract):
    buyer = create_account()
    fund_dev_account(buyer.address)
    buyer_contract = sla_contract.connect(buyer)
    addr = sla_contract.address

    buy_args = ["l1", 2]
    tx = buyer_contract.buy_coverage(args=buy_args).transact(
        value=PRICE_ATTO * 2,
        fees=fees_for(addr, "buy_coverage", buy_args, PRICE_ATTO * 2),
    )
    assert is_successful(tx)

    coverages = sla_contract.get_coverages(args=[]).call()
    coverage_id = sorted(coverages.keys())[0]

    # The consensus probe: leader and validators independently fetch
    # https://example.com and must agree on the up verdict and status class.
    tx = buyer_contract.run_check(args=[coverage_id]).transact(
        fees=fees_for(addr, "run_check", [coverage_id])
    )
    assert is_successful(tx)

    checks = sla_contract.get_checks(args=[coverage_id]).call()
    assert len(checks) == 1
    assert checks[0]["up"] is True
    assert checks[0]["status_class"] == "200xx"

    # Complete the remaining period, then settle the escrow. Settle emits
    # transfer child messages, so its estimate carries message allocations.
    tx = buyer_contract.run_check(args=[coverage_id]).transact(
        fees=fees_for(addr, "run_check", [coverage_id])
    )
    assert is_successful(tx)

    tx = buyer_contract.settle(args=[coverage_id]).transact(
        fees=fees_for(addr, "settle", [coverage_id])
    )
    assert is_successful(tx)

    coverage = sla_contract.get_coverage(args=[coverage_id]).call()
    assert coverage["status"] == "settled"
    assert int(coverage["checks_failed"]) == 0
