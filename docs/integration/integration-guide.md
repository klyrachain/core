# Core integration guide

How to integrate with **Core** (this service): public endpoints, user flows, and where chains/tokens come from.

---

## Chains and tokens

- **Source of truth:** Core stores chains and tokens in its own DB. They are seeded from the external Klyra backend (see [klyra-backend-api.md](./klyra-backend-api.md)) via:

  ```bash
  pnpm run db:seed-chains-tokens
  ```

- **Display symbols:** Tokens use a composite symbol for display and lookup, e.g. `BASE USDC`, `ETHEREUM MANA`. Resolving a symbol to `chainId` + token address is done **only inside core** using `SupportedToken` and `Chain`.

---

## Public API endpoints

Base URL: your Core instance (e.g. `https://core.example.com`).

### GET /api/chains

- **Auth:** None (public).
- **Response:** `{ success: true, data: { chains: [{ id, chainId, name, chainIconURI }] } }`
- Use for: listing supported networks in the app.

### GET /api/tokens

- **Auth:** None (public).
- **Query:** `chain_id` (optional) — filter by chain ID.
- **Response:** `{ success: true, data: { tokens: [{ id, chainId, networkName, chainIconURI, address, symbol, decimals, name, logoURI, fonbnkCode, displaySymbol }] } }`
- **displaySymbol:** Composite form, e.g. `BASE USDC`, for UI and for resolving to chainId + address in core.

---

## User stories and flows

1. **List networks and tokens**  
   Call `GET /api/chains` and `GET /api/tokens` (optionally with `?chain_id=8453`). Show `displaySymbol` in the UI so users see e.g. “Base USDC” instead of just “USDC”.

2. **Onramp quote (fiat → crypto)**  
   User selects a target token (e.g. `BASE USDC`). Core resolves `displaySymbol` → chainId + token address, then gets a quote (Fonbnk direct or fiat → USDC → swap for unsupported tokens). See onramp/quote and onramp/execution routes.

3. **Pay a request (fiat or crypto)**  
   Request creation and “make a payment” flows use core’s request/claim APIs. Payout can be crypto (to wallet) or claim (code + OTP). Settlement emails include the crypto tx hash as a block-explorer link.

4. **Balances and swaps**  
   Core uses stored `Chain.rpcUrl` (when present) and token addresses for balance checks and swap routing. Symbol resolution is always from core DB.

---

## Testing

- **Quote test script (planned):** A script that loads tokens from the DB and requests quotes for representative or all tokens to verify the onramp path (direct or swap) works.
- **E2E:** Use `pnpm run e2e:cli` and `pnpm run e2e:cli:requests-claims` for full flows.
