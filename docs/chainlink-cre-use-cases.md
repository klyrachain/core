# Chainlink CRE — Use Cases That Meaningfully Improve Our System

This doc lists only the cases where **adopting CRE would make the system dependent on it** for a clear benefit (trustless verification, decentralized automation, or cross-chain). If our current backend can handle the need, CRE is not listed.

---

## 1. Decentralized offramp verification

**Why CRE greatly improves:** Today we verify the user’s transfer to the pool in our backend (block timestamp, ERC20 transfer). That makes verification a single point of trust. CRE can run the same checks in a decentralized workflow: no single server has to be trusted for “did the user actually send to the pool?”

**When the system becomes dependent on CRE:** When you want **verification to be trustless** and auditable (e.g. dispute resolution, compliance, or multi-operator pools where no one party should be the sole verifier).

**How to go about it:**

1. **CRE project:** `cre init`, then add an EVM log trigger for your pool contract’s `Transfer` (or custom) events.
2. **Trigger:** Listen for `Transfer(token, from, to, value)` where `to` is the pool address. Decode event and compare `value` and `token` to the offramp order (e.g. order id or amount in calldata/storage).
3. **Verification logic in CRE:** In the workflow handler, fetch order details (from your API or from chain) and check: `value >= order.expectedAmountWei`, `token === order.poolToken`, block timestamp >= order creation time (replay protection). Optionally call an on-chain “attestation” contract that records “order X verified at block N.”
4. **EVM Write:** If you use an on-chain attestation contract, use CRE’s EVM Write to submit the attestation; your backend (or another CRE workflow) can then allow payout only when attestation exists.
5. **Deploy:** Configure `config.json` with chain and contract addresses; run with `cre workflow simulate` then deploy to a CRE node so verification runs in a decentralized way.

**Dependency:** Once you require an on-chain attestation (or a multi-sig that trusts only CRE output), the system **depends on CRE** for offramp verification.

---

## 2. On-chain request/claim settlement (escrow release)

**Why CRE greatly improves:** Today request/claim is off-chain: we mark transaction COMPLETED and notify the recipient; claim is a DB update. If you move to **on-chain escrow** (payer locks funds in a contract until payment is confirmed, then recipient can claim), you need something to **observe “payment confirmed” and release**. CRE is built for that: event-driven, transparent, and executable on-chain.

**When the system becomes dependent on CRE:** When settlement is **on-chain** (e.g. escrow contract holds USDC; release is a contract call). The trigger for “payment confirmed” could be an off-chain signal (e.g. your API) or an on-chain event; CRE runs the release logic so the system depends on CRE for timely, correct settlement.

**How to go about it:**

1. **Escrow contract:** Deploy a contract that: holds funds for a request, exposes something like `releaseClaim(requestId)` (or claimId), and optionally emits `ClaimReleased(claimId)`.
2. **Trigger options:**  
   - **Option A:** CRE listens for an on-chain “payment confirmed” event (if you post it from your backend or Paystack webhook path).  
   - **Option B:** Use a CRE HTTP trigger that your backend calls when Paystack (or your flow) confirms payment; the workflow then reads claim/request id and calls the contract.
3. **Workflow:** On trigger, (1) validate that the request is in a “paid” state (e.g. call your API or read from chain), (2) call escrow’s `releaseClaim(claimId)` via EVM Write. CRE’s execution is logged and on-chain, so settlement is auditable.
4. **Idempotency:** Contract should enforce “only release once” (e.g. state flag or revert on double-call). CRE workflow can be idempotent by checking contract state before calling release.
5. **Dependency:** Once you lock funds in escrow and only CRE (or a contract triggered by CRE) can release, the system **depends on CRE** for request/claim settlement.

---

## 3. Proof-of-reserve / liquidity transparency

**Why CRE greatly improves:** We have a liquidity pool and inventory. Users/partners have no way to **independently verify** that we hold enough reserves. CRE’s PoR pattern (periodic fetch → validate → sign → publish) gives a verifiable, tamper-resistant proof without trusting our API alone.

**When the system becomes dependent on CRE:** When you **commit to publishing PoR** (e.g. on-chain or to a public endpoint) and stakeholders rely on it for trust or risk decisions. Then the system depends on CRE (or an equivalent decentralized prover) to keep that promise.

**How to go about it:**

1. **CRE project:** Use a **periodic (cron) or HTTP trigger** that runs on a schedule (e.g. every hour).
2. **Fetch:** Use CRE’s HTTP capability to call your internal balance API or read chain state (pool balance, token holdings). If you don’t expose balances publicly, you’d need a signed or authenticated endpoint that CRE can call (or read directly from chain).
3. **Validate and sign:** In the workflow, compute totals (e.g. “USDC on Base”, “inventory by token”), build a structured proof (e.g. JSON with balances + timestamp), and sign it with a CRE-managed key (or use a threshold signer).
4. **Publish:** Submit the signed proof on-chain (e.g. to a “PoR registry” contract via EVM Write) or POST to a public URL. Chainlink’s PoR docs describe storing proof in a contract for transparency.
5. **Dependency:** Once you advertise “reserves are proven by CRE” and others rely on it, the system **depends on CRE** for that guarantee.

---

## 4. Cross-chain liquidity or state automation

**Why CRE greatly improves:** We have `f_chain` / `t_chain` (e.g. Base). If we add **cross-chain** flows (e.g. rebalancing liquidity, or “when pool on Chain A is low, bridge from Chain B”), doing that in a single backend is a single point of failure and trust. CRE with **CCIP** can run the same logic in a decentralized way: listen to chain A, optionally pull data via HTTP, then trigger a CCIP message or on-chain action on chain B.

**When the system becomes dependent on CRE:** When **cross-chain actions** (e.g. bridge, rebalance, or state sync) are required for correct operation and you want them to be **decentralized and verifiable**. Then the system depends on CRE (and CCIP) for those steps.

**How to go about it:**

1. **CRE + CCIP:** Use CRE’s CCIP capability (see Chainlink docs for CCIP selectors and router addresses). Configure source and destination chain selectors.
2. **Trigger:** EVM log on chain A (e.g. “PoolBalanceBelowThreshold”) or a periodic trigger that reads pool balance on A.
3. **Workflow:** (1) Confirm condition (e.g. balance < threshold), (2) Optionally call your API to get amount to bridge, (3) Send CCIP message or trigger a bridge contract on chain B. CRE handles the cross-chain call.
4. **Dependency:** Once rebalance or liquidity moves only via CRE/CCIP, the system **depends on CRE** for that cross-chain automation.

---

## Summary

| Use case                       | Current system                         | CRE dependency / benefit                          |
|--------------------------------|----------------------------------------|---------------------------------------------------|
| Offramp verification           | Backend verifies tx + block timestamp | Trustless, decentralized verifier               |
| Request/claim settlement       | DB + notifications                     | On-chain escrow release via CRE                   |
| Proof-of-reserve               | None                                   | Verifiable reserve proof                          |
| Cross-chain automation         | N/A (single chain today)               | Decentralized rebalance/bridge when you add it    |

Only adopt CRE where you want the system to **rely on** that decentralized behavior; otherwise the existing backend is sufficient.
