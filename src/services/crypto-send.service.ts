/**
 * Send crypto from liquidity pool wallet to a recipient. Used for onramp (after Paystack success)
 * and for request/claim settlement.
 *
 * - sendTestnetBaseSepoliaUsdc: REAL on-chain transfer. Uses TESTNET_SEND_PRIVATE_KEY and
 *   Base Sepolia USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e). Called when ONRAMP_TESTNET_SEND is set.
 * - sendFromLiquidityPool: mainnet path; currently stubbed (no RPC) and returns a mock hash.
 */

import { createWalletClient, getAddress, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { WalletManager } from "../utils/wallet-manager.js";
import { prisma } from "../lib/prisma.js";
import { getEnv } from "../config/env.js";

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** Base Sepolia USDC (Circle testnet). */
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const BASE_SEPOLIA_USDC_DECIMALS = 6;

export type SendFromLiquidityPoolInput = {
  walletId: string;
  toAddress: string;
  chain: string;
  tokenSymbol: string;
  tokenAddress: string;
  amountHuman: string | number;
  decimals: number;
  transactionId: string;
};

export type SendFromLiquidityPoolResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string };

/**
 * Mainnet send: stub only (no RPC). For real onramp sends use ONRAMP_TESTNET_SEND + sendTestnetBaseSepoliaUsdc.
 */
export async function sendFromLiquidityPool(
  input: SendFromLiquidityPoolInput
): Promise<SendFromLiquidityPoolResult> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: input.walletId },
    select: { encryptedKey: true, address: true },
  });
  if (!wallet?.encryptedKey) {
    return { ok: false, error: "Liquidity pool wallet or key not found" };
  }
  try {
    WalletManager.decrypt(wallet.encryptedKey);
  } catch {
    return { ok: false, error: "Failed to decrypt wallet key" };
  }
  const mockTxHash = `0x${Buffer.from(`${input.transactionId}-${Date.now()}`).toString("hex").slice(0, 64)}`;
  return { ok: true, txHash: mockTxHash };
}

export type SendTestnetBaseSepoliaUsdcResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string };

export type SendTestnetBaseSepoliaEthResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string };

/**
 * Executes a real on-chain transfer: native ETH on Base Sepolia from TESTNET_SEND_PRIVATE_KEY wallet to recipient.
 * amountEthHuman is in ETH (e.g. 0.01). For "amount in USD" the caller should convert using TESTNET_ETH_USD_RATE before calling.
 */
export async function sendTestnetBaseSepoliaEth(
  toAddress: string,
  amountEthHuman: string | number,
  _transactionId: string
): Promise<SendTestnetBaseSepoliaEthResult> {
  const env = getEnv();
  const raw = env.TESTNET_SEND_PRIVATE_KEY?.trim();
  const rpcUrl = env.BASE_SEPOLIA_RPC_URL?.trim() || "https://sepolia.base.org";
  if (!raw) {
    return { ok: false, error: "TESTNET_SEND_PRIVATE_KEY not set in .env (restart the server after adding it)" };
  }
  const hexPart = raw.toLowerCase().startsWith("0x") ? raw.slice(2).trim() : raw;
  if (!/^[0-9a-f]{64}$/i.test(hexPart)) {
    return { ok: false, error: "TESTNET_SEND_PRIVATE_KEY must be 64 hex characters (with or without 0x prefix)" };
  }
  const pk: `0x${string}` = `0x${hexPart}` as `0x${string}`;
  const valueWei = parseUnits(String(amountEthHuman), 18);
  if (valueWei <= 0n) {
    return { ok: false, error: "Amount must be positive" };
  }
  let to: `0x${string}`;
  try {
    to = getAddress(toAddress.trim());
  } catch {
    return { ok: false, error: "Invalid recipient address" };
  }
  try {
    const account = privateKeyToAccount(pk);
    const transport = http(rpcUrl);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport,
    });
    const hash = await walletClient.sendTransaction({
      to,
      value: valueWei,
    });
    if (!hash) return { ok: false, error: "No tx hash returned" };
    return { ok: true, txHash: hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Base Sepolia ETH send failed: ${msg}` };
  }
}

function normalizePk(raw: string): `0x${string}` | { ok: false; error: string } {
  const hexPart = raw.toLowerCase().startsWith("0x") ? raw.slice(2).trim() : raw.trim();
  if (!/^[0-9a-f]{64}$/i.test(hexPart)) {
    return { ok: false, error: "Private key must be 64 hex characters (with or without 0x prefix)" };
  }
  return `0x${hexPart}` as `0x${string}`;
}

async function sendBaseSepoliaUsdcWithPrivateKey(
  privateKeyHex: string,
  toAddress: string,
  amountHuman: string | number
): Promise<SendTestnetBaseSepoliaUsdcResult> {
  const rpcUrl = getEnv().BASE_SEPOLIA_RPC_URL?.trim() || "https://sepolia.base.org";
  const pk = normalizePk(privateKeyHex);
  if (typeof pk !== "string") {
    return pk;
  }
  const amount = parseUnits(String(amountHuman), BASE_SEPOLIA_USDC_DECIMALS);
  if (amount <= 0n) {
    return { ok: false, error: "Amount must be positive" };
  }
  let to: `0x${string}`;
  try {
    to = getAddress(toAddress.trim());
  } catch {
    return { ok: false, error: "Invalid recipient address" };
  }
  try {
    const account = privateKeyToAccount(pk as `0x${string}`);
    const transport = http(rpcUrl);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport,
    });
    const hash = await walletClient.writeContract({
      address: BASE_SEPOLIA_USDC,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [to, amount],
    });
    if (!hash) return { ok: false, error: "No tx hash returned" };
    return { ok: true, txHash: hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Base Sepolia send failed: ${msg}` };
  }
}

