import type { PaymentEcosystem } from "./payment-chain-routing.js";

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
/** Base58 Solana public key (typical 32–44 chars). */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;
const STELLAR_ADDRESS = /^G[A-Z0-9]{55}$/;
const BTC_ADDRESS =
  /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|tb1[a-z0-9]{25,87}|bcrt1[a-z0-9]{25,87})$/;
const SUI_ADDRESS = /^0x[a-fA-F0-9]{64}$/i;
const TRON_ADDRESS = /^T[A-Za-z1-9]{33}$/;
const APTOS_ADDRESS = /^0x[a-fA-F0-9]{1,66}$/i;

export function isValidReceiverForEcosystem(
  ecosystem: PaymentEcosystem,
  address: string
): boolean {
  const a = address.trim();
  if (!a) return false;
  switch (ecosystem) {
    case "EVM":
      return EVM_ADDRESS.test(a);
    case "SOLANA":
      return SOLANA_ADDRESS.test(a);
    case "STELLAR":
      return STELLAR_ADDRESS.test(a);
    case "BITCOIN":
      return BTC_ADDRESS.test(a);
    case "SUI":
      return SUI_ADDRESS.test(a);
    case "TRON":
      return TRON_ADDRESS.test(a);
    case "APTOS":
      return APTOS_ADDRESS.test(a);
    default:
      return a.length >= 8 && a.length <= 256;
  }
}
