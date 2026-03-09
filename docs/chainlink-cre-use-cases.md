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

---

## Review: How Strong Is the CRE Dependency?

Honest assessment of the four use cases above: **how Chainlink-dependent** are they? If we built them with CRE and then had to switch to a regular or self-built system, would it be a **dire** situation?

| Use case | Strength of CRE dependency | Why switching away would be dire (or not) |
|----------|----------------------------|-------------------------------------------|
| **1. Offramp verification** | **Strong** | Once verification is gated by an **on-chain attestation** (only CRE or a CRE-triggered contract can write it), the whole trust model rests on “who can attest?” Replacing CRE with a self-built verifier means either (a) running your own oracle/signer set (operational burden, less credibility) or (b) going back to backend-only verification (single point of trust, no dispute-resolution guarantee). So **yes—dependency is real**; switching away forces a real architectural and trust downgrade. |
| **2. Request/claim settlement (escrow)** | **Strong** | Escrow release is **on-chain** and only CRE (or a contract triggered by CRE) can call `releaseClaim`. If you remove CRE, you must either (a) build another decentralized automation layer with similar guarantees (hard, custom) or (b) give a single backend the key to release—which defeats the purpose of on-chain escrow. **Dire** in the sense that the “trustless settlement” promise goes away without CRE (or an equivalent). |
| **3. Proof-of-reserve** | **Strong** | The value is **verifiable, signed proof** that third parties can check without trusting our API. A self-built PoR is just “our server says so.” So the **trust guarantee** is what depends on CRE (or another decentralized prover). Switching to a regular system = back to “we say we have the reserves,” which is weak for partners and compliance. **Dependency is strong** for the attestable guarantee. |
| **4. Cross-chain automation** | **Strong when used** | If we don’t do cross-chain, N/A. If we do (rebalance, bridge, state sync), CRE + CCIP is the orchestration layer. Replacing it means building custom cross-chain automation (messaging, security, replay protection) or recentralizing. So **strong** where cross-chain is required. |

**Bottom line:** All four use cases are **genuinely Chainlink-dependent** in the sense that the benefit (trustless verification, on-chain settlement, verifiable PoR, decentralized cross-chain) **cannot be preserved** by simply swapping CRE for a “regular” or self-built backend. Switching would either restore a single point of trust or require rebuilding equivalent decentralized infrastructure. So they are solid choices for “CRE as a real dependency,” not just nice-to-have.

---

## Hackathon track alignment (DeFi, Risk & Compliance, Privacy)

The following extensions tie our existing use cases to the **DeFi & Tokenization**, **Risk & Compliance**, and **Privacy** tracks. They **add** to the use cases above rather than replace them.

### DeFi & Tokenization (e.g. Custom PoR Data Feed, tokenized flows)

- **Custom Proof of Reserve Data Feed**  
  Our **Proof-of-reserve** (section 3) fits the “Custom Proof of Reserve Data Feed” idea: CRE periodically fetches pool/inventory balances (from chain or a protected API), validates, signs, and publishes. We can expose this as a **data feed** (on-chain or public endpoint) so partners and UIs consume “proven” reserve data instead of our API alone. That makes the system **dependent on CRE** for the integrity of that feed.

- **Tokenized asset servicing / lifecycle**  
  Request/claim and offramp flows are “token in → fiat out” or “fiat in → token out.” If we add **tokenized asset servicing** (e.g. locking/unlocking, vesting, or lifecycle events), CRE can be the layer that observes conditions (on-chain or from an API) and triggers the next step (e.g. release from escrow, update state). Dependency: once those transitions are gated by CRE, the lifecycle **depends on CRE** for correct, auditable execution.

### Risk & Compliance (monitoring, reserve health, safeguards)

- **Real-time reserve health checks**  
  Extend **Proof-of-reserve** with **continuous monitoring**: CRE workflow runs on a schedule (or on event), fetches pool + inventory balances, and checks against policy (e.g. “USDC on Base &gt; X,” “total inventory &gt; Y”). On breach, CRE can (1) post an on-chain or internal “reserve unhealthy” signal, (2) call a **safeguard** (e.g. pause offramp contract or notify operators). The system then **depends on CRE** for both the health check and the trigger.

- **Protocol safeguard triggers**  
  Same idea: CRE is the **orchestration layer** that watches real-world or on-chain conditions (reserves, failed payments, fraud signals from an API) and triggers predefined responses (pause, cap, alert, or rebalance). Without CRE, you’d need a trusted backend to do the same—so the **automated, verifiable safeguard** is CRE-dependent.

- **Automated risk monitoring**  
  CRE can consume internal or external APIs (e.g. exposure by chain/token, large pending requests) and either publish risk metrics (e.g. to a feed) or trigger mitigations. Dependency: if compliance or operators **rely on** this automated monitoring for decisions, the system depends on CRE for that layer.

### Privacy (Confidential HTTP, private flows)

- **Secure Web2 API integration**  
  We use Paystack, Fonbnk, Moolre, etc. CRE’s **Confidential HTTP** lets a workflow call these APIs **without exposing API keys or sensitive request/response data** onchain or in public logs. The workflow runs offchain; only outcomes (e.g. “payment confirmed,” “quote received”) need to be used onchain. Dependency: if we move “confirm payment” or “get quote” into CRE and strip credentials from the chain, **secure API use** depends on CRE’s confidential execution.

- **Private treasury / fund operations**  
  Internal moves (e.g. rebalancing between pools, treasury operations) can be executed via CRE with **Confidential Compute** so that detailed amounts and counterparties are not fully visible onchain, while withdrawals to public contracts remain possible. Dependency: if we commit to “internal flows are private and only CRE can execute them,” switching to a normal backend would expose those flows or require a new privacy layer.

- **OTC / brokered settlements**  
  For negotiated or OTC-style settlements (e.g. large offramps, partner payouts), CRE can coordinate settlement **offchain** and execute private payments so that individual recipients and amounts aren’t public. Again, the **privacy guarantee** is CRE-dependent (or dependent on another confidential execution layer).

These track-aligned items are **additions**: they don’t replace sections 1–4 but show how the same CRE workflows (verification, settlement, PoR, cross-chain) can be extended into DeFi/tokenization, risk/compliance, and privacy in a way that keeps CRE as a real dependency.

---

## Why not CRE for routine inventory/balance updates?

**Question:** Use CRE to get the “proper” balance for the onramp/offramp wallet and update inventory accordingly?

**Answer:** The **current system can sustain itself**. Inventory is stored in the DB; balances are synced to Redis for validation (e.g. `syncAllInventoryBalancesToRedis`). You can refresh balances from chain (or from your own DB) on a schedule or on demand. That’s enough for quote validation and “do we have enough to send?” checks. CRE does **not** become a necessary dependency for that.

CRE **does** help when you want **verifiable** balance reporting: see **Proof-of-reserve** (section 3). There, CRE fetches balances (from chain or your API), signs a proof, and publishes it so others can verify reserves without trusting your backend. That’s a separate use case from “update our internal inventory so we can process orders.” So: use the current DB + Redis + optional balance-refresh for day-to-day inventory; consider CRE only when you want **attestable, trustless** reserve proofs (section 3).