/**
 * Executes a real on-chain transfer: Base Sepolia USDC from TESTNET_SEND_PRIVATE_KEY wallet to recipient.
 * Called after payment when ONRAMP_TESTNET_SEND is set (any non-empty value except "0" or "false").
 */
export async function sendTestnetBaseSepoliaUsdc(
  toAddress: string,
  amountHuman: string | number,
  _transactionId: string
): Promise<SendTestnetBaseSepoliaUsdcResult> {
  const raw = getEnv().TESTNET_SEND_PRIVATE_KEY?.trim();
  if (!raw) {
    return { ok: false, error: "TESTNET_SEND_PRIVATE_KEY not set in .env (restart the server after adding it)" };
  }
  return sendBaseSepoliaUsdcWithPrivateKey(raw, toAddress, amountHuman);
}

/**
 * Peer-ramp onramp: send USDC from the **escrow** wallet (PEER_RAMP_PLATFORM_ESCROW_ADDRESS) to the onramp user.
 * Uses PEER_RAMP_ESCROW_SENDER_PRIVATE_KEY if set, else TESTNET_SEND_PRIVATE_KEY; the signer MUST match the escrow address.
 */
export async function sendPeerRampOnrampUsdcFromEscrowWallet(
  toUserAddress: string,
  amountHuman: string | number
): Promise<SendTestnetBaseSepoliaUsdcResult> {
  const env = getEnv();
  const escrowConfigured = env.PEER_RAMP_PLATFORM_ESCROW_ADDRESS?.trim();
  if (!escrowConfigured?.startsWith("0x") || escrowConfigured.length !== 42) {
    return {
      ok: false,
      error:
        "PEER_RAMP_PLATFORM_ESCROW_ADDRESS must be set (0x + 40 hex) so the platform can send USDC from escrow to the user.",
    };
  }
  const raw =
    env.PEER_RAMP_ESCROW_SENDER_PRIVATE_KEY?.trim() || env.TESTNET_SEND_PRIVATE_KEY?.trim();
  if (!raw) {
    return {
      ok: false,
      error:
        "Set PEER_RAMP_ESCROW_SENDER_PRIVATE_KEY or TESTNET_SEND_PRIVATE_KEY to the escrow wallet private key.",
    };
  }
  const pk = normalizePk(raw);
  if (typeof pk !== "string") {
    return pk;
  }
  let signerAddr: string;
  try {
    signerAddr = getAddress(privateKeyToAccount(pk as `0x${string}`).address);
  } catch {
    return { ok: false, error: "Invalid escrow private key" };
  }
  const escrow = getAddress(escrowConfigured);
  if (signerAddr.toLowerCase() !== escrow.toLowerCase()) {
    return {
      ok: false,
      error:
        "Escrow private key does not match PEER_RAMP_PLATFORM_ESCROW_ADDRESS. Use PEER_RAMP_ESCROW_SENDER_PRIVATE_KEY for the escrow EOA, or set TESTNET_SEND_PRIVATE_KEY to that same key.",
    };
  }
  return sendBaseSepoliaUsdcWithPrivateKey(raw, toUserAddress, amountHuman);
}
