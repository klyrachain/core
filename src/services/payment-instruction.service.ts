/**
 * Multi-ecosystem payment instructions for pool deposits (SELL / offramp-style).
 * EVM keeps ERC-20 transfer fields; other chains return structured payloads for wallets / UIs.
 */

import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";
import {
  ecosystemFromCoreChain,
  evmChainIdFromCoreChain,
  type PaymentEcosystem,
} from "../lib/payment-chain-routing.js";
import { getLiquidityPoolWallet } from "./liquidity-pool.service.js";
import { findPoolTokenFromDb } from "./supported-token.service.js";
import { resolvePlatformPoolDestination } from "./platform-pool-destination-resolve.service.js";
import { isNativeTokenAddress } from "../lib/native-token.js";

export type EvmErc20TransferInstruction = {
  kind: "evm_erc20_transfer";
  toAddress: string;
  chainId: number;
  chain: string;
  token: string;
  tokenAddress: string;
  amount: string;
  decimals: number;
  message: string;
};

export type SolanaSplTransferInstruction = {
  kind: "solana_spl_transfer";
  recipientAddress: string;
  mint: string;
  amountAtomic: string;
  decimals: number;
  message: string;
  memo?: string;
};

export type StellarPaymentInstruction = {
  kind: "stellar_payment";
  destination: string;
  amount: string;
  assetType: "native" | "credit_alphanum4" | "credit_alphanum12";
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  message: string;
};

export type BitcoinUtxoInstruction = {
  kind: "bitcoin_utxo";
  address: string;
  amountBtc: string;
  amountSats: string;
  message: string;
};

export type UnsupportedPaymentInstruction = {
  kind: "unsupported";
  chain: string;
  token: string;
  unsupportedReason: string;
  message: string;
};

export type PaymentInstruction =
  | EvmErc20TransferInstruction
  | SolanaSplTransferInstruction
  | StellarPaymentInstruction
  | BitcoinUtxoInstruction
  | UnsupportedPaymentInstruction;

export type PaymentInstructionBuildResult =
  | { ok: true; data: PaymentInstruction }
  | { ok: false; status: number; error: string };

function btcHumanToSats(human: string): string {
  try {
    const d = new Decimal(human);
    return d.mul(100_000_000).toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0);
  } catch {
    return "0";
  }
}

async function buildNonEvmFromDestination(
  f_chain: string,
  f_token: string,
  amountStr: string,
  ecosystem: PaymentEcosystem
): Promise<PaymentInstruction | null> {
  const resolved = await resolvePlatformPoolDestination(ecosystem, f_chain, f_token);
  if (!resolved) return null;

  const poolAddr = resolved.resolvedReceiveAddress;

  if (ecosystem === "SOLANA") {
    const mint = resolved.tokenContractAddress?.trim();
    if (!mint) {
      return {
        kind: "unsupported",
        chain: f_chain,
        token: f_token,
        unsupportedReason: "Solana pool row missing tokenContractAddress (mint).",
        message: "Configure PlatformPoolDestination.tokenContractAddress for this mint.",
      };
    }
    const decimals = 9;
    let amountAtomic: string;
    try {
      amountAtomic = new Decimal(amountStr).mul(new Decimal(10).pow(decimals)).toFixed(0);
    } catch {
      amountAtomic = "0";
    }
    return {
      kind: "solana_spl_transfer",
      recipientAddress: poolAddr,
      mint,
      amountAtomic,
      decimals,
      message: "Send SPL token to recipientAddress (pool). Automatic confirm is not enabled for Solana yet.",
    };
  }

  if (ecosystem === "STELLAR") {
    const issuer = resolved.stellarAssetIssuer?.trim() || undefined;
    const code = (resolved.stellarAssetCode ?? f_token).trim().toUpperCase();
    const native = !issuer && (code === "XLM" || code === "NATIVE");
    return {
      kind: "stellar_payment",
      destination: poolAddr,
      amount: amountStr,
      assetType: native ? "native" : code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
      ...(!native ? { assetCode: code, assetIssuer: issuer } : { assetCode: "XLM" }),
      message:
        "Submit a Stellar payment to destination for amount. Automatic confirm is not enabled for Stellar yet.",
    };
  }

  if (ecosystem === "BITCOIN") {
    return {
      kind: "bitcoin_utxo",
      address: poolAddr,
      amountBtc: amountStr,
      amountSats: btcHumanToSats(amountStr),
      message:
        "Send native BTC to address for at least amountBtc. Automatic confirm is not enabled for Bitcoin yet.",
    };
  }

  if (ecosystem === "SUI" || ecosystem === "TRON" || ecosystem === "APTOS" || ecosystem === "OTHER") {
    return {
      kind: "unsupported",
      chain: f_chain,
      token: f_token,
      unsupportedReason: `Instruction builder not implemented for ${ecosystem}.`,
      message: "Configure an EVM route or extend payment-instruction.service for this ecosystem.",
    };
  }

  return null;
}

