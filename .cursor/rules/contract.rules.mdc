# Solidity & Smart Contract Rules

## Overview

Smart contracts are immutable and often handle high-value assets. Unlike the frontend or backend, **you cannot "hotfix" a bug on the blockchain.** Code must be perfect before deployment. Security is paramount; gas efficiency is secondary but critical.

---

## 1. Security First (The "Red Lines")

### A. Reentrancy Protection

- **Mandatory:** Use `ReentrancyGuard` (from OpenZeppelin) on all external functions that transfer ETH or tokens.
- **Pattern:** Always follow the **Checks-Effects-Interactions** pattern.
  - _Bad:_ Transfer funds -> Update balance.
  - _Good:_ Update balance -> Transfer funds.

### B. Access Control

- **Explicit Visibility:** Every function must have an explicit visibility specifier (`public`, `external`, `internal`, `private`). Default visibility is forbidden.
- **Owner/Role Management:**
  - Use `Ownable` for simple contract ownership.
  - Use `AccessControl` (RBAC) for complex systems with multiple roles (e.g., `MINTER_ROLE`, `PAUSER_ROLE`).
  - **Never** hardcode addresses. Pass them in the constructor.

### C. Arithmetic & Overflows

- **Solidity >= 0.8.0:** Arithmetic overflow/underflow checks are built-in. Do not use `SafeMath` unless using an older compiler version.
- **Unchecked Blocks:** Only use `unchecked { ... }` blocks if you are 100% certain an overflow is impossible (e.g., iterating a counter in a loop with a fixed bound) to save gas.

### D. Randomness

- **Forbidden:** Do not use `block.timestamp`, `block.number`, or `blockhash` for critical randomness (e.g., lottery winners). Validators can manipulate these values.
- **Solution:** Use **Chainlink VRF** (Verifiable Random Function) for secure on-chain randomness.

---

## 2. Gas Optimization (The "Green Lines")

### A. Data Storage

- **Packing:** Order your state variables to pack them into 256-bit slots.
  - _Bad:_ `uint128 a; uint256 b; uint128 c;` (Takes 3 slots)
  - _Good:_ `uint128 a; uint128 c; uint256 b;` (Takes 2 slots)
- **Constants & Immutable:**
  - Use `constant` for values known at compile time.
  - Use `immutable` for values set once in the constructor.
  - _Benefit:_ Saves gas by embedding values directly into the bytecode.

### B. Function Types

- **External vs Public:** Prefer `external` over `public` if the function is only called from outside. `external` functions can read arguments directly from calldata (cheaper) rather than copying to memory.
- **Calldata vs Memory:** Use `calldata` for read-only array/struct parameters in external functions.

### C. Loops & Arrays

- **Unbounded Loops:** **NEVER** loop over an array that can grow indefinitely (e.g., "Pay all users"). This will eventually hit the Block Gas Limit and lock the contract permanently.
  - _Solution:_ Use "Pull Payments" (users withdraw individually) or pagination.
- **Caching:** Cache storage variables in memory inside loops.
  - _Bad:_ `for (i=0; i<10; i++) { sum += stateVar; }` (Reads storage 10 times)
  - _Good:_ `uint temp = stateVar; for (...) { sum += temp; }` (Reads storage once)

---

## 3. Code Quality & Standards

### A. Style Guide

- **Naming:**
  - Contracts/Libraries: `PascalCase` (e.g., `MarketPlace`).
  - Functions/Variables: `camelCase` (e.g., `transferFrom`).
  - Constants: `UPPER_CASE` (e.g., `MAX_SUPPLY`).
  - Private/Internal Variables: Prepend with underscore `_` (e.g., `_balances`).
- **Interfaces:** Define interactions via Interfaces (`IMarketPlace.sol`). Do not import the full contract implementation unless inheriting.

### B. Error Handling

- **Custom Errors:** Use `error InsufficientFunds();` instead of `require(cond, "Insufficient Funds")`.
  - _Why:_ Custom errors save gas and are easier to catch/parse on the frontend.
- **Checks:**
  - Use `require` for input validation and state preconditions.
  - Use `assert` only for checking internal invariants (things that should _never_ happen).

### C. Events

- **Emit Everything:** Emit an event for every state-changing operation (e.g., `OrderCreated`, `TokensStaked`).
- **Indexing:** Index up to 3 parameters (`indexed address user`) to allow efficient off-chain filtering and querying (The Graph/subgraphs rely on this).

---

## 4. Testing & Deployment (Foundry/Hardhat)

### A. Testing Strategy

- **Unit Tests:** 100% coverage of all public functions.
- **Fuzz Testing:** Mandatory. Use Foundry (`forge test`) to bombard functions with random inputs to find edge cases.
- **Fork Testing:** Run tests against a mainnet fork to simulate interactions with real DeFi protocols (Uniswap, Aave) in their current state.

### B. Deployment Safety

- **Scripts:** Deployment must be scripted (e.g., `Deploy.s.sol`), not manual.
- **Verification:** Source code must be verified on Etherscan/PolygonScan immediately after deployment.
- **Proxy Pattern:** For upgradeable contracts, use the **UUPS** (Universal Upgradeable Proxy Standard) pattern over Transparent Proxies for better gas efficiency.

---

## 5. Third-Party Integrations

- **OpenZeppelin:** Always use standard, audited implementations for ERC20, ERC721, and security utilities. **Do not reinvent the wheel.**
- **Oracles:** When using Chainlink Price Feeds, always check for "stale data" (timestamp check) to ensure the price is fresh.
