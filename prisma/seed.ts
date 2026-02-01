import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { WalletManager } from "../src/utils/wallet-manager.js";
import { loadEnv } from "../src/config/env.js";

try {
  loadEnv();
} catch {
  // Env validation may fail; use process.env for seed
}
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function hex(byteLength: number): string {
  return Buffer.from(Array.from({ length: byteLength }, () => Math.floor(Math.random() * 256))).toString("hex");
}

async function main() {
  let encryptedKey: string;
  try {
    loadEnv();
    encryptedKey = WalletManager.encrypt("seed-placeholder-private-key-do-not-use");
  } catch {
    encryptedKey = hex(32 + 16 + 16 + 32);
  }

  console.log("Seeding users...");
  const [alice, bob, charlie] = await Promise.all([
    prisma.user.upsert({
      where: { email: "alice@example.com" },
      create: {
        email: "alice@example.com",
        address: "0x1111111111111111111111111111111111111111",
        number: "233201234567",
        username: "alice",
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { email: "bob@example.com" },
      create: {
        email: "bob@example.com",
        address: "0x2222222222222222222222222222222222222222",
        number: "233209876543",
        username: "bob",
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { email: "charlie@example.com" },
      create: {
        email: "charlie@example.com",
        address: "0x3333333333333333333333333333333333333333",
        username: "charlie",
      },
      update: {},
    }),
  ]);

  console.log("Seeding wallets...");
  const [walletEth, walletBase] = await Promise.all([
    prisma.wallet.upsert({
      where: { address: "0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1" },
      create: {
        address: "0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1",
        encryptedKey,
        supportedChains: ["ETHEREUM", "BASE"],
        supportedTokens: ["ETH", "USDC"],
      },
      update: {},
    }),
    prisma.wallet.upsert({
      where: { address: "0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2" },
      create: {
        address: "0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2",
        encryptedKey,
        supportedChains: ["ETHEREUM"],
        supportedTokens: ["USDC", "DAI"],
      },
      update: {},
    }),
  ]);

  console.log("Seeding inventory assets...");
  const defaultAddress = walletEth.address;
  const [usdcEth, ethEth, usdcBase] = await Promise.all([
    prisma.inventoryAsset.upsert({
      where: {
        chainId_tokenAddress_address: {
          chainId: 1,
          tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          address: defaultAddress,
        },
      },
      create: {
        chain: "ETHEREUM",
        chainId: 1,
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        address: defaultAddress,
        walletId: walletEth.id,
        currentBalance: 50_000,
      },
      update: {},
    }),
    prisma.inventoryAsset.upsert({
      where: {
        chainId_tokenAddress_address: {
          chainId: 1,
          tokenAddress: "0x0000000000000000000000000000000000000000",
          address: defaultAddress,
        },
      },
      create: {
        chain: "ETHEREUM",
        chainId: 1,
        tokenAddress: "0x0000000000000000000000000000000000000000",
        symbol: "ETH",
        address: defaultAddress,
        walletId: walletEth.id,
        currentBalance: 10,
      },
      update: {},
    }),
    prisma.inventoryAsset.upsert({
      where: {
        chainId_tokenAddress_address: {
          chainId: 8453,
          tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          address: defaultAddress,
        },
      },
      create: {
        chain: "BASE",
        chainId: 8453,
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        address: defaultAddress,
        walletId: walletEth.id,
        currentBalance: 25_000,
      },
      update: {},
    }),
  ]);

  console.log("Seeding businesses (B2B2C)...");
  const [acme, betaCorp] = await Promise.all([
    prisma.business.upsert({
      where: { slug: "acme" },
      create: {
        name: "Acme Inc",
        slug: "acme",
        country: "US",
        kybStatus: "APPROVED",
        riskScore: 10,
        settlementSchedule: "WEEKLY",
        webhookUrl: "https://acme.example.com/webhook",
      },
      update: {},
    }),
    prisma.business.upsert({
      where: { slug: "beta-corp" },
      create: {
        name: "Beta Corp",
        slug: "beta-corp",
        country: "GH",
        kybStatus: "PENDING",
        riskScore: 25,
        settlementSchedule: "DAILY",
      },
      update: {},
    }),
  ]);

  console.log("Seeding business members...");
  await Promise.all([
    prisma.businessMember.upsert({
      where: { userId_businessId: { userId: alice.id, businessId: acme.id } },
      create: { userId: alice.id, businessId: acme.id, role: "OWNER", isActive: true },
      update: {},
    }),
    prisma.businessMember.upsert({
      where: { userId_businessId: { userId: bob.id, businessId: acme.id } },
      create: { userId: bob.id, businessId: acme.id, role: "ADMIN", isActive: true },
      update: {},
    }),
    prisma.businessMember.upsert({
      where: { userId_businessId: { userId: charlie.id, businessId: betaCorp.id } },
      create: { userId: charlie.id, businessId: betaCorp.id, role: "DEVELOPER", isActive: true },
      update: {},
    }),
  ]);

  await prisma.feeSchedule.upsert({
    where: { businessId: acme.id },
    create: { businessId: acme.id, flatFee: 0, percentageFee: 1, maxFee: 50 },
    update: {},
  });

  const acmePayoutMethod = await prisma.payoutMethod.upsert({
    where: { id: "00000000-0000-0000-000a-000000000001" },
    create: {
      id: "00000000-0000-0000-000a-000000000001",
      businessId: acme.id,
      type: "BANK_ACCOUNT",
      currency: "USD",
      details: { accountNumber: "****1234", bankCode: "063", accountName: "Acme Inc" },
      isPrimary: true,
      isActive: true,
    },
    update: {},
  });

  await prisma.payout.upsert({
    where: { id: "00000000-0000-0000-000b-000000000001" },
    create: {
      id: "00000000-0000-0000-000b-000000000001",
      businessId: acme.id,
      methodId: acmePayoutMethod.id,
      amount: 50230,
      fee: 25,
      currency: "USD",
      status: "PAID",
      reference: "WIRE-REF-8821",
      batchId: "batch-8821",
    },
    update: {},
  });

  console.log("Seeding transactions...");
  const buyTx = await prisma.transaction.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      type: "BUY",
      status: "COMPLETED",
      fromUserId: alice.id,
      fromIdentifier: alice.email,
      fromType: "EMAIL",
      toIdentifier: alice.address ?? undefined,
      toType: "ADDRESS",
      f_amount: 100,
      t_amount: 0.05,
      f_price: 2000,
      t_price: 2000,
      f_chain: "ETHEREUM",
      t_chain: "ETHEREUM",
      f_token: "USDC",
      t_token: "ETH",
      f_provider: "NONE",
      t_provider: "SQUID",
      businessId: acme.id,
      platformFee: 1,
      merchantFee: 0.5,
    },
    update: {},
  });

  const sellTx = await prisma.transaction.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      type: "SELL",
      status: "COMPLETED",
      fromUserId: bob.id,
      fromIdentifier: bob.address ?? undefined,
      fromType: "ADDRESS",
      toIdentifier: bob.email,
      toType: "EMAIL",
      f_amount: 0.02,
      t_amount: 40,
      f_price: 2000,
      t_price: 2000,
      f_chain: "ETHEREUM",
      t_chain: "ETHEREUM",
      f_token: "ETH",
      t_token: "USDC",
      businessId: acme.id,
      platformFee: 0.4,
      merchantFee: 0.2,
    },
    update: {},
  });

  const requestTemplateTx = await prisma.transaction.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      type: "REQUEST",
      status: "PENDING",
      fromIdentifier: charlie.email,
      fromType: "EMAIL",
      toIdentifier: "233201111111",
      toType: "NUMBER",
      f_amount: 20,
      t_amount: 20,
      f_price: 12.5,
      t_price: 12.5,
      f_chain: "ETHEREUM",
      t_chain: "ETHEREUM",
      f_token: "GHS",
      t_token: "GHS",
    },
    update: {},
  });

  console.log("Seeding request & claim...");
  const request = await prisma.request.upsert({
    where: { code: "REQ8A8790" },
    create: {
      code: "REQ8A8790",
      linkId: "link1abc",
      transactionId: requestTemplateTx.id,
    },
    update: {},
  });

  await prisma.transaction.update({
    where: { id: requestTemplateTx.id },
    data: { requestId: request.id },
  });

  const claim = await prisma.claim.upsert({
    where: { requestId: request.id },
    create: {
      requestId: request.id,
      status: "ACTIVE",
      value: 20,
      price: 12.5,
      token: "GHS",
      payerIdentifier: "233201111111",
      toIdentifier: charlie.email ?? "",
      code: "123456",
    },
    update: {},
  });

  console.log("Seeding countries (Fonbnk + Paystack supported)...");
  const countryData: Array<{ code: string; name: string; currency: string; supportedFonbnk: boolean; supportedPaystack: boolean }> = [
    { code: "NG", name: "Nigeria", currency: "NGN", supportedFonbnk: true, supportedPaystack: true },
    { code: "KE", name: "Kenya", currency: "KES", supportedFonbnk: true, supportedPaystack: true },
    { code: "GH", name: "Ghana", currency: "GHS", supportedFonbnk: true, supportedPaystack: true },
    { code: "ZA", name: "South Africa", currency: "ZAR", supportedFonbnk: true, supportedPaystack: true },
    { code: "TZ", name: "Tanzania", currency: "TZS", supportedFonbnk: true, supportedPaystack: false },
    { code: "UG", name: "Uganda", currency: "UGX", supportedFonbnk: true, supportedPaystack: false },
    { code: "ZM", name: "Zambia", currency: "ZMW", supportedFonbnk: true, supportedPaystack: false },
    { code: "BF", name: "Burkina Faso", currency: "XOF", supportedFonbnk: true, supportedPaystack: false },
    { code: "BR", name: "Brazil", currency: "BRL", supportedFonbnk: true, supportedPaystack: false },
    { code: "SN", name: "Senegal", currency: "XOF", supportedFonbnk: true, supportedPaystack: false },
    { code: "CG", name: "Republic of the Congo", currency: "XAF", supportedFonbnk: true, supportedPaystack: false },
    { code: "BJ", name: "Benin", currency: "XOF", supportedFonbnk: true, supportedPaystack: false },
    { code: "GA", name: "Gabon", currency: "XAF", supportedFonbnk: true, supportedPaystack: false },
    { code: "RW", name: "Rwanda", currency: "RWF", supportedFonbnk: true, supportedPaystack: false },
    { code: "CI", name: "Ivory Coast", currency: "XOF", supportedFonbnk: true, supportedPaystack: false },
    { code: "CM", name: "Cameroon", currency: "XAF", supportedFonbnk: true, supportedPaystack: false },
    { code: "MW", name: "Malawi", currency: "MWK", supportedFonbnk: true, supportedPaystack: false },
  ];
  for (const c of countryData) {
    await prisma.country.upsert({
      where: { code: c.code },
      create: c,
      update: { name: c.name, currency: c.currency, supportedFonbnk: c.supportedFonbnk, supportedPaystack: c.supportedPaystack },
    });
  }

  console.log("Seeding supported chains and tokens...");
  const CHAIN_ID_BASE = 8453;
  const CHAIN_ID_ETHEREUM = 1;
  const CHAIN_ID_MOMO = 0; // fiat/offchain (onramp, offramp)
  const CHAIN_ID_BANK = 2;
  const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const FIAT_SENTINEL = "0x0000000000000000000000000000000000000000";

  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_BASE },
    create: { chainId: CHAIN_ID_BASE, name: "Base", iconUri: null },
    update: { name: "Base", iconUri: undefined },
  });
  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_ETHEREUM },
    create: { chainId: CHAIN_ID_ETHEREUM, name: "Ethereum", iconUri: null },
    update: { name: "Ethereum", iconUri: undefined },
  });
  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_MOMO },
    create: { chainId: CHAIN_ID_MOMO, name: "MOMO", iconUri: null },
    update: { name: "MOMO", iconUri: undefined },
  });
  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_BANK },
    create: { chainId: CHAIN_ID_BANK, name: "BANK", iconUri: null },
    update: { name: "BANK", iconUri: undefined },
  });

  const tokenData: Array<{ chainId: number; tokenAddress: string; symbol: string; decimals: number; name: string | null; logoUri: string | null; fonbnkCode: string | null }> = [
    { chainId: CHAIN_ID_BASE, tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, name: "USD Coin", logoUri: null, fonbnkCode: "BASE_USDC" },
    { chainId: CHAIN_ID_BASE, tokenAddress: NATIVE, symbol: "ETH", decimals: 18, name: "Ether", logoUri: null, fonbnkCode: "BASE_ETH" },
    { chainId: CHAIN_ID_ETHEREUM, tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6, name: "USD Coin", logoUri: null, fonbnkCode: "ETHEREUM_USDC" },
    { chainId: CHAIN_ID_ETHEREUM, tokenAddress: NATIVE, symbol: "ETH", decimals: 18, name: "Ether", logoUri: null, fonbnkCode: "ETHEREUM_NATIVE" },
    { chainId: CHAIN_ID_MOMO, tokenAddress: FIAT_SENTINEL, symbol: "GHS", decimals: 2, name: "Ghana Cedi", logoUri: null, fonbnkCode: "MOMO_GHS" },
    { chainId: CHAIN_ID_MOMO, tokenAddress: "0x0000000000000000000000000000000000000001", symbol: "USD", decimals: 2, name: "US Dollar", logoUri: null, fonbnkCode: "MOMO_USD" },
    { chainId: CHAIN_ID_BANK, tokenAddress: FIAT_SENTINEL, symbol: "USD", decimals: 2, name: "US Dollar", logoUri: null, fonbnkCode: "BANK_USD" },
  ];
  for (const t of tokenData) {
    await prisma.supportedToken.upsert({
      where: { chainId_tokenAddress: { chainId: t.chainId, tokenAddress: t.tokenAddress } },
      create: t,
      update: { symbol: t.symbol, decimals: t.decimals, name: t.name, logoUri: t.logoUri, fonbnkCode: t.fonbnkCode },
    });
  }

  console.log("Seeding platform settings (defaults)...");
  const platformSettingDefaults: Array<{ key: string; value: object }> = [
    { key: "general", value: { publicName: "MyCryptoApp", supportEmail: "", supportPhone: "", defaultCurrency: "USD", timezone: "UTC", maintenanceMode: false } },
    { key: "financials", value: { baseFeePercent: 1, fixedFee: 0, minTransactionSize: 0, maxTransactionSize: 1_000_000, lowBalanceAlert: 1000 } },
    {
      key: "providers",
      value: {
        maxSlippagePercent: 1,
        providers: [
          { id: "SQUID", enabled: true, priority: 1, apiKey: "", status: "operational", latencyMs: null },
          { id: "LIFI", enabled: true, priority: 2, apiKey: "", status: "operational", latencyMs: null },
          { id: "0X", enabled: true, priority: 3, apiKey: "", status: "operational", latencyMs: null },
          { id: "PAYSTACK", enabled: true, priority: 4, apiKey: "", status: "operational", latencyMs: null },
        ],
      },
    },
    { key: "risk", value: { enforceKycOver1000: false, blockHighRiskIp: false, blacklist: [] } },
    { key: "api", value: { webhookSigningSecret: "", slackWebhookUrl: "", alertEmails: "" } },
  ];
  for (const { key, value } of platformSettingDefaults) {
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }

  console.log("Seeding provider routing...");
  const providerCodes = ["SQUID", "LIFI", "ZERO_X", "PAYSTACK"] as const;
  for (let i = 0; i < providerCodes.length; i++) {
    const code = providerCodes[i];
    await prisma.providerRouting.upsert({
      where: { code },
      create: {
        code,
        name: code === "ZERO_X" ? "0x" : code,
        status: "ACTIVE",
        operational: true,
        enabled: true,
        priority: i + 1,
        fee: null,
      },
      update: {},
    });
  }

  console.log("Seeding inventory history...");
  await Promise.all([
    prisma.inventoryHistory.upsert({
      where: { id: "00000000-0000-0000-0000-000000000010" },
      create: {
        id: "00000000-0000-0000-0000-000000000010",
        assetId: usdcEth.id,
        type: "SALE",
        amount: 100,
        quantity: 100,
        initialPurchasePrice: 1,
        providerQuotePrice: 2000,
      },
      update: {},
    }),
    prisma.inventoryHistory.upsert({
      where: { id: "00000000-0000-0000-0000-000000000011" },
      create: {
        id: "00000000-0000-0000-0000-000000000011",
        assetId: ethEth.id,
        type: "PURCHASE",
        amount: 0.05,
        quantity: 0.05,
        initialPurchasePrice: 2000,
        providerQuotePrice: 2000,
      },
      update: {},
    }),
  ]);

  console.log("Seed completed.");
  console.log({
    users: 3,
    businesses: 2,
    businessMembers: 3,
    wallets: 2,
    inventoryAssets: 3,
    transactions: 3,
    request: request.code,
    claim: claim.id,
    inventoryHistory: 2,
    countries: countryData.length,
    chains: 4,
    supportedTokens: tokenData.length,
    feeSchedules: 1,
    payoutMethods: 1,
    payouts: 1,
    platformSettings: platformSettingDefaults.length,
    providerRouting: providerCodes.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