async function buildEvmInstruction(
  f_chain: string,
  f_token: string,
  amountStr: string,
  confirmMessage: string
): Promise<PaymentInstructionBuildResult> {
  const chainId = evmChainIdFromCoreChain(f_chain);
  if (chainId == null) {
    return {
      ok: false,
      status: 503,
      error: `Cannot resolve EVM chain id for "${f_chain}".`,
    };
  }
  const poolToken = await findPoolTokenFromDb(chainId, f_token);
  if (!poolToken) {
    return { ok: false, status: 400, error: `Unsupported token ${f_token} for chain ${f_chain}` };
  }
  if (isNativeTokenAddress(poolToken.address)) {
    return {
      ok: false,
      status: 503,
      error: `SupportedToken for ${f_token} on chain ${f_chain} uses a native placeholder address; use the wrapped ERC-20 contract address in the database (not 0xeeee… / zero).`,
    };
  }

  const resolved = await resolvePlatformPoolDestination("EVM", f_chain, f_token);
  if (resolved) {
    const data: EvmErc20TransferInstruction = {
      kind: "evm_erc20_transfer",
      toAddress: resolved.resolvedReceiveAddress,
      chainId,
      chain: f_chain,
      token: f_token,
      tokenAddress: poolToken.address,
      amount: amountStr,
      decimals: poolToken.decimals ?? 18,
      message: confirmMessage,
    };
    return { ok: true, data };
  }

  const pool = await getLiquidityPoolWallet(f_chain);
  if (!pool) {
    return {
      ok: false,
      status: 503,
      error: `No liquidity pool wallet for chain "${f_chain}". Add Wallet isLiquidityPool or PlatformPoolDestination.`,
    };
  }

  const data: EvmErc20TransferInstruction = {
    kind: "evm_erc20_transfer",
    toAddress: pool.address,
    chainId,
    chain: f_chain,
    token: f_token,
    tokenAddress: poolToken.address,
    amount: amountStr,
    decimals: poolToken.decimals ?? 18,
    message: confirmMessage,
  };
  return { ok: true, data };
}

/**
 * Build payment instruction for a SELL transaction row (offramp / app-transfer intent).
 */
export async function buildPaymentInstructionForSellTransaction(
  transactionId: string
): Promise<PaymentInstructionBuildResult> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, type: true, status: true, f_chain: true, f_token: true, f_amount: true },
  });
  if (!tx) return { ok: false, status: 404, error: "Transaction not found" };
  if (tx.type !== "SELL") return { ok: false, status: 400, error: "Transaction must be SELL" };
  if (tx.status === "COMPLETED") {
    return { ok: false, status: 400, error: "Transaction already completed" };
  }

  const f_chain = tx.f_chain?.trim() ?? "";
  const f_token = tx.f_token?.trim().toUpperCase() ?? "";
  const amountStr = tx.f_amount.toString();
  const ecosystem = ecosystemFromCoreChain(f_chain);

  if (ecosystem === "EVM") {
    return buildEvmInstruction(
      f_chain,
      f_token,
      amountStr,
      "Send this amount of token to toAddress, then POST /api/offramp/confirm with tx_hash (EVM only)."
    );
  }

  const nonEvm = await buildNonEvmFromDestination(f_chain, f_token, amountStr, ecosystem);
  if (nonEvm) return { ok: true, data: nonEvm };

  return {
    ok: true,
    data: {
      kind: "unsupported",
      chain: f_chain,
      token: f_token,
      unsupportedReason: `No PlatformPoolDestination for ${ecosystem} ${f_chain} ${f_token}.`,
      message: "Add a row in PlatformPoolDestination (and optional Infisical secret) for this chain and token.",
    },
  };
}

/**
 * Same resolver for arbitrary chain/token/amount (e.g. REQUEST calldata).
 */
export async function buildPaymentInstructionForPoolDeposit(input: {
  f_chain: string;
  f_token: string;
  f_amount: string;
}): Promise<PaymentInstructionBuildResult> {
  const f_chain = input.f_chain.trim();
  const f_token = input.f_token.trim().toUpperCase();
  const amountStr = input.f_amount.trim();
  const ecosystem = ecosystemFromCoreChain(f_chain);

  if (ecosystem === "EVM") {
    return buildEvmInstruction(
      f_chain,
      f_token,
      amountStr,
      "Send this amount of token to toAddress, then POST /api/requests/confirm-crypto with tx_hash (EVM only)."
    );
  }

  const nonEvm = await buildNonEvmFromDestination(f_chain, f_token, amountStr, ecosystem);
  if (nonEvm) return { ok: true, data: nonEvm };

  return {
    ok: true,
    data: {
      kind: "unsupported",
      chain: f_chain,
      token: f_token,
      unsupportedReason: `No PlatformPoolDestination for ${ecosystem} ${f_chain} ${f_token}.`,
      message: "Add a PlatformPoolDestination row for this network and token.",
    },
  };
}

export function isEvmConfirmableInstruction(i: PaymentInstruction): i is EvmErc20TransferInstruction {
  return i.kind === "evm_erc20_transfer";
}
