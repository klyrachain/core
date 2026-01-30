/**
 * Normalize native token address per provider.
 * 0x and Squid use 0xeeee...; LiFi accepts 0x0000 or 0xEeee.
 */

const NATIVE_ZERO = "0x0000000000000000000000000000000000000000";
const NATIVE_EEEE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export function isNativeTokenAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase();
  return (
    a === NATIVE_ZERO.toLowerCase() ||
    a === NATIVE_EEEE.toLowerCase() ||
    a === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  );
}

/** Return token address normalized for 0x API (native = 0xeeee...). */
export function toZeroXNativeToken(addr: string): string {
  if (!isNativeTokenAddress(addr)) return addr;
  return "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
}

/** Return token address normalized for Squid API (native = 0xeeee...). */
export function toSquidNativeToken(addr: string): string {
  if (!isNativeTokenAddress(addr)) return addr;
  return "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
}

/** Return token address normalized for LiFi API (accepts 0x0000 or 0xEeee; use 0x0000). */
export function toLiFiNativeToken(addr: string): string {
  if (!isNativeTokenAddress(addr)) return addr;
  return NATIVE_ZERO;
}
