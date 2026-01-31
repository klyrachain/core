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
    wallets: 2,
    inventoryAssets: 3,
    transactions: 3,
    request: request.code,
    claim: claim.id,
    inventoryHistory: 2,
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
