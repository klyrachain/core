export type ProviderRailMetadata = {
  providerCode: "yellowcard" | "kotanipay" | "cowrie";
  providerName: string;
  supportedCountries: string[];
  supportedFiatCurrencies: string[];
  supportedCryptoAssets: string[];
  channels: string[];
  kycRequirements: string[];
  status: "ACTIVE" | "PLANNED";
};

const PROVIDER_METADATA: ProviderRailMetadata[] = [
  {
    providerCode: "yellowcard",
    providerName: "Yellow Card",
    supportedCountries: [
      "GH",
      "NG",
      "KE",
      "UG",
      "TZ",
      "RW",
      "ZM",
      "ZA",
      "CM",
      "CI",
      "SN",
      "BW",
    ],
    supportedFiatCurrencies: [
      "GHS",
      "NGN",
      "KES",
      "UGX",
      "TZS",
      "RWF",
      "ZMW",
      "ZAR",
      "XAF",
      "XOF",
      "BWP",
      "USD",
      "EUR",
    ],
    supportedCryptoAssets: [
      "USDC",
      "USDT",
      "BTC",
      "ETH",
      "SOL",
      "XLM",
      "XRP",
      "BNB",
      "MATIC",
    ],
    channels: ["bank_transfer", "mobile_money", "wallet"],
    kycRequirements: ["government_id", "selfie", "proof_of_address", "business_documents"],
    status: "ACTIVE",
  },
  {
    providerCode: "kotanipay",
    providerName: "Kotani Pay",
    supportedCountries: ["KE", "UG", "TZ", "RW", "GH", "NG", "ZM"],
    supportedFiatCurrencies: ["KES", "UGX", "TZS", "RWF", "GHS", "NGN", "ZMW", "USD"],
    supportedCryptoAssets: ["USDC", "USDT", "XLM", "BTC", "ETH", "CELO"],
    channels: ["mobile_money", "bank_transfer", "wallet"],
    kycRequirements: ["government_id", "phone_number_verification", "business_documents"],
    status: "ACTIVE",
  },
  {
    providerCode: "cowrie",
    providerName: "Cowrie",
    supportedCountries: ["NG", "GH", "KE", "UG", "ZA", "US", "GB"],
    supportedFiatCurrencies: ["NGN", "GHS", "KES", "UGX", "ZAR", "USD", "GBP", "EUR"],
    supportedCryptoAssets: ["USDC", "USDT", "BTC", "ETH", "XLM", "XRP", "SOL"],
    channels: ["bank_transfer", "wallet"],
    kycRequirements: ["government_id", "selfie", "proof_of_address", "business_documents"],
    status: "ACTIVE",
  },
];

export function listProviderRailMetadata(): ProviderRailMetadata[] {
  return PROVIDER_METADATA;
}
