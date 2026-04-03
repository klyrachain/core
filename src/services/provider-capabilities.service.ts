export type ProviderFeeCapability = {
  providerCode: string;
  supportsMarkup: boolean;
  requiresExplicitFeeLeg: boolean;
};

const PROVIDER_FEE_CAPABILITIES: Record<string, ProviderFeeCapability> = {
  fonbnk: {
    providerCode: "fonbnk",
    supportsMarkup: true,
    requiresExplicitFeeLeg: false,
  },
  paystack: {
    providerCode: "paystack",
    supportsMarkup: false,
    requiresExplicitFeeLeg: true,
  },
  squid: {
    providerCode: "squid",
    supportsMarkup: true,
    requiresExplicitFeeLeg: false,
  },
  lifi: {
    providerCode: "lifi",
    supportsMarkup: true,
    requiresExplicitFeeLeg: false,
  },
  "0x": {
    providerCode: "0x",
    supportsMarkup: true,
    requiresExplicitFeeLeg: false,
  },
  yellowcard: {
    providerCode: "yellowcard",
    supportsMarkup: true,
    requiresExplicitFeeLeg: false,
  },
  kotanipay: {
    providerCode: "kotanipay",
    supportsMarkup: true,
    requiresExplicitFeeLeg: false,
  },
  cowrie: {
    providerCode: "cowrie",
    supportsMarkup: true,
    requiresExplicitFeeLeg: false,
  },
};

export function getProviderFeeCapability(
  providerCode: string | null | undefined
): ProviderFeeCapability {
  const normalized = (providerCode ?? "").trim().toLowerCase();
  if (normalized in PROVIDER_FEE_CAPABILITIES) {
    return PROVIDER_FEE_CAPABILITIES[normalized]!;
  }
  return {
    providerCode: normalized || "unknown",
    supportsMarkup: true,
    requiresExplicitFeeLeg: false,
  };
}
