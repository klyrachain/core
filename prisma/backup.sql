--
-- PostgreSQL database dump
--

\restrict kMcSg0O4laksLLIu4M8ta45ogrSPgprXMcL442WltBsRyVAZDvLVp8KyNdoyYIX

-- Dumped from database version 16.11 (Debian 16.11-1.pgdg13+1)
-- Dumped by pg_dump version 18.1 (Debian 18.1-2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: BusinessRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."BusinessRole" AS ENUM (
    'OWNER',
    'ADMIN',
    'DEVELOPER',
    'FINANCE',
    'SUPPORT'
);


--
-- Name: ClaimStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ClaimStatus" AS ENUM (
    'ACTIVE',
    'CLAIMED',
    'CANCELLED',
    'FAIL'
);


--
-- Name: CryptoTransactionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CryptoTransactionStatus" AS ENUM (
    'PENDING',
    'SUBMITTED',
    'CONFIRMED',
    'FAILED'
);


--
-- Name: IdentityType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."IdentityType" AS ENUM (
    'ADDRESS',
    'EMAIL',
    'NUMBER'
);


--
-- Name: InvoiceStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."InvoiceStatus" AS ENUM (
    'Paid',
    'Pending',
    'Overdue',
    'Draft',
    'Cancelled'
);


--
-- Name: KybStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."KybStatus" AS ENUM (
    'NOT_STARTED',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'RESTRICTED'
);


--
-- Name: LedgerType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LedgerType" AS ENUM (
    'ACQUIRED',
    'DISPOSED',
    'REBALANCE'
);


--
-- Name: LotStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LotStatus" AS ENUM (
    'OPEN',
    'DEPLETED'
);


--
-- Name: PaymentProvider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentProvider" AS ENUM (
    'NONE',
    'ANY',
    'SQUID',
    'LIFI',
    'PAYSTACK',
    'KLYRA'
);


--
-- Name: PayoutMethodType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PayoutMethodType" AS ENUM (
    'BANK_ACCOUNT',
    'CRYPTO_WALLET',
    'MOBILE_MONEY'
);


--
-- Name: PayoutStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PayoutStatus" AS ENUM (
    'SCHEDULED',
    'PROCESSING',
    'PAID',
    'FAILED',
    'REVERSED'
);


--
-- Name: PlatformAdminRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PlatformAdminRole" AS ENUM (
    'super_admin',
    'support',
    'developer',
    'viewer'
);


--
-- Name: ProviderRoutingStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProviderRoutingStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'MAINTENANCE'
);


--
-- Name: SettlementSchedule; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementSchedule" AS ENUM (
    'INSTANT',
    'DAILY',
    'WEEKLY',
    'MANUAL'
);


--
-- Name: SupportedChain; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SupportedChain" AS ENUM (
    'ETHEREUM',
    'BNB',
    'BASE',
    'SOLANA'
);


--
-- Name: TransactionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TransactionStatus" AS ENUM (
    'ACTIVE',
    'PENDING',
    'COMPLETED',
    'CANCELLED',
    'FAILED'
);


--
-- Name: TransactionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TransactionType" AS ENUM (
    'BUY',
    'SELL',
    'TRANSFER',
    'REQUEST',
    'CLAIM'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AdminInvite; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdminInvite" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    email text NOT NULL,
    role public."PlatformAdminRole" NOT NULL,
    token text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "invitedById" text
);


--
-- Name: AdminPasskey; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdminPasskey" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "adminId" text NOT NULL,
    "credentialId" text NOT NULL,
    "publicKey" bytea NOT NULL,
    counter integer DEFAULT 0 NOT NULL,
    name text
);


--
-- Name: AdminSession; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdminSession" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "adminId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "sessionTtlMinutes" integer DEFAULT 15 NOT NULL
);


--
-- Name: ApiKey; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ApiKey" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "keyHash" text NOT NULL,
    "keyPrefix" text NOT NULL,
    name text NOT NULL,
    domains text[] NOT NULL,
    permissions text[] NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "lastUsedAt" timestamp(3) without time zone,
    "businessId" text
);


--
-- Name: Business; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Business" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    "logoUrl" text,
    website text,
    "supportEmail" text,
    "legalName" text,
    "registrationNumber" text,
    country text NOT NULL,
    "kybStatus" public."KybStatus" DEFAULT 'NOT_STARTED'::public."KybStatus" NOT NULL,
    "riskScore" integer DEFAULT 0 NOT NULL,
    "settlementSchedule" public."SettlementSchedule" DEFAULT 'WEEKLY'::public."SettlementSchedule" NOT NULL,
    "webhookUrl" text
);


--
-- Name: BusinessMember; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BusinessMember" (
    id text NOT NULL,
    "joinedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "userId" text NOT NULL,
    "businessId" text NOT NULL,
    role public."BusinessRole" DEFAULT 'DEVELOPER'::public."BusinessRole" NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL
);


--
-- Name: Chain; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Chain" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "chainId" integer NOT NULL,
    name text NOT NULL,
    "iconUri" text
);


--
-- Name: Claim; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Claim" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "requestId" text NOT NULL,
    status public."ClaimStatus" DEFAULT 'ACTIVE'::public."ClaimStatus" NOT NULL,
    value numeric(18,8) NOT NULL,
    price numeric(18,8) NOT NULL,
    token text NOT NULL,
    "payerIdentifier" text NOT NULL,
    "toIdentifier" text NOT NULL,
    code text NOT NULL,
    "otpVerifiedAt" timestamp(3) without time zone
);


--
-- Name: Country; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Country" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    currency text NOT NULL,
    "supportedFonbnk" boolean DEFAULT false NOT NULL,
    "supportedPaystack" boolean DEFAULT false NOT NULL
);


--
-- Name: CryptoTransaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CryptoTransaction" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    provider text NOT NULL,
    status public."CryptoTransactionStatus" DEFAULT 'PENDING'::public."CryptoTransactionStatus" NOT NULL,
    "fromChainId" integer NOT NULL,
    "toChainId" integer NOT NULL,
    "fromToken" text NOT NULL,
    "toToken" text NOT NULL,
    "fromAmount" text NOT NULL,
    "toAmount" text NOT NULL,
    "txHash" text,
    "txUrl" text,
    "transactionId" text,
    metadata jsonb
);


--
-- Name: FailedOrderValidation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FailedOrderValidation" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reason text NOT NULL,
    code text,
    payload jsonb NOT NULL,
    "requestId" text
);


--
-- Name: FeeSchedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FeeSchedule" (
    id text NOT NULL,
    "businessId" text NOT NULL,
    "flatFee" numeric(18,2) DEFAULT 0 NOT NULL,
    "percentageFee" numeric(5,2) DEFAULT 1 NOT NULL,
    "maxFee" numeric(18,2)
);


--
-- Name: InventoryAsset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."InventoryAsset" (
    id text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    chain text NOT NULL,
    "tokenAddress" text NOT NULL,
    symbol text NOT NULL,
    "currentBalance" numeric(28,8) DEFAULT 0 NOT NULL,
    "chainId" integer NOT NULL,
    address text NOT NULL,
    "walletId" text
);


--
-- Name: InventoryLedger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."InventoryLedger" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "assetId" text NOT NULL,
    type public."LedgerType" NOT NULL,
    quantity numeric(28,8) NOT NULL,
    "pricePerTokenUsd" numeric(28,8) NOT NULL,
    "totalValueUsd" numeric(28,8) NOT NULL,
    "referenceId" text NOT NULL,
    counterparty text
);


--
-- Name: InventoryLot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."InventoryLot" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "assetId" text NOT NULL,
    "acquiredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "sourceType" text,
    "sourceTransactionId" text,
    "originalQuantity" numeric(28,8) NOT NULL,
    "remainingQuantity" numeric(28,8) NOT NULL,
    "costPerTokenUsd" numeric(28,8) NOT NULL,
    "totalCostUsd" numeric(28,8) NOT NULL,
    status public."LotStatus" DEFAULT 'OPEN'::public."LotStatus" NOT NULL
);


--
-- Name: Invoice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Invoice" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "invoiceNumber" text NOT NULL,
    status public."InvoiceStatus" NOT NULL,
    amount numeric(18,2) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    "currencyLabel" text,
    "paidAt" timestamp(3) without time zone,
    "batchTitle" text DEFAULT ''::text NOT NULL,
    "billedTo" text NOT NULL,
    "billingDetails" text,
    subject text NOT NULL,
    issued timestamp(3) without time zone NOT NULL,
    "dueDate" timestamp(3) without time zone NOT NULL,
    notes text,
    "lineItems" jsonb NOT NULL,
    subtotal numeric(18,2) NOT NULL,
    "discountPercent" numeric(5,2) DEFAULT 0 NOT NULL,
    "discountAmount" numeric(18,2) DEFAULT 0 NOT NULL,
    total numeric(18,2) NOT NULL,
    "amountDue" numeric(18,2) NOT NULL,
    "termsAndConditions" text DEFAULT ''::text NOT NULL,
    "notesContent" text DEFAULT ''::text NOT NULL,
    log jsonb NOT NULL
);


--
-- Name: Payout; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Payout" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "businessId" text NOT NULL,
    "methodId" text NOT NULL,
    amount numeric(18,8) NOT NULL,
    fee numeric(18,8) DEFAULT 0 NOT NULL,
    currency text NOT NULL,
    status public."PayoutStatus" DEFAULT 'SCHEDULED'::public."PayoutStatus" NOT NULL,
    reference text,
    "batchId" text
);


--
-- Name: PayoutMethod; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PayoutMethod" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "businessId" text NOT NULL,
    type public."PayoutMethodType" NOT NULL,
    currency text NOT NULL,
    details jsonb NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL
);


--
-- Name: PayoutRequest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PayoutRequest" (
    id text NOT NULL,
    code text NOT NULL,
    "transactionId" text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    amount numeric(18,8),
    currency text,
    "recipientCode" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "transferCode" text,
    "transferReference" text,
    "recipientName" text,
    "recipientType" text
);


--
-- Name: PaystackPaymentRecord; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PaystackPaymentRecord" (
    id text NOT NULL,
    reference text NOT NULL,
    "paystackId" text NOT NULL,
    "transactionId" text,
    status text NOT NULL,
    amount numeric(18,8),
    currency text,
    "paidAt" timestamp(3) without time zone,
    channel text,
    "gatewayResponse" text,
    "customerEmail" text,
    metadata jsonb,
    "rawResponse" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: PaystackTransferRecord; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PaystackTransferRecord" (
    id text NOT NULL,
    reference text NOT NULL,
    "transferCode" text NOT NULL,
    "payoutRequestId" text,
    amount numeric(18,8) NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    "recipientName" text,
    reason text,
    "rawResponse" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: PlatformAdmin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PlatformAdmin" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    email text NOT NULL,
    name text,
    role public."PlatformAdminRole" DEFAULT 'viewer'::public."PlatformAdminRole" NOT NULL,
    "twoFaEnabled" boolean DEFAULT false NOT NULL,
    "emailVerifiedAt" timestamp(3) without time zone,
    "passwordHash" text,
    "totpSecret" text
);


--
-- Name: PlatformSetting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PlatformSetting" (
    id text NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ProviderRouting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProviderRouting" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    code text NOT NULL,
    name text,
    status public."ProviderRoutingStatus" DEFAULT 'ACTIVE'::public."ProviderRoutingStatus" NOT NULL,
    operational boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "keyHash" text,
    "keyPrefix" text,
    priority integer DEFAULT 0 NOT NULL,
    fee numeric(5,4)
);


--
-- Name: Request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Request" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    code text NOT NULL,
    "linkId" text NOT NULL,
    "transactionId" text NOT NULL,
    "payoutTarget" text,
    "payoutFiat" jsonb
);


--
-- Name: SupportedToken; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupportedToken" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "chainId" integer NOT NULL,
    "tokenAddress" text NOT NULL,
    symbol text NOT NULL,
    decimals integer DEFAULT 18 NOT NULL,
    name text,
    "logoUri" text,
    "fonbnkCode" text
);


--
-- Name: Transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Transaction" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    type public."TransactionType" NOT NULL,
    status public."TransactionStatus" DEFAULT 'ACTIVE'::public."TransactionStatus" NOT NULL,
    "fromIdentifier" text,
    "fromType" public."IdentityType",
    "fromUserId" text,
    "toIdentifier" text,
    "toType" public."IdentityType",
    "toUserId" text,
    f_amount numeric(18,8) NOT NULL,
    t_amount numeric(18,8) NOT NULL,
    f_token text NOT NULL,
    t_token text NOT NULL,
    f_provider public."PaymentProvider" DEFAULT 'NONE'::public."PaymentProvider" NOT NULL,
    t_provider public."PaymentProvider" DEFAULT 'NONE'::public."PaymentProvider" NOT NULL,
    "requestId" text,
    f_chain text NOT NULL,
    t_chain text NOT NULL,
    "providerSessionId" text,
    "businessId" text,
    "merchantFee" numeric(18,8) DEFAULT 0,
    "platformFee" numeric(18,8) DEFAULT 0,
    fee numeric(18,8),
    "providerPrice" numeric(18,8),
    "settlementQuoteSnapshot" jsonb,
    "cryptoSendTxHash" text,
    "exchangeRate" numeric(18,8),
    "f_tokenPriceUsd" numeric(18,8),
    "t_tokenPriceUsd" numeric(18,8),
    "feeInUsd" numeric(18,8),
    "paymentConfirmedAt" timestamp(3) without time zone
);


--
-- Name: TransactionBalanceSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TransactionBalanceSnapshot" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "transactionId" text NOT NULL,
    "assetId" text NOT NULL,
    "balanceBefore" numeric(28,8) NOT NULL,
    "balanceAfter" numeric(28,8) NOT NULL
);


--
-- Name: TransactionPnL; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TransactionPnL" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "transactionId" text NOT NULL,
    "lotId" text,
    quantity numeric(28,8) NOT NULL,
    "costPerTokenUsd" numeric(28,8) NOT NULL,
    "feeAmountUsd" numeric(28,8) NOT NULL,
    "profitLossUsd" numeric(28,8) NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    email text NOT NULL,
    address text,
    number text,
    username text
);


--
-- Name: Wallet; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Wallet" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    address text NOT NULL,
    "encryptedKey" text NOT NULL,
    "supportedTokens" text[],
    "supportedChains" text[] NOT NULL,
    "isLiquidityPool" boolean DEFAULT false NOT NULL,
    "collectFees" boolean DEFAULT false NOT NULL
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Data for Name: AdminInvite; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."AdminInvite" (id, "createdAt", email, role, token, "expiresAt", "usedAt", "invitedById") FROM stdin;
a42ccdba-5bb2-4b79-a03b-8c3bdf68c82e	2026-02-05 01:02:10.862	patrickkesh90@gmail.com	super_admin	Qx-SF3KBvqaqeu47z9yYCCx62Zmwck9C3p4WsN60m4w	2026-02-12 01:02:10.862	2026-02-05 01:02:57.812	\N
\.


--
-- Data for Name: AdminPasskey; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."AdminPasskey" (id, "createdAt", "adminId", "credentialId", "publicKey", counter, name) FROM stdin;
\.


--
-- Data for Name: AdminSession; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."AdminSession" (id, "createdAt", "adminId", "tokenHash", "expiresAt", "sessionTtlMinutes") FROM stdin;
3f7b2455-1d10-4482-a3f1-3497f711275d	2026-02-05 01:04:07.335	3820d25d-6669-4c2d-839b-225b4b70149a	6d1c0974e975ad9c66f42d3dbf6d33ae7612ddb00ce1de088900d396712fe113	2026-02-05 01:19:07.334	15
61ba33d1-cd4f-4ae0-b600-73c8291020a0	2026-02-05 01:04:49.866	3820d25d-6669-4c2d-839b-225b4b70149a	8696a37b5eb5bf9bd6d2aa892b13a0f181db1052a37ecbe8b583f41d0b780f14	2026-02-05 01:19:49.865	15
d217649b-c7b9-458a-82eb-7afc361f780f	2026-02-05 01:06:08.358	3820d25d-6669-4c2d-839b-225b4b70149a	54d360006d20b38944297f7df7b258709966433eaaaec22d67f3270bbe786a25	2026-02-05 01:21:08.358	15
14f311cb-83bc-47a5-b6e1-56bc3dd74061	2026-02-05 01:08:42.782	3820d25d-6669-4c2d-839b-225b4b70149a	f9956312e0a2d50fc1e8e5160d94bcf49be4ad1d0392736383db6db045846923	2026-02-05 01:23:42.782	15
0917ed4c-f891-4394-b2b5-5d5a13f8cd6f	2026-02-05 01:10:38.824	3820d25d-6669-4c2d-839b-225b4b70149a	b757c4e3ef97ecbb758c4fba65321542211ffb07b1119bc990bfe726dceda393	2026-02-05 01:25:38.823	15
2819d366-ae08-4bc5-b8d5-d7525cfa7588	2026-02-05 01:12:44.644	3820d25d-6669-4c2d-839b-225b4b70149a	b69ee86b8eb117fe9196478bc5a58e3f2283806df22696388eb993bcf03c2402	2026-02-05 01:27:44.643	15
9a153230-05e3-4b6c-bd2d-24107f1cb10a	2026-02-05 01:16:49.636	3820d25d-6669-4c2d-839b-225b4b70149a	401b00290bad0d94da35ca006b7ad890b2255e2fe03e0a39f8a9af95123ec49d	2026-02-05 01:31:49.636	15
3624fb1c-69a6-4dcb-ba05-e730b9157950	2026-02-05 01:32:50.27	3820d25d-6669-4c2d-839b-225b4b70149a	c79c3f6e613f948205259ad8bab81d2ca9a3242682dfd3fe1227f8aa23ed9b34	2026-02-05 01:47:50.269	15
05cb49ba-fd4d-4fd9-934d-62a00d4eaa6b	2026-02-05 09:23:35.725	3820d25d-6669-4c2d-839b-225b4b70149a	0d92b587ae558db3d32ab85871c19c4b7fa0944b509244084dfb94879f4c1d3f	2026-02-05 09:38:35.724	15
\.


--
-- Data for Name: ApiKey; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."ApiKey" (id, "createdAt", "updatedAt", "keyHash", "keyPrefix", name, domains, permissions, "isActive", "expiresAt", "lastUsedAt", "businessId") FROM stdin;
76116faa-021d-4ff2-962e-6b56bd623d37	2026-01-29 18:36:50.316	2026-01-29 18:36:50.316	0c665151becb3217df1373bfd08ab8a09ef4b5b56b0257b1608949f443565218	sk_live	Backend Server Primary	{*}	{*}	t	\N	\N	\N
852c090c-81b4-4d26-99d2-3a83d1380be6	2026-01-29 18:37:26.228	2026-02-18 22:48:55.2	e819471684571bcf70fa7fe39eb2df0cce49918eed6d5517857c57395d2d3ea8	sk_live	Backend Server Primary	{*}	{*}	t	\N	2026-02-18 22:48:55.2	\N
\.


--
-- Data for Name: Business; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Business" (id, "createdAt", "updatedAt", name, slug, "logoUrl", website, "supportEmail", "legalName", "registrationNumber", country, "kybStatus", "riskScore", "settlementSchedule", "webhookUrl") FROM stdin;
5e2c2ca2-44df-42d6-ba76-1c3ca4078532	2026-01-31 20:26:15.009	2026-01-31 20:26:15.009	Beta Corp	beta-corp	\N	\N	\N	\N	\N	GH	PENDING	25	DAILY	\N
0f2f36b8-81de-42bc-bd21-6625e1796594	2026-01-31 20:26:15.007	2026-01-31 20:26:15.007	Acme Inc	acme	\N	\N	\N	\N	\N	US	APPROVED	10	WEEKLY	https://acme.example.com/webhook
\.


--
-- Data for Name: BusinessMember; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."BusinessMember" (id, "joinedAt", "userId", "businessId", role, "isActive") FROM stdin;
5e287894-59ff-4d43-a526-a8d04c67dcd5	2026-01-31 20:26:15.024	5b39ec49-3f8c-4485-980b-ad013693187b	5e2c2ca2-44df-42d6-ba76-1c3ca4078532	DEVELOPER	t
4ef6113b-dce7-4c12-ad04-72d9d76ec8d4	2026-01-31 20:26:15.02	1cb6e9eb-9879-4064-9ede-52aea85d9675	0f2f36b8-81de-42bc-bd21-6625e1796594	OWNER	t
2d5b9759-bc3d-47b4-bbf3-927be942a654	2026-01-31 20:26:15.022	e470d5b7-c2db-453f-8bd0-46e8b2e28e6b	0f2f36b8-81de-42bc-bd21-6625e1796594	ADMIN	t
\.


--
-- Data for Name: Chain; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Chain" (id, "createdAt", "updatedAt", "chainId", name, "iconUri") FROM stdin;
b8781661-b981-47ba-a383-b23f5473113a	2026-01-31 20:26:15.146	2026-02-16 20:59:10.572	8453	Base	\N
4861787e-6eb1-4ed4-bf0b-63f0a8b29146	2026-02-16 20:59:10.575	2026-02-16 20:59:10.575	84532	Base Sepolia	\N
9a650246-ef72-4e38-ad16-ef69178c70eb	2026-01-31 20:26:15.149	2026-02-16 20:59:10.577	1	Ethereum	\N
45f3e357-71f8-4e63-adfb-7fc5a0eb7e80	2026-02-01 10:16:41.597	2026-02-16 20:59:10.579	0	MOMO	\N
4813b027-57b5-4d1a-9208-e6a5dc3fa06a	2026-02-01 10:16:41.6	2026-02-16 20:59:10.581	2	BANK	\N
\.


--
-- Data for Name: Claim; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Claim" (id, "createdAt", "updatedAt", "requestId", status, value, price, token, "payerIdentifier", "toIdentifier", code, "otpVerifiedAt") FROM stdin;
4cfb2853-9c96-4ba2-9157-26b9a0e402e0	2026-02-16 20:59:10.524	2026-02-16 20:59:10.524	266e82f2-81c7-4e72-918e-6109a161b35f	ACTIVE	20.00000000	12.50000000	GHS	233201111111	charlie@example.com	123456	\N
834fce99-f35e-482a-b665-bf515b145337	2026-02-18 16:02:37.853	2026-02-18 16:03:55.887	e9d4c68d-5c34-488f-8635-40a24538f539	CLAIMED	30.00000000	1.00000000	USDC	patrickkesh90@gmail.com	pixelhubster@gmail.com	T8NWAZ	2026-02-18 16:02:54.149
0c5fb68a-c1f0-4e0b-a053-f7f212412e4b	2026-02-18 18:36:32.08	2026-02-18 18:36:32.08	331f54f8-cb43-4580-b3ea-e810b6c09558	ACTIVE	20.00000000	1.00000000	USDC	pixelhubster@gmail.com	patrickkesh90@gmail.com	775LJG	\N
af0262ad-a341-4238-b28a-f141b4470046	2026-02-18 18:56:24.639	2026-02-18 18:56:24.639	ed697757-c428-465f-bbd6-2201548f753d	ACTIVE	20.00000000	1.00000000	USDC	pixelhubster@gmail.com	patrickkesh90@gmail.com	XRTFHL	\N
b43324aa-6740-4359-a1ea-cc0f811971ce	2026-02-18 19:12:03.246	2026-02-18 19:19:29.612	abb9b4f4-9d0c-4279-83fd-cc2b55df8cc5	CLAIMED	20.00000000	1.00000000	USDC	pixelhubster@gmail.com	patrickkesh90@gmail.com	NGZVV4	2026-02-18 19:19:05.697
bfbe57f7-0118-41f0-950b-5697ef4a9535	2026-02-18 22:12:40.939	2026-02-18 22:12:40.939	30750c82-dd09-4b14-87b1-23b5585d2c59	ACTIVE	8.13000000	1.00000000	USDC	patrickkesh90@gmail.com	pixelhubster@gmail.com	RNSH4N	\N
bc9da4c1-d597-4863-bd27-e0449495714d	2026-02-18 22:32:47.42	2026-02-18 22:32:47.42	45e9cbac-7c80-4efc-a040-6b48872ac5c6	ACTIVE	8.13000000	1.00000000	USDC	patrickkesh90@gmail.com	pixelhubster@gmail.com	VWHB9Q	\N
6ded934c-77d6-4899-a1e6-05b8789e0b29	2026-02-18 22:48:18.843	2026-02-18 22:48:59.09	56e13173-7552-40d9-ae5c-a0f19d2df6aa	CLAIMED	8.13000000	1.00000000	USDC	patrickkesh90@gmail.com	pixelhubster@gmail.com	9F74SQ	\N
\.


--
-- Data for Name: Country; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Country" (id, "createdAt", "updatedAt", code, name, currency, "supportedFonbnk", "supportedPaystack") FROM stdin;
97cc130b-428e-4783-9f83-29264f1c7744	2026-01-31 20:26:15.095	2026-02-16 20:59:10.532	NG	Nigeria	NGN	t	t
1028ed11-3e9c-43b5-a7eb-1a0035883ac6	2026-01-31 20:26:15.098	2026-02-16 20:59:10.536	KE	Kenya	KES	t	t
8ce9977f-b500-4ca0-9c1f-7115710a6e51	2026-01-31 20:26:15.1	2026-02-16 20:59:10.539	GH	Ghana	GHS	t	t
4aee82ba-a6db-43f1-afc6-e51c809cc2a5	2026-01-31 20:26:15.104	2026-02-16 20:59:10.541	ZA	South Africa	ZAR	t	t
c0c13d5e-3701-4816-b20f-21d314a8008e	2026-01-31 20:26:15.107	2026-02-16 20:59:10.543	TZ	Tanzania	TZS	t	f
b1ba3238-dc07-4f32-9fd3-c357ff94e758	2026-01-31 20:26:15.111	2026-02-16 20:59:10.545	UG	Uganda	UGX	t	f
1259f0da-96bf-4934-aa6a-0ec50a1ec84b	2026-01-31 20:26:15.114	2026-02-16 20:59:10.547	ZM	Zambia	ZMW	t	f
af4a4931-6b82-4299-ac07-801a2abacf01	2026-01-31 20:26:15.117	2026-02-16 20:59:10.549	BF	Burkina Faso	XOF	t	f
3a5836a6-e718-4f6d-8de5-e30beab07846	2026-01-31 20:26:15.12	2026-02-16 20:59:10.551	BR	Brazil	BRL	t	f
6541c6ba-1931-4338-83c9-14c6c7024608	2026-01-31 20:26:15.123	2026-02-16 20:59:10.553	SN	Senegal	XOF	t	f
8d106f89-0c2d-4dda-b900-792edcf6a6ce	2026-01-31 20:26:15.127	2026-02-16 20:59:10.556	CG	Republic of the Congo	XAF	t	f
137dff62-4165-4721-aa3e-22618738f5c5	2026-01-31 20:26:15.129	2026-02-16 20:59:10.558	BJ	Benin	XOF	t	f
8056d131-93ac-4282-9229-58e08a94c692	2026-01-31 20:26:15.132	2026-02-16 20:59:10.56	GA	Gabon	XAF	t	f
07f8c6ed-e7ad-46bd-b1e1-bd0338860d95	2026-01-31 20:26:15.135	2026-02-16 20:59:10.561	RW	Rwanda	RWF	t	f
deedd6e3-06fd-48ce-adee-4c6d4ba2d6d4	2026-01-31 20:26:15.138	2026-02-16 20:59:10.564	CI	Ivory Coast	XOF	t	f
e4f693bb-827e-4e42-a3ed-3d5b0d618aa1	2026-01-31 20:26:15.141	2026-02-16 20:59:10.566	CM	Cameroon	XAF	t	f
07cba770-6e0a-4bab-ab4e-47510377f0d7	2026-01-31 20:26:15.143	2026-02-16 20:59:10.568	MW	Malawi	MWK	t	f
\.


--
-- Data for Name: CryptoTransaction; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."CryptoTransaction" (id, "createdAt", "updatedAt", provider, status, "fromChainId", "toChainId", "fromToken", "toToken", "fromAmount", "toAmount", "txHash", "txUrl", "transactionId", metadata) FROM stdin;
\.


--
-- Data for Name: FailedOrderValidation; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."FailedOrderValidation" (id, "createdAt", reason, code, payload, "requestId") FROM stdin;
9a70d700-a1d0-4979-8ad6-b3380958ec2c	2026-02-15 23:32:03.286	Insufficient KLYRA balance: USDC on BASE has 0, required 8.13	INSUFFICIENT_FUNDS	{"action": "buy", "f_chain": "MOMO", "f_token": "GHS", "t_chain": "BASE", "t_token": "USDC", "f_amount": 100, "t_amount": 8.13, "f_provider": "PAYSTACK", "t_provider": "KLYRA"}	\N
260cb2af-e451-4d3a-83ea-ba845dbbaf0a	2026-02-16 21:06:40.493	Unsupported f_chain: BASE SEPOLIA	UNSUPPORTED_F_CHAIN	{"action": "sell", "f_chain": "BASE SEPOLIA", "f_token": "USDC", "t_chain": "MOMO", "t_token": "GHS", "f_amount": 50, "t_amount": 536.25, "f_provider": "KLYRA", "t_provider": "PAYSTACK"}	\N
4c760cb7-cc89-4a75-ba9c-2d0cdc6bb0a7	2026-02-16 21:13:16.579	Token USDC not supported on chain BASE SEPOLIA	UNSUPPORTED_F_TOKEN	{"action": "sell", "f_chain": "BASE SEPOLIA", "f_token": "USDC", "t_chain": "MOMO", "t_token": "GHS", "f_amount": 50, "t_amount": 536.25, "f_provider": "KLYRA", "t_provider": "PAYSTACK"}	\N
\.


--
-- Data for Name: FeeSchedule; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."FeeSchedule" (id, "businessId", "flatFee", "percentageFee", "maxFee") FROM stdin;
c8d2afe1-5c09-4e17-b362-83f94ad95b0c	0f2f36b8-81de-42bc-bd21-6625e1796594	0.00	1.00	50.00
\.


--
-- Data for Name: InventoryAsset; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."InventoryAsset" (id, "updatedAt", chain, "tokenAddress", symbol, "currentBalance", "chainId", address, "walletId") FROM stdin;
036dfe18-25dd-4392-9418-b521cabd1b15	2026-02-05 09:35:59.745	ETHEREUM	0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48	USDC	1050.61000000	1	default	\N
f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	2026-02-16 20:11:44.878	BASE	0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913	USDC	1192.22000000	8453	default	\N
5ac16f0e-3cea-47d5-bba1-f4f16ecb4c32	2026-02-18 15:49:49.889	BASE SEPOLIA	0x036CbD53842c5426634e7929541eC2318f3dCF7e 	USDC	600.00000000	84532	0x9f08eFb0767Bf180B8b8094FaaEF9DAB5a0755e1	\N
2c642e41-e230-4aed-95be-8e79011adbe3	2026-02-05 09:32:16.353	ETHEREUM	0x0000000000000000000000000000000000000000	ETH	0.50000000	1	0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1	d50ad47b-41b3-4ddf-b557-4d81775ac406
26d2538a-d527-4bb1-8c88-ddfd0188d29a	2026-02-05 09:35:16.473	ETHEREUM	0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48	USDC	1012.57000000	1	0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1	d50ad47b-41b3-4ddf-b557-4d81775ac406
5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	2026-02-05 09:35:57.503	BASE	0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913	USDC	1100.59000000	8453	0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1	d50ad47b-41b3-4ddf-b557-4d81775ac406
\.


--
-- Data for Name: InventoryLedger; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."InventoryLedger" (id, "createdAt", "assetId", type, quantity, "pricePerTokenUsd", "totalValueUsd", "referenceId", counterparty) FROM stdin;
1bda4d4e-1aad-4d52-9276-63ad54cecb60	2026-02-05 09:33:47.717	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	ACQUIRED	20.03000000	1.00000000	20.03000000	90786e01-62a6-41f0-91e8-52320294c495	\N
ecbf8f91-3560-483f-bd10-aedccd228f77	2026-02-05 09:33:54.52	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	DISPOSED	-13.51000000	1.00000000	13.51000000	b0492501-c7e3-4b92-be8a-ae1d23aeab0d	\N
fbc479d0-c716-4bbf-b2c5-7858cf3d447f	2026-02-05 09:34:00.219	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	ACQUIRED	16.05000000	1.00000000	16.05000000	13deaa7d-3f2a-494e-8e24-47ceabc3d8c9	\N
433e0f80-210d-49f7-9cf4-a25d3bb8c608	2026-02-05 09:34:10.613	26d2538a-d527-4bb1-8c88-ddfd0188d29a	DISPOSED	-4.84000000	1.00000000	4.84000000	1bea6ded-8e0b-49d5-8463-c9f65a3ebaf3	\N
2a9c5d14-7eb3-48ee-8c16-302039a8f7bf	2026-02-05 09:34:12.865	036dfe18-25dd-4392-9418-b521cabd1b15	ACQUIRED	15.82000000	1.00000000	15.82000000	17190f7d-ae3e-4db3-ad1d-b90a4f33717f	\N
ba852b15-e698-449f-a23d-492759158598	2026-02-05 09:34:15.111	26d2538a-d527-4bb1-8c88-ddfd0188d29a	DISPOSED	-5.59000000	1.00000000	5.59000000	a6965172-c1b2-4250-af56-29db435cbbc7	\N
14539f18-e71f-47d7-81b6-bc6e16fa2eb6	2026-02-05 09:34:17.365	036dfe18-25dd-4392-9418-b521cabd1b15	DISPOSED	-4.02000000	1.00000000	4.02000000	a3e3f327-a492-462f-bf61-ce088e5dee4c	\N
315b2ec6-7ecd-4b60-8519-9f0d3edbcfa8	2026-02-05 09:34:19.632	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	ACQUIRED	12.24000000	1.00000000	12.24000000	6898851c-d5e9-42b5-816d-d6d066a04a22	\N
35851e20-42e7-418a-8965-04d13cd21300	2026-02-05 09:34:29.952	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	ACQUIRED	35.34000000	1.00000000	35.34000000	46f2d054-c2be-4c37-b22f-036e0fdc1225	\N
ade9122f-3749-435d-80bf-33414e6ba00b	2026-02-05 09:34:35.642	26d2538a-d527-4bb1-8c88-ddfd0188d29a	DISPOSED	-6.09000000	1.00000000	6.09000000	58043e60-8ae9-4ada-a802-44221ffabd76	\N
912e2c8e-b1f1-4830-a17e-f286245ead72	2026-02-05 09:34:37.886	036dfe18-25dd-4392-9418-b521cabd1b15	ACQUIRED	8.05000000	1.00000000	8.05000000	bcbace83-4d44-4235-a6c7-359076e63a1b	\N
50a7ec24-af5d-4668-a52d-10117d5614a9	2026-02-05 09:34:44.684	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	ACQUIRED	31.21000000	1.00000000	31.21000000	f116468a-e8eb-4c7a-9fac-e33d8cc0cad8	\N
f3f49dfc-8d0c-448d-b9bb-3fc06ee3f258	2026-02-05 09:34:54.929	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	DISPOSED	-10.17000000	1.00000000	10.17000000	32e38d92-0f3a-466e-af0e-b09e02da11b8	\N
c8addbda-cd87-4b29-aae8-b1fef2a68ee9	2026-02-05 09:35:16.474	26d2538a-d527-4bb1-8c88-ddfd0188d29a	ACQUIRED	29.09000000	1.00000000	29.09000000	691d015c-a8c2-46ae-85a4-5ca31b00eaaa	\N
be08eb99-d334-40df-908d-1bce7e7e731c	2026-02-05 09:35:18.728	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	ACQUIRED	30.45000000	1.00000000	30.45000000	6257516f-1125-467f-b385-2f6e1b362cd0	\N
fd7b3cc6-853a-4239-98a6-c915d9a3bab8	2026-02-05 09:35:24.42	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	ACQUIRED	29.75000000	1.00000000	29.75000000	ef789e7f-6774-4df3-9124-e079384c72d4	\N
d4f9bcb9-fb16-4650-95d5-42eb44c832e2	2026-02-05 09:35:57.504	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	ACQUIRED	40.20000000	1.00000000	40.20000000	ba053616-4978-4c60-9437-42b9203fa252	\N
a2df2d43-f51b-4872-9c04-d14d4ac55894	2026-02-05 09:35:59.746	036dfe18-25dd-4392-9418-b521cabd1b15	ACQUIRED	30.76000000	1.00000000	30.76000000	0448d287-35df-4a77-811d-e92a8b6882a8	\N
ae1ac8db-b418-45ce-905d-b8e404020ec7	2026-02-15 23:40:19.047	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	DISPOSED	-8.13000000	1.00000000	8.13000000	85cca9de-4928-45b4-82d6-e021251935f6	\N
6c056a06-4c05-4fc7-b8c1-2dedfb2bf3fe	2026-02-15 23:53:47.595	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	DISPOSED	-8.13000000	1.00000000	8.13000000	c78ef7e7-5d0c-416b-a5a0-41cd8f057e62	\N
a018c6b8-dbb9-4f46-8692-5c4f2676adef	2026-02-15 23:58:26.617	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	DISPOSED	-8.13000000	1.00000000	8.13000000	9d396034-17a5-49a4-bb57-1d6d008533ba	\N
561d5264-8dab-4d45-80cb-dc2e1c495535	2026-02-16 00:01:53.98	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	DISPOSED	-8.13000000	1.00000000	8.13000000	40e61efc-1892-41a0-9274-d3f8408b3937	\N
45558956-204d-41ea-8f54-ed452a6e6dda	2026-02-16 00:08:36.837	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	DISPOSED	-8.13000000	1.00000000	8.13000000	cd09f925-fd96-4c59-89cd-2df4127a4b88	\N
43b6836d-9085-4526-9627-dafbeb5b9cad	2026-02-16 00:16:10.698	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	DISPOSED	-8.13000000	1.00000000	8.13000000	38ddb174-d876-4876-9725-5cb824f61abf	\N
c7a94cea-d67c-4550-aaa5-edcd043379fe	2026-02-16 19:02:34.936	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	ACQUIRED	50.00000000	1.00000000	50.00000000	5dcb75e8-1e6d-4446-b5c4-c6ca680c4c9a	\N
573f04f7-c1c2-4c9d-9423-3a8fa0f1bc29	2026-02-16 19:39:40.047	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	ACQUIRED	50.00000000	1.00000000	50.00000000	c19791e6-64c6-4221-bfb0-890a552b1c45	\N
e63a0711-2792-4651-a518-57122c9ee9a2	2026-02-16 20:11:44.879	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	ACQUIRED	50.00000000	1.00000000	50.00000000	aff07d87-fb2c-4017-9442-a1cc9644f7e6	\N
00000000-0000-0000-0000-000000000011	2026-02-16 20:59:10.662	2c642e41-e230-4aed-95be-8e79011adbe3	ACQUIRED	0.05000000	2000.00000000	100.00000000		\N
00000000-0000-0000-0000-000000000010	2026-02-16 20:59:10.66	26d2538a-d527-4bb1-8c88-ddfd0188d29a	DISPOSED	-100.00000000	1.00000000	100.00000000		\N
ca511c83-2edc-4122-9f61-acc29342756f	2026-02-16 22:08:42.828	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c32	ACQUIRED	50.00000000	1.00000000	50.00000000	ea352c13-d5c8-4098-9a2d-0d17cbbf4776	\N
bd8a6a9c-76ec-421a-b127-feda534eb334	2026-02-18 15:49:49.891	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c32	ACQUIRED	50.00000000	1.00000000	50.00000000	91904f26-1f5a-44cc-8708-6e9fabe2f51e	\N
\.


--
-- Data for Name: InventoryLot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."InventoryLot" (id, "createdAt", "assetId", "acquiredAt", "sourceType", "sourceTransactionId", "originalQuantity", "remainingQuantity", "costPerTokenUsd", "totalCostUsd", status) FROM stdin;
cca927a0-e8a3-4328-88ad-d3da65d0446c	2026-02-05 09:34:12.867	036dfe18-25dd-4392-9418-b521cabd1b15	2026-02-05 09:34:12.867	PURCHASE	17190f7d-ae3e-4db3-ad1d-b90a4f33717f	15.82000000	11.80000000	1.00000000	15.82000000	OPEN
0724df34-820a-4932-9a92-510a8ae0b899	2026-02-05 09:34:19.633	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	2026-02-05 09:34:19.633	PURCHASE	6898851c-d5e9-42b5-816d-d6d066a04a22	12.24000000	12.24000000	1.00000000	12.24000000	OPEN
0d0f6830-5803-4bd6-aa6e-f51be218f846	2026-02-05 09:34:37.888	036dfe18-25dd-4392-9418-b521cabd1b15	2026-02-05 09:34:37.888	PURCHASE	bcbace83-4d44-4235-a6c7-359076e63a1b	8.05000000	8.05000000	1.00000000	8.05000000	OPEN
5386e868-ca47-4641-b8d2-adb4c591c8c7	2026-02-05 09:34:44.686	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	2026-02-05 09:34:44.686	PURCHASE	f116468a-e8eb-4c7a-9fac-e33d8cc0cad8	31.21000000	31.21000000	1.00000000	31.21000000	OPEN
851f0637-db61-4936-860f-74508c0fd349	2026-02-05 09:35:16.475	26d2538a-d527-4bb1-8c88-ddfd0188d29a	2026-02-05 09:35:16.475	PURCHASE	691d015c-a8c2-46ae-85a4-5ca31b00eaaa	29.09000000	29.09000000	1.00000000	29.09000000	OPEN
223c1e97-f704-44b3-8bda-9e1e105abcb7	2026-02-05 09:35:18.729	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	2026-02-05 09:35:18.729	PURCHASE	6257516f-1125-467f-b385-2f6e1b362cd0	30.45000000	30.45000000	1.00000000	30.45000000	OPEN
651eeced-eb62-49cc-b39a-7375e7d22be2	2026-02-05 09:35:24.421	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	2026-02-05 09:35:24.421	PURCHASE	ef789e7f-6774-4df3-9124-e079384c72d4	29.75000000	29.75000000	1.00000000	29.75000000	OPEN
2e289e78-188a-4f8a-bfc6-600136fa4bb4	2026-02-05 09:35:57.505	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	2026-02-05 09:35:57.505	PURCHASE	ba053616-4978-4c60-9437-42b9203fa252	40.20000000	40.20000000	1.00000000	40.20000000	OPEN
3e949eb6-e4c1-4c09-8e9a-9f07c13c3579	2026-02-05 09:35:59.747	036dfe18-25dd-4392-9418-b521cabd1b15	2026-02-05 09:35:59.747	PURCHASE	0448d287-35df-4a77-811d-e92a8b6882a8	30.76000000	30.76000000	1.00000000	30.76000000	OPEN
4ff03d7d-e822-468d-87d3-77222724e961	2026-02-05 09:33:47.719	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	2026-02-05 09:33:47.719	PURCHASE	90786e01-62a6-41f0-91e8-52320294c495	20.03000000	0.00000000	1.00000000	20.03000000	DEPLETED
2686ef0d-b403-48f8-8ca9-106ce73d378f	2026-02-05 09:34:00.221	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	2026-02-05 09:34:00.221	PURCHASE	13deaa7d-3f2a-494e-8e24-47ceabc3d8c9	16.05000000	0.00000000	1.00000000	16.05000000	DEPLETED
65839da1-2b8c-474b-9380-a4e335b504c2	2026-02-05 09:34:29.953	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	2026-02-05 09:34:29.953	PURCHASE	46f2d054-c2be-4c37-b22f-036e0fdc1225	35.34000000	12.47000000	1.00000000	35.34000000	OPEN
1e0b3f34-1732-4de1-8ac7-d8e4449c4d1c	2026-02-16 19:02:34.943	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	2026-02-16 19:02:34.943	PURCHASE	5dcb75e8-1e6d-4446-b5c4-c6ca680c4c9a	50.00000000	50.00000000	1.00000000	50.00000000	OPEN
139d03e7-eea3-4e92-bedf-ad5565d10e89	2026-02-16 19:39:40.048	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	2026-02-16 19:39:40.048	PURCHASE	c19791e6-64c6-4221-bfb0-890a552b1c45	50.00000000	50.00000000	1.00000000	50.00000000	OPEN
8d239596-6064-4f85-86f8-014954ddb0fe	2026-02-16 20:11:44.882	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	2026-02-16 20:11:44.882	PURCHASE	aff07d87-fb2c-4017-9442-a1cc9644f7e6	50.00000000	50.00000000	1.00000000	50.00000000	OPEN
9f5738e8-213e-466c-8afe-eaa1e8cd31ee	2026-02-16 22:08:42.833	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c32	2026-02-16 22:08:42.833	PURCHASE	ea352c13-d5c8-4098-9a2d-0d17cbbf4776	50.00000000	50.00000000	1.00000000	50.00000000	OPEN
33816c4e-91df-4e81-acc2-3b70afa9222b	2026-02-18 15:49:49.897	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c32	2026-02-18 15:49:49.897	PURCHASE	91904f26-1f5a-44cc-8708-6e9fabe2f51e	50.00000000	50.00000000	1.00000000	50.00000000	OPEN
\.


--
-- Data for Name: Invoice; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Invoice" (id, "createdAt", "updatedAt", "invoiceNumber", status, amount, currency, "currencyLabel", "paidAt", "batchTitle", "billedTo", "billingDetails", subject, issued, "dueDate", notes, "lineItems", subtotal, "discountPercent", "discountAmount", total, "amountDue", "termsAndConditions", "notesContent", log) FROM stdin;
\.


--
-- Data for Name: Payout; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Payout" (id, "createdAt", "updatedAt", "businessId", "methodId", amount, fee, currency, status, reference, "batchId") FROM stdin;
00000000-0000-0000-000b-000000000001	2026-01-31 20:26:15.052	2026-01-31 20:26:15.052	0f2f36b8-81de-42bc-bd21-6625e1796594	00000000-0000-0000-000a-000000000001	50230.00000000	25.00000000	USD	PAID	WIRE-REF-8821	batch-8821
\.


--
-- Data for Name: PayoutMethod; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PayoutMethod" (id, "createdAt", "businessId", type, currency, details, "isPrimary", "isActive") FROM stdin;
00000000-0000-0000-000a-000000000001	2026-01-31 20:26:15.045	0f2f36b8-81de-42bc-bd21-6625e1796594	BANK_ACCOUNT	USD	{"bankCode": "063", "accountName": "Acme Inc", "accountNumber": "****1234"}	t	t
\.


--
-- Data for Name: PayoutRequest; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PayoutRequest" (id, code, "transactionId", status, amount, currency, "recipientCode", "createdAt", "updatedAt", "transferCode", "transferReference", "recipientName", "recipientType") FROM stdin;
6152b514-fadf-440c-8968-4fe06a11bba0	pGZeAZWst84-9Pt-	aff07d87-fb2c-4017-9442-a1cc9644f7e6	failed	\N	\N	\N	2026-02-16 20:13:22.958	2026-02-16 20:13:23.326	\N	\N	\N	\N
01b6abcd-24bd-48c8-a124-a0f5890fe24a	6ozAUFLIomPBaBe7	ea352c13-d5c8-4098-9a2d-0d17cbbf4776	failed	\N	\N	\N	2026-02-16 22:09:51.168	2026-02-16 22:09:51.822	\N	\N	\N	\N
2f909666-3ec8-43af-b1d5-33509b4dbda5	pUYf5fIjvKvvxmrW	91904f26-1f5a-44cc-8708-6e9fabe2f51e	failed	\N	\N	\N	2026-02-18 15:50:38.608	2026-02-18 15:50:39.233	\N	\N	\N	\N
\.


--
-- Data for Name: PaystackPaymentRecord; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PaystackPaymentRecord" (id, reference, "paystackId", "transactionId", status, amount, currency, "paidAt", channel, "gatewayResponse", "customerEmail", metadata, "rawResponse", "createdAt", "updatedAt") FROM stdin;
fc606de8-1ed5-4c34-b4d5-750332b0548c	fav0zxnfnk	5842249185	85cca9de-4928-45b4-82d6-e021251935f6	success	10000.00000000	GHS	2026-02-15 23:40:34	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "85cca9de-4928-45b4-82d6-e021251935f6"}	{"id": 5842249185, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 3, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771198831, "time_spent": 3}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-15T23:40:34.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-15T23:40:34.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "85cca9de-4928-45b4-82d6-e021251935f6"}, "order_id": null, "createdAt": "2026-02-15T23:40:19.000Z", "reference": "fav0zxnfnk", "created_at": "2026-02-15T23:40:19.000Z", "fees_split": null, "ip_address": "154.160.1.117", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-15T23:40:19.000Z", "pos_transaction_data": null}	2026-02-15 23:40:49.684	2026-02-15 23:40:49.684
34cda5e4-fc06-4d34-b1bc-935b6f74821a	e4n8qq3co9	5842261330	9d396034-17a5-49a4-bb57-1d6d008533ba	success	10000.00000000	GHS	2026-02-15 23:58:37	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "9d396034-17a5-49a4-bb57-1d6d008533ba"}	{"id": 5842261330, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 2, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771199915, "time_spent": 2}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-15T23:58:37.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-15T23:58:37.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "9d396034-17a5-49a4-bb57-1d6d008533ba"}, "order_id": null, "createdAt": "2026-02-15T23:58:27.000Z", "reference": "e4n8qq3co9", "created_at": "2026-02-15T23:58:27.000Z", "fees_split": null, "ip_address": "154.160.1.117", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-15T23:58:27.000Z", "pos_transaction_data": null}	2026-02-15 23:58:49.235	2026-02-15 23:58:49.235
189d447f-b033-4f6f-8a13-240f97ace4ab	y2cfwi36yt	5842264540	40e61efc-1892-41a0-9274-d3f8408b3937	success	10000.00000000	GHS	2026-02-16 00:02:05	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "40e61efc-1892-41a0-9274-d3f8408b3937"}	{"id": 5842264540, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 2, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771200123, "time_spent": 2}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-16T00:02:05.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-16T00:02:05.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "40e61efc-1892-41a0-9274-d3f8408b3937"}, "order_id": null, "createdAt": "2026-02-16T00:01:54.000Z", "reference": "y2cfwi36yt", "created_at": "2026-02-16T00:01:54.000Z", "fees_split": null, "ip_address": "154.160.1.117", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-16T00:01:54.000Z", "pos_transaction_data": null}	2026-02-16 00:02:19.555	2026-02-16 00:02:19.555
f18346f9-3d72-474a-a53b-54aeaeefb4ba	9rdscz0ga2	5842270878	cd09f925-fd96-4c59-89cd-2df4127a4b88	success	10000.00000000	GHS	2026-02-16 00:08:47	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "cd09f925-fd96-4c59-89cd-2df4127a4b88"}	{"id": 5842270878, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 2, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771200525, "time_spent": 2}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-16T00:08:47.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-16T00:08:47.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "cd09f925-fd96-4c59-89cd-2df4127a4b88"}, "order_id": null, "createdAt": "2026-02-16T00:08:37.000Z", "reference": "9rdscz0ga2", "created_at": "2026-02-16T00:08:37.000Z", "fees_split": null, "ip_address": "154.160.1.117", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-16T00:08:37.000Z", "pos_transaction_data": null}	2026-02-16 00:09:02.306	2026-02-16 00:09:02.306
82f2e5c2-dd13-4e36-a29e-6aecca34aa10	pnpr8nhjlb	5842276481	38ddb174-d876-4876-9725-5cb824f61abf	success	10000.00000000	GHS	2026-02-16 00:16:19	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "38ddb174-d876-4876-9725-5cb824f61abf"}	{"id": 5842276481, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 1, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771200978, "time_spent": 1}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-16T00:16:19.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-16T00:16:19.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "38ddb174-d876-4876-9725-5cb824f61abf"}, "order_id": null, "createdAt": "2026-02-16T00:16:11.000Z", "reference": "pnpr8nhjlb", "created_at": "2026-02-16T00:16:11.000Z", "fees_split": null, "ip_address": "154.160.1.117", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-16T00:16:11.000Z", "pos_transaction_data": null}	2026-02-16 00:16:33.79	2026-02-16 00:16:33.79
cf5ca9ec-0476-4365-996e-1a86d5d506bf	oyeefd63lq	5843236617	079d38da-2125-4bb5-950c-952dbe0faa41	success	10000.00000000	GHS	2026-02-16 09:14:17	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "079d38da-2125-4bb5-950c-952dbe0faa41"}	{"id": 5843236617, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 3, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771233254, "time_spent": 3}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-16T09:14:17.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-16T09:14:17.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "079d38da-2125-4bb5-950c-952dbe0faa41"}, "order_id": null, "createdAt": "2026-02-16T09:14:07.000Z", "reference": "oyeefd63lq", "created_at": "2026-02-16T09:14:07.000Z", "fees_split": null, "ip_address": "154.160.0.136", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-16T09:14:07.000Z", "pos_transaction_data": null}	2026-02-16 09:14:29.928	2026-02-16 09:14:29.928
c32f302b-e3ca-4ee4-8f86-635a8f8c902d	ypmswsglvu	5843307500	1828d7f1-dfdc-4c3e-8096-a33bc8d5f58e	success	10000.00000000	GHS	2026-02-16 09:40:29	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "1828d7f1-dfdc-4c3e-8096-a33bc8d5f58e"}	{"id": 5843307500, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 3, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771234826, "time_spent": 3}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-16T09:40:29.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-16T09:40:29.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "1828d7f1-dfdc-4c3e-8096-a33bc8d5f58e"}, "order_id": null, "createdAt": "2026-02-16T09:40:19.000Z", "reference": "ypmswsglvu", "created_at": "2026-02-16T09:40:19.000Z", "fees_split": null, "ip_address": "154.160.0.136", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-16T09:40:19.000Z", "pos_transaction_data": null}	2026-02-16 09:40:42.592	2026-02-16 09:40:42.592
037ab96b-82af-4c76-88f4-34437c0b83ed	2puboqu7ax	5843317705	3ecb514c-255f-47fe-95d6-f1647ec4842b	success	10000.00000000	GHS	2026-02-16 09:44:09	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "3ecb514c-255f-47fe-95d6-f1647ec4842b"}	{"id": 5843317705, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 1, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771235048, "time_spent": 1}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-16T09:44:09.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-16T09:44:09.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "3ecb514c-255f-47fe-95d6-f1647ec4842b"}, "order_id": null, "createdAt": "2026-02-16T09:43:56.000Z", "reference": "2puboqu7ax", "created_at": "2026-02-16T09:43:56.000Z", "fees_split": null, "ip_address": "154.160.0.136", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-16T09:43:56.000Z", "pos_transaction_data": null}	2026-02-16 09:44:25.543	2026-02-16 09:44:25.543
9df50516-b13c-4706-b9f7-97bf9a5b1850	pu6hm1xqh8	5843329823	ffbf119e-7c4d-42be-a8fe-e9e580af48cf	success	30000.00000000	GHS	2026-02-16 09:48:15	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "ffbf119e-7c4d-42be-a8fe-e9e580af48cf"}	{"id": 5843329823, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 1, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771235294, "time_spent": 1}, "fees": 585, "plan": null, "split": {}, "amount": 30000, "domain": "test", "paidAt": "2026-02-16T09:48:15.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-16T09:48:15.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "ffbf119e-7c4d-42be-a8fe-e9e580af48cf"}, "order_id": null, "createdAt": "2026-02-16T09:48:05.000Z", "reference": "pu6hm1xqh8", "created_at": "2026-02-16T09:48:05.000Z", "fees_split": null, "ip_address": "154.160.0.136", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 30000, "transaction_date": "2026-02-16T09:48:05.000Z", "pos_transaction_data": null}	2026-02-16 09:48:27.144	2026-02-16 09:48:27.144
9f226819-5658-4aa6-b517-fbf0ec4cfca9	02jujcqe3x	5848479803	c711eabe-5c14-4bb4-8cf2-a04571c01715	success	10000.00000000	GHS	2026-02-18 01:46:50	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "c711eabe-5c14-4bb4-8cf2-a04571c01715"}	{"id": 5848479803, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 2, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771379208, "time_spent": 2}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-18T01:46:50.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T01:46:50.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "c711eabe-5c14-4bb4-8cf2-a04571c01715"}, "order_id": null, "createdAt": "2026-02-18T01:46:41.000Z", "reference": "02jujcqe3x", "created_at": "2026-02-18T01:46:41.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-18T01:46:41.000Z", "pos_transaction_data": null}	2026-02-18 01:47:00.468	2026-02-18 01:47:00.468
faf8e189-c262-4c63-b6f1-366fefa3fc11	vivgm65pyi	5848487943	ee9389e4-c167-4077-9a1c-e04c6bb228d2	success	10000.00000000	GHS	2026-02-18 02:00:05	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "ee9389e4-c167-4077-9a1c-e04c6bb228d2"}	{"id": 5848487943, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 2, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771380003, "time_spent": 2}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-18T02:00:05.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T02:00:05.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "ee9389e4-c167-4077-9a1c-e04c6bb228d2"}, "order_id": null, "createdAt": "2026-02-18T01:59:55.000Z", "reference": "vivgm65pyi", "created_at": "2026-02-18T01:59:55.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-18T01:59:55.000Z", "pos_transaction_data": null}	2026-02-18 02:00:17.267	2026-02-18 02:00:17.267
36254cc6-f261-4e6a-80ac-6e855d33183e	ksom36vtrb	5848493925	72a64109-7181-43e4-a0ac-fe440816b8b1	success	10000.00000000	GHS	2026-02-18 02:09:19	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "72a64109-7181-43e4-a0ac-fe440816b8b1"}	{"id": 5848493925, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 2, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771380558, "time_spent": 2}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-18T02:09:19.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T02:09:19.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "72a64109-7181-43e4-a0ac-fe440816b8b1"}, "order_id": null, "createdAt": "2026-02-18T02:09:11.000Z", "reference": "ksom36vtrb", "created_at": "2026-02-18T02:09:11.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-18T02:09:11.000Z", "pos_transaction_data": null}	2026-02-18 02:09:29.532	2026-02-18 02:09:29.532
929036f6-0333-47a3-b1b7-253d96042122	xvo5o4qk9l	5850370343	17936d69-9f0f-4463-b5a8-a7618a1b0f5d	success	10000.00000000	GHS	2026-02-18 15:24:34	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "17936d69-9f0f-4463-b5a8-a7618a1b0f5d"}	{"id": 5850370343, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 24, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771428250, "time_spent": 24}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-18T15:24:34.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T15:24:34.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "17936d69-9f0f-4463-b5a8-a7618a1b0f5d"}, "order_id": null, "createdAt": "2026-02-18T15:24:04.000Z", "reference": "xvo5o4qk9l", "created_at": "2026-02-18T15:24:04.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-18T15:24:04.000Z", "pos_transaction_data": null}	2026-02-18 15:24:46.971	2026-02-18 15:24:46.971
7749cef1-97fc-49f9-9306-d67282a3fc58	ix4d7zo6mf	5850375526	f5521c8a-e013-4d87-87ae-654cc8369953	success	10000.00000000	GHS	2026-02-18 15:26:46	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "f5521c8a-e013-4d87-87ae-654cc8369953"}	{"id": 5850375526, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 2, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771428404, "time_spent": 2}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-18T15:26:46.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T15:26:46.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "f5521c8a-e013-4d87-87ae-654cc8369953"}, "order_id": null, "createdAt": "2026-02-18T15:26:39.000Z", "reference": "ix4d7zo6mf", "created_at": "2026-02-18T15:26:39.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-18T15:26:39.000Z", "pos_transaction_data": null}	2026-02-18 15:27:02.14	2026-02-18 15:27:02.14
856bf6ca-4090-4630-aa1e-be1719c4c0e9	soqy6n5xcc	5850398772	7cb37b35-1be4-4dcd-89d1-b4a28d282f60	success	10000.00000000	GHS	2026-02-18 15:38:37	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "7cb37b35-1be4-4dcd-89d1-b4a28d282f60"}	{"id": 5850398772, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 3, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771429114, "time_spent": 3}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-18T15:38:37.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T15:38:37.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "7cb37b35-1be4-4dcd-89d1-b4a28d282f60"}, "order_id": null, "createdAt": "2026-02-18T15:38:29.000Z", "reference": "soqy6n5xcc", "created_at": "2026-02-18T15:38:29.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-18T15:38:29.000Z", "pos_transaction_data": null}	2026-02-18 15:38:50.545	2026-02-18 15:38:50.545
482b7313-181a-4281-a0d7-aef76dfe6bc2	gs7528qzqu	5850411058	b808f77b-7d00-4a0b-ae5a-4c8dd2da6a05	success	10000.00000000	GHS	2026-02-18 15:45:00	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "b808f77b-7d00-4a0b-ae5a-4c8dd2da6a05"}	{"id": 5850411058, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 2, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771429498, "time_spent": 2}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-18T15:45:00.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T15:45:00.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "b808f77b-7d00-4a0b-ae5a-4c8dd2da6a05"}, "order_id": null, "createdAt": "2026-02-18T15:44:51.000Z", "reference": "gs7528qzqu", "created_at": "2026-02-18T15:44:51.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-18T15:44:51.000Z", "pos_transaction_data": null}	2026-02-18 15:45:11.694	2026-02-18 15:45:11.694
44b4d302-e73e-4a22-84b6-c9eb0ac21ca9	pc62zmt08c	5850415281	0a398744-50b6-4d1a-a552-06ebf89e024a	success	10000.00000000	GHS	2026-02-18 15:46:59	mobile_money	Approved	patrickesh90@gmail.com	{"transaction_id": "0a398744-50b6-4d1a-a552-06ebf89e024a"}	{"id": 5850415281, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 3, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771429616, "time_spent": 3}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-18T15:46:59.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T15:46:59.000Z", "currency": "GHS", "customer": {"id": 340530934, "email": "patrickesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_c2c3xldo2krh19q", "international_format_phone": null}, "metadata": {"transaction_id": "0a398744-50b6-4d1a-a552-06ebf89e024a"}, "order_id": null, "createdAt": "2026-02-18T15:46:51.000Z", "reference": "pc62zmt08c", "created_at": "2026-02-18T15:46:51.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-18T15:46:51.000Z", "pos_transaction_data": null}	2026-02-18 15:47:10.615	2026-02-18 15:47:10.615
c3115553-8661-4c22-8691-277a1540d4b7	416kzh3l6d	5850935310	b3a3ebe9-17a0-4edc-9d48-2810deb98f8e	success	2000.00000000	GHS	2026-02-18 19:16:37	mobile_money	Approved	pixelhubster@gmail.com	{"transaction_id": "b3a3ebe9-17a0-4edc-9d48-2810deb98f8e"}	{"id": 5850935310, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 2, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771442195, "time_spent": 2}, "fees": 39, "plan": null, "split": {}, "amount": 2000, "domain": "test", "paidAt": "2026-02-18T19:16:37.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T19:16:37.000Z", "currency": "GHS", "customer": {"id": 318244163, "email": "pixelhubster@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_llsry4wtzm6gcw8", "international_format_phone": null}, "metadata": {"transaction_id": "b3a3ebe9-17a0-4edc-9d48-2810deb98f8e"}, "order_id": null, "createdAt": "2026-02-18T19:16:17.000Z", "reference": "416kzh3l6d", "created_at": "2026-02-18T19:16:17.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 2000, "transaction_date": "2026-02-18T19:16:17.000Z", "pos_transaction_data": null}	2026-02-18 19:16:51.025	2026-02-18 19:16:51.025
c06d0749-c54c-4e53-b23f-b51881eadde6	kbzrcvlrmo	5851367824	6f25f584-c0ec-41e5-b138-0a429f4d545e	success	10000.00000000	GHS	2026-02-18 22:48:42	mobile_money	Approved	patrickkesh90@gmail.com	{"transaction_id": "6f25f584-c0ec-41e5-b138-0a429f4d545e"}	{"id": 5851367824, "log": {"input": [], "errors": 0, "mobile": false, "history": [{"time": 6, "type": "action", "message": "Attempted to pay with mobile money"}], "success": false, "attempts": 1, "start_time": 1771454916, "time_spent": 6}, "fees": 195, "plan": null, "split": {}, "amount": 10000, "domain": "test", "paidAt": "2026-02-18T22:48:42.000Z", "source": null, "status": "success", "channel": "mobile_money", "connect": null, "message": null, "paid_at": "2026-02-18T22:48:42.000Z", "currency": "GHS", "customer": {"id": 317829213, "email": "patrickkesh90@gmail.com", "phone": null, "metadata": null, "last_name": null, "first_name": null, "risk_action": "default", "customer_code": "CUS_qpd06n6v1boyxre", "international_format_phone": null}, "metadata": {"transaction_id": "6f25f584-c0ec-41e5-b138-0a429f4d545e"}, "order_id": null, "createdAt": "2026-02-18T22:48:25.000Z", "reference": "kbzrcvlrmo", "created_at": "2026-02-18T22:48:25.000Z", "fees_split": null, "ip_address": "154.160.19.154", "subaccount": {}, "plan_object": {}, "authorization": {"bank": "MTN", "channel": "mobile_money", "reusable": false, "card_type": "", "country_code": "GH"}, "fees_breakdown": null, "receipt_number": "10101", "gateway_response": "Approved", "requested_amount": 10000, "transaction_date": "2026-02-18T22:48:25.000Z", "pos_transaction_data": null}	2026-02-18 22:48:55.772	2026-02-18 22:48:55.772
\.


--
-- Data for Name: PaystackTransferRecord; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PaystackTransferRecord" (id, reference, "transferCode", "payoutRequestId", amount, currency, status, "recipientName", reason, "rawResponse", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: PlatformAdmin; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PlatformAdmin" (id, "createdAt", "updatedAt", email, name, role, "twoFaEnabled", "emailVerifiedAt", "passwordHash", "totpSecret") FROM stdin;
3820d25d-6669-4c2d-839b-225b4b70149a	2026-02-05 01:02:57.813	2026-02-05 01:03:39.967	patrickkesh90@gmail.com	\N	super_admin	t	2026-02-05 01:02:57.812	$argon2id$v=19$m=65536,t=3,p=4$NXBxjnIaIv+ppa0ZA4rF+Q$83mdsFT+BNb9JkObl3P8Z7YBsDcajHuK916XGKZoHCw	GVT3YVCV2XZVB6GNVAQYQZIT3FWJXZ64
\.


--
-- Data for Name: PlatformSetting; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PlatformSetting" (id, key, value, "updatedAt") FROM stdin;
288e351d-1a66-44e3-8df0-dc80acf92edb	general	{"timezone": "UTC", "publicName": "MyCryptoApp", "supportEmail": "", "supportPhone": "", "defaultCurrency": "USD", "maintenanceMode": false}	2026-01-31 20:26:15.164
9429f588-8a69-4f40-abec-e2771ece493e	financials	{"fixedFee": 0, "baseFeePercent": 1, "lowBalanceAlert": 1000, "maxTransactionSize": 1000000, "minTransactionSize": 0}	2026-01-31 20:26:15.168
d3d9df14-427b-4f23-91c0-97a153bc6a70	providers	{"providers": [{"id": "SQUID", "apiKey": "", "status": "operational", "enabled": true, "priority": 1, "latencyMs": null}, {"id": "LIFI", "apiKey": "", "status": "operational", "enabled": true, "priority": 2, "latencyMs": null}, {"id": "0X", "apiKey": "", "status": "operational", "enabled": true, "priority": 3, "latencyMs": null}, {"id": "PAYSTACK", "apiKey": "", "status": "operational", "enabled": true, "priority": 4, "latencyMs": null}], "maxSlippagePercent": 1}	2026-01-31 20:26:15.172
4036d055-eafb-407f-aadf-c021e05ee9b6	risk	{"blacklist": [], "blockHighRiskIp": false, "enforceKycOver1000": false}	2026-01-31 20:26:15.176
defc2b49-5ec7-43e2-8ae9-ed06277c74d5	api	{"alertEmails": "", "slackWebhookUrl": "", "webhookSigningSecret": ""}	2026-01-31 20:26:15.18
\.


--
-- Data for Name: ProviderRouting; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."ProviderRouting" (id, "createdAt", "updatedAt", code, name, status, operational, enabled, "keyHash", "keyPrefix", priority, fee) FROM stdin;
0567c262-2ae5-4b7d-b2a1-d88c0a82f3ca	2026-02-01 10:16:41.647	2026-02-01 10:16:41.647	SQUID	SQUID	ACTIVE	t	t	\N	\N	1	\N
f6b3f40f-9549-4642-8123-b16df54d4951	2026-02-01 10:16:41.653	2026-02-01 10:16:41.653	LIFI	LIFI	ACTIVE	t	t	\N	\N	2	\N
ec7a7b65-e9bb-44e1-ae0f-f881904e40ca	2026-02-01 10:16:41.659	2026-02-01 10:16:41.659	ZERO_X	0x	ACTIVE	t	t	\N	\N	3	\N
59c1864b-b8c2-4b10-a135-1096ffef73fe	2026-02-01 10:16:41.665	2026-02-01 10:16:41.665	PAYSTACK	PAYSTACK	ACTIVE	t	t	\N	\N	4	\N
\.


--
-- Data for Name: Request; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Request" (id, "createdAt", "updatedAt", code, "linkId", "transactionId", "payoutTarget", "payoutFiat") FROM stdin;
266e82f2-81c7-4e72-918e-6109a161b35f	2026-02-16 20:59:10.51	2026-02-16 20:59:10.51	REQ8A8790	link1abc	00000000-0000-0000-0000-000000000003	\N	\N
e9d4c68d-5c34-488f-8635-40a24538f539	2026-02-18 16:02:37.842	2026-02-18 16:02:37.842	REQ7D673A10	2c9edf8a75639de2	5bcdc0cb-992a-41f7-9f16-069251041fb0	\N	\N
331f54f8-cb43-4580-b3ea-e810b6c09558	2026-02-18 18:36:32.064	2026-02-18 18:36:32.064	REQ031F3EE3	14afa1d6b5644f33	1adc4010-fc4e-4d2e-a346-3125bb8f7c75	\N	\N
ed697757-c428-465f-bbd6-2201548f753d	2026-02-18 18:56:24.624	2026-02-18 18:56:24.624	REQ6077E33E	95f45ecb68da9e6d	06f49c4b-4c4b-4609-95b7-e8f70c6b18d5	\N	\N
abb9b4f4-9d0c-4279-83fd-cc2b55df8cc5	2026-02-18 19:12:03.228	2026-02-18 19:12:03.228	REQ8E899295	728fafff7432a4a2	b3a3ebe9-17a0-4edc-9d48-2810deb98f8e	\N	\N
30750c82-dd09-4b14-87b1-23b5585d2c59	2026-02-18 22:12:40.929	2026-02-18 22:12:40.929	REQ8F668CB4	be159bdd3cd303bc	6c5020a7-b536-45e3-a31b-67a7859cb696	\N	\N
45e9cbac-7c80-4efc-a040-6b48872ac5c6	2026-02-18 22:32:47.408	2026-02-18 22:32:47.408	REQ618212C9	5dabfc2dba084dcb	0d85e881-3537-44cc-84a0-8cb227a882ef	0xf0830060f836B8d54bF02049E5905F619487989e	\N
56e13173-7552-40d9-ae5c-a0f19d2df6aa	2026-02-18 22:48:18.829	2026-02-18 22:48:18.829	REQ0B7A19EE	11f5b5bb0c4440a5	6f25f584-c0ec-41e5-b138-0a429f4d545e	0xf0830060f836B8d54bF02049E5905F619487989e	\N
\.


--
-- Data for Name: SupportedToken; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."SupportedToken" (id, "createdAt", "updatedAt", "chainId", "tokenAddress", symbol, decimals, name, "logoUri", "fonbnkCode") FROM stdin;
7b601a3a-30b8-4d81-8d06-8e4dd2614ebb	2026-01-31 20:26:15.161	2026-02-16 20:59:10.604	1	0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE	ETH	18	Ether	\N	ETHEREUM_NATIVE
6e3d3205-f038-4e3a-b89e-ffacbeb11991	2026-02-01 10:16:41.614	2026-02-16 20:59:10.606	0	0x0000000000000000000000000000000000000000	GHS	2	Ghana Cedi	\N	MOMO_GHS
28da75a5-3d44-4372-a9c5-68ea6e241df3	2026-02-01 10:16:41.618	2026-02-16 20:59:10.609	0	0x0000000000000000000000000000000000000001	USD	2	US Dollar	\N	MOMO_USD
d43a97d5-590c-45c3-aad7-6b7852761ae8	2026-02-01 10:16:41.62	2026-02-16 20:59:10.612	2	0x0000000000000000000000000000000000000000	USD	2	US Dollar	\N	BANK_USD
3e00d75b-8001-4bcf-a573-be03c85df661	2026-01-31 20:26:15.152	2026-02-16 20:59:10.584	8453	0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913	USDC	6	USD Coin	\N	BASE_USDC
d7a56c35-5f8c-4a17-9ca7-6386fab905e1	2026-01-31 20:26:15.155	2026-02-16 20:59:10.587	8453	0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE	ETH	18	Ether	\N	BASE_ETH
4586d4a9-621f-41ce-9821-d2884822c664	2026-02-03 15:01:13.358	2026-02-16 20:59:10.591	8453	0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb	DAI	18	Dai Stablecoin	\N	\N
747b9821-28b1-4d27-a474-bdd0ac3f267d	2026-02-16 20:59:10.594	2026-02-16 20:59:10.594	84532	0x036CbD53842c5426634e7929541eC2318f3dCF7e	USDC	6	USD Coin (Base Sepolia)	\N	BASE_SEPOLIA_USDC
e71096d5-3fca-437a-9670-87346c265b8b	2026-02-16 20:59:10.599	2026-02-16 20:59:10.599	84532	0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE	ETH	18	Ether	\N	BASE_SEPOLIA_ETH
3c9d0845-ab9d-44d3-8860-c5e2b43f7356	2026-01-31 20:26:15.158	2026-02-16 20:59:10.601	1	0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48	USDC	6	USD Coin	\N	ETHEREUM_USDC
\.


--
-- Data for Name: Transaction; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Transaction" (id, "createdAt", "updatedAt", type, status, "fromIdentifier", "fromType", "fromUserId", "toIdentifier", "toType", "toUserId", f_amount, t_amount, f_token, t_token, f_provider, t_provider, "requestId", f_chain, t_chain, "providerSessionId", "businessId", "merchantFee", "platformFee", fee, "providerPrice", "settlementQuoteSnapshot", "cryptoSendTxHash", "exchangeRate", "f_tokenPriceUsd", "t_tokenPriceUsd", "feeInUsd", "paymentConfirmedAt") FROM stdin;
90786e01-62a6-41f0-91e8-52320294c495	2026-02-05 09:33:47.702	2026-02-05 09:33:47.73	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	20.03000000	214.82000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	5.60839519	5.60839519	11.00000000	\N	\N	10.72491263	1.00000000	0.09328358	0.52317118	\N
b0492501-c7e3-4b92-be8a-ae1d23aeab0d	2026-02-05 09:33:54.496	2026-02-05 09:33:54.533	BUY	COMPLETED	alice@example.com	EMAIL	\N	0xf0830060f836B8d54bF02049E5905F619487989e	ADDRESS	\N	166.17000000	13.51000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	\N	\N	0.00000000	4.05300615	4.05300615	12.00000000	\N	\N	0.08130228	0.08130081	1.00000000	0.32951268	\N
13deaa7d-3f2a-494e-8e24-47ceabc3d8c9	2026-02-05 09:34:00.202	2026-02-05 09:34:00.238	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	16.05000000	172.14000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	4.49399615	4.49399615	11.00000000	\N	\N	10.72523364	1.00000000	0.09328358	0.41921605	\N
1bea6ded-8e0b-49d5-8463-c9f65a3ebaf3	2026-02-05 09:34:10.598	2026-02-05 09:34:10.622	BUY	COMPLETED	alice@example.com	EMAIL	\N	0xf0830060f836B8d54bF02049E5905F619487989e	ADDRESS	\N	59.53000000	4.84000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	ETHEREUM	\N	\N	0.00000000	1.45200220	1.45200220	12.00000000	\N	\N	0.08130354	0.08130081	1.00000000	0.11804895	\N
17190f7d-ae3e-4db3-ad1d-b90a4f33717f	2026-02-05 09:34:12.847	2026-02-05 09:34:12.883	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	15.82000000	169.64000000	USDC	GHS	KLYRA	PAYSTACK	\N	ETHEREUM	MOMO	\N	\N	0.00000000	4.42959620	4.42959620	11.00000000	\N	\N	10.72313527	1.00000000	0.09328358	0.41320859	\N
a6965172-c1b2-4250-af56-29db435cbbc7	2026-02-05 09:34:15.095	2026-02-05 09:34:15.125	BUY	COMPLETED	alice@example.com	EMAIL	\N	0xf0830060f836B8d54bF02049E5905F619487989e	ADDRESS	\N	68.78000000	5.59000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	ETHEREUM	\N	\N	0.00000000	1.67700254	1.67700254	12.00000000	\N	\N	0.08127363	0.08130081	1.00000000	0.13634166	\N
a3e3f327-a492-462f-bf61-ce088e5dee4c	2026-02-05 09:34:17.346	2026-02-05 09:34:17.381	BUY	COMPLETED	alice@example.com	EMAIL	\N	0xf0830060f836B8d54bF02049E5905F619487989e	ADDRESS	\N	49.45000000	4.02000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	ETHEREUM	\N	\N	0.00000000	1.20600183	1.20600183	12.00000000	\N	\N	0.08129424	0.08130081	1.00000000	0.09804893	\N
6898851c-d5e9-42b5-816d-d6d066a04a22	2026-02-05 09:34:19.617	2026-02-05 09:34:19.646	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	12.24000000	131.27000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	3.42719706	3.42719706	11.00000000	\N	\N	10.72467320	1.00000000	0.09328358	0.31970121	\N
46f2d054-c2be-4c37-b22f-036e0fdc1225	2026-02-05 09:34:29.935	2026-02-05 09:34:29.967	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	35.34000000	379.02000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	9.89519151	9.89519151	11.00000000	\N	\N	10.72495756	1.00000000	0.09328358	0.92305889	\N
58043e60-8ae9-4ada-a802-44221ffabd76	2026-02-05 09:34:35.621	2026-02-05 09:34:35.655	BUY	COMPLETED	alice@example.com	EMAIL	\N	0xf0830060f836B8d54bF02049E5905F619487989e	ADDRESS	\N	74.91000000	6.09000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	ETHEREUM	\N	\N	0.00000000	1.82700277	1.82700277	12.00000000	\N	\N	0.08129756	0.08130081	1.00000000	0.14853681	\N
bcbace83-4d44-4235-a6c7-359076e63a1b	2026-02-05 09:34:37.872	2026-02-05 09:34:37.911	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	8.05000000	86.35000000	USDC	GHS	KLYRA	PAYSTACK	\N	ETHEREUM	MOMO	\N	\N	0.00000000	2.25399807	2.25399807	11.00000000	\N	\N	10.72670807	1.00000000	0.09328358	0.21026101	\N
f116468a-e8eb-4c7a-9fac-e33d8cc0cad8	2026-02-05 09:34:44.669	2026-02-05 09:34:44.698	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	31.21000000	334.70000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	8.73879251	8.73879251	11.00000000	\N	\N	10.72412688	1.00000000	0.09328358	0.81518585	\N
32e38d92-0f3a-466e-af0e-b09e02da11b8	2026-02-05 09:34:54.912	2026-02-05 09:34:54.946	BUY	COMPLETED	alice@example.com	EMAIL	\N	0xf0830060f836B8d54bF02049E5905F619487989e	ADDRESS	\N	125.04000000	10.17000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	\N	\N	0.00000000	3.05100463	3.05100463	12.00000000	\N	\N	0.08133397	0.08130081	1.00000000	0.24804915	\N
691d015c-a8c2-46ae-85a4-5ca31b00eaaa	2026-02-05 09:35:16.454	2026-02-05 09:35:16.488	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	29.09000000	311.99000000	USDC	GHS	KLYRA	PAYSTACK	\N	ETHEREUM	MOMO	\N	\N	0.00000000	8.14519301	8.14519301	11.00000000	\N	\N	10.72499141	1.00000000	0.09328358	0.75981276	\N
6257516f-1125-467f-b385-2f6e1b362cd0	2026-02-05 09:35:18.711	2026-02-05 09:35:18.744	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	30.45000000	326.61000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	8.52599269	8.52599269	11.00000000	\N	\N	10.72610837	1.00000000	0.09328358	0.79533512	\N
ef789e7f-6774-4df3-9124-e079384c72d4	2026-02-05 09:35:24.406	2026-02-05 09:35:24.434	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	29.75000000	319.04000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	8.32999286	8.32999286	11.00000000	\N	\N	10.72403361	1.00000000	0.09328358	0.77705156	\N
ba053616-4978-4c60-9437-42b9203fa252	2026-02-05 09:35:57.491	2026-02-05 09:35:57.515	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	40.20000000	431.15000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	11.25599035	11.25599035	11.00000000	\N	\N	10.72512438	1.00000000	0.09328358	1.04999908	\N
0448d287-35df-4a77-811d-e92a8b6882a8	2026-02-05 09:35:59.733	2026-02-05 09:35:59.76	SELL	COMPLETED	alice@example.com	ADDRESS	\N	233201234567	NUMBER	\N	30.76000000	329.90000000	USDC	GHS	KLYRA	PAYSTACK	\N	ETHEREUM	MOMO	\N	\N	0.00000000	8.61279261	8.61279261	11.00000000	\N	\N	10.72496749	1.00000000	0.09328358	0.80343213	\N
85cca9de-4928-45b4-82d6-e021251935f6	2026-02-15 23:40:18.986	2026-02-15 23:40:19.556	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x9f08eFb0767Bf180B8b8094FaaEF9DAB5a0755e1	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	fav0zxnfnk	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
c78ef7e7-5d0c-416b-a5a0-41cd8f057e62	2026-02-15 23:53:47.533	2026-02-15 23:53:47.624	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	\N	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
9d396034-17a5-49a4-bb57-1d6d008533ba	2026-02-15 23:58:26.55	2026-02-15 23:58:27.116	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	e4n8qq3co9	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
40e61efc-1892-41a0-9274-d3f8408b3937	2026-02-16 00:01:53.941	2026-02-16 00:01:54.444	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	y2cfwi36yt	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
cd09f925-fd96-4c59-89cd-2df4127a4b88	2026-02-16 00:08:36.776	2026-02-16 00:08:37.331	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	9rdscz0ga2	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
38ddb174-d876-4876-9725-5cb824f61abf	2026-02-16 00:16:10.631	2026-02-16 00:16:11.345	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	pnpr8nhjlb	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
079d38da-2125-4bb5-950c-952dbe0faa41	2026-02-16 09:14:07.067	2026-02-16 09:14:07.688	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	oyeefd63lq	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
1828d7f1-dfdc-4c3e-8096-a33bc8d5f58e	2026-02-16 09:40:18.72	2026-02-16 09:40:23.651	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	ypmswsglvu	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	0xd073f6ee658bf39ed626ac94e28c7a0633c6f1864baa439b1b5694bd1cc3e116	0.08130000	0.08130081	1.00000000	0.19829298	\N
3ecb514c-255f-47fe-95d6-f1647ec4842b	2026-02-16 09:43:55.815	2026-02-16 09:43:59.812	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	2puboqu7ax	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	0xf123743c17dd08db01037c8c7f367c90da30423cb60ef4384dd39d1e03194eb8	0.08130000	0.08130081	1.00000000	0.19829298	\N
ffbf119e-7c4d-42be-a8fe-e9e580af48cf	2026-02-16 09:48:05.292	2026-02-16 09:48:10.058	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	300.00000000	24.39000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE	pu6hm1xqh8	\N	0.00000000	7.31701110	7.31701110	12.00000000	\N	0x4ad2bfb66599b1b96631afab769dbe81c808a9184a5cb3cb06dc2e3b6ce65574	0.08130000	0.08130081	1.00000000	0.59487893	\N
5dcb75e8-1e6d-4446-b5c4-c6ca680c4c9a	2026-02-16 19:02:34.867	2026-02-16 19:02:34.984	SELL	COMPLETED	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	233548496120	NUMBER	\N	50.00000000	536.25000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	13.99998799	13.99998799	11.00000000	\N	\N	10.72500000	1.00000000	0.09328358	1.30596900	\N
c19791e6-64c6-4221-bfb0-890a552b1c45	2026-02-16 19:39:40	2026-02-16 19:39:40.079	SELL	COMPLETED	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	233541234567	NUMBER	\N	50.00000000	536.25000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	13.99998799	13.99998799	11.00000000	\N	\N	10.72500000	1.00000000	0.09328358	1.30596900	\N
aff07d87-fb2c-4017-9442-a1cc9644f7e6	2026-02-16 20:11:44.849	2026-02-16 20:11:44.903	SELL	COMPLETED	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	233541234567	NUMBER	\N	50.00000000	536.25000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE	MOMO	\N	\N	0.00000000	13.99998799	13.99998799	11.00000000	\N	\N	10.72500000	1.00000000	0.09328358	1.30596900	\N
00000000-0000-0000-0000-000000000001	2026-02-16 20:59:10.478	2026-02-16 20:59:10.478	BUY	COMPLETED	alice@example.com	EMAIL	1cb6e9eb-9879-4064-9ede-52aea85d9675	0x1111111111111111111111111111111111111111	ADDRESS	\N	100.00000000	0.05000000	USDC	ETH	NONE	SQUID	\N	ETHEREUM	ETHEREUM	\N	0f2f36b8-81de-42bc-bd21-6625e1796594	0.50000000	1.00000000	\N	\N	\N	\N	0.00050000	1.00000000	2000.00000000	\N	\N
00000000-0000-0000-0000-000000000002	2026-02-16 20:59:10.495	2026-02-16 20:59:10.495	SELL	COMPLETED	0x2222222222222222222222222222222222222222	ADDRESS	e470d5b7-c2db-453f-8bd0-46e8b2e28e6b	bob@example.com	EMAIL	\N	0.02000000	40.00000000	ETH	USDC	NONE	NONE	\N	ETHEREUM	ETHEREUM	\N	0f2f36b8-81de-42bc-bd21-6625e1796594	0.20000000	0.40000000	\N	\N	\N	\N	2000.00000000	2000.00000000	1.00000000	\N	\N
00000000-0000-0000-0000-000000000003	2026-02-16 20:59:10.504	2026-02-16 20:59:10.52	REQUEST	PENDING	charlie@example.com	EMAIL	\N	233201111111	NUMBER	\N	20.00000000	20.00000000	GHS	GHS	NONE	NONE	266e82f2-81c7-4e72-918e-6109a161b35f	ETHEREUM	ETHEREUM	\N	\N	0.00000000	0.00000000	\N	\N	\N	\N	1.00000000	0.08000000	0.08000000	\N	\N
ea352c13-d5c8-4098-9a2d-0d17cbbf4776	2026-02-16 22:08:42.777	2026-02-16 22:08:42.866	SELL	COMPLETED	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	0541234567	NUMBER	\N	50.00000000	536.25000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE SEPOLIA	MOMO	\N	\N	0.00000000	13.99998799	13.99998799	11.00000000	\N	\N	10.72500000	1.00000000	0.09328358	1.30596900	\N
17936d69-9f0f-4463-b5a8-a7618a1b0f5d	2026-02-18 15:24:03.874	2026-02-18 15:24:04.563	BUY	PENDING	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE SEPOLIA	xvo5o4qk9l	\N	0.00000000	0.00000000	\N	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	\N	\N
c711eabe-5c14-4bb4-8cf2-a04571c01715	2026-02-18 01:46:40.598	2026-02-18 01:46:41.175	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE SEPOLIA	02jujcqe3x	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
ee9389e4-c167-4077-9a1c-e04c6bb228d2	2026-02-18 01:59:55.305	2026-02-18 01:59:55.776	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE SEPOLIA	vivgm65pyi	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
0ec900f7-eb29-4e55-a555-409d125530cb	2026-02-18 02:08:48.955	2026-02-18 02:08:48.984	BUY	COMPLETED	patrickkesh90@gmail.como	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE SEPOLIA	\N	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
06f49c4b-4c4b-4609-95b7-e8f70c6b18d5	2026-02-18 18:56:24.608	2026-02-18 18:56:24.634	REQUEST	PENDING	pixelhubster@gmail.com	EMAIL	\N	patrickkesh90@gmail.com	EMAIL	\N	0.00000000	20.00000000	GHS	USDC	PAYSTACK	KLYRA	ed697757-c428-465f-bbd6-2201548f753d	MOMO	BASE SEPOLIA	\N	\N	0.00000000	0.00000000	\N	\N	\N	\N	\N	\N	\N	\N	\N
72a64109-7181-43e4-a0ac-fe440816b8b1	2026-02-18 02:09:11.365	2026-02-18 02:09:11.828	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE SEPOLIA	ksom36vtrb	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	0.19829298	\N
0a398744-50b6-4d1a-a552-06ebf89e024a	2026-02-18 15:46:50.815	2026-02-18 15:47:14.483	BUY	COMPLETED	patrickesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE SEPOLIA	pc62zmt08c	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	0x3bf3eeadbff65ab93745f74c48f4e19d58aa09240b31622346b66f73aa54840b	0.08130000	0.08130081	1.00000000	\N	2026-02-18 15:47:10.623
f5521c8a-e013-4d87-87ae-654cc8369953	2026-02-18 15:26:38.714	2026-02-18 15:26:39.177	BUY	PENDING	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE SEPOLIA	ix4d7zo6mf	\N	0.00000000	0.00000000	\N	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	\N	\N
7cb37b35-1be4-4dcd-89d1-b4a28d282f60	2026-02-18 15:38:29.23	2026-02-18 15:38:29.75	BUY	PENDING	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE SEPOLIA	soqy6n5xcc	\N	0.00000000	0.00000000	\N	12.00000000	\N	\N	0.08130000	0.08130081	1.00000000	\N	\N
91904f26-1f5a-44cc-8708-6e9fabe2f51e	2026-02-18 15:49:49.856	2026-02-18 15:49:49.924	SELL	COMPLETED	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	0541234567	NUMBER	\N	50.00000000	536.25000000	USDC	GHS	KLYRA	PAYSTACK	\N	BASE SEPOLIA	MOMO	\N	\N	0.00000000	13.99998799	13.99998799	11.00000000	\N	\N	10.72500000	1.00000000	0.09328358	1.30596900	\N
b808f77b-7d00-4a0b-ae5a-4c8dd2da6a05	2026-02-18 15:44:51.249	2026-02-18 15:45:15.552	BUY	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	0x10eD8629e6b34FC39c215945221360c808CdbBFa	ADDRESS	\N	100.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	\N	MOMO	BASE SEPOLIA	gs7528qzqu	\N	0.00000000	2.43900370	2.43900370	12.00000000	\N	0xb0115249697bfa22b749d71bec419fbf9f518078b1fbe5d094184d4a28410526	0.08130000	0.08130081	1.00000000	\N	2026-02-18 15:45:11.701
5bcdc0cb-992a-41f7-9f16-069251041fb0	2026-02-18 16:02:37.827	2026-02-18 16:03:55.89	REQUEST	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	pixelhubster@gmail.com	EMAIL	\N	0.00000000	30.00000000	GHS	USDC	PAYSTACK	KLYRA	e9d4c68d-5c34-488f-8635-40a24538f539	MOMO	BASE	\N	\N	0.00000000	0.00000000	\N	\N	\N	\N	\N	\N	\N	\N	\N
1adc4010-fc4e-4d2e-a346-3125bb8f7c75	2026-02-18 18:36:32.04	2026-02-18 18:36:32.075	REQUEST	PENDING	pixelhubster@gmail.com	EMAIL	\N	patrickkesh90@gmail.com	EMAIL	\N	0.00000000	20.00000000	GHS	USDC	PAYSTACK	KLYRA	331f54f8-cb43-4580-b3ea-e810b6c09558	MOMO	BASE SEPOLIA	\N	\N	0.00000000	0.00000000	\N	\N	\N	\N	\N	\N	\N	\N	\N
6f25f584-c0ec-41e5-b138-0a429f4d545e	2026-02-18 22:48:18.819	2026-02-18 22:48:59.082	REQUEST	COMPLETED	patrickkesh90@gmail.com	EMAIL	\N	pixelhubster@gmail.com	EMAIL	\N	0.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	56e13173-7552-40d9-ae5c-a0f19d2df6aa	MOMO	BASE SEPOLIA	kbzrcvlrmo	\N	0.00000000	0.00000000	0.00000000	\N	\N	0xf3324fbd403502eea3b342a2d51c4d058d806f2f20693810a9a100dfbf322b00	\N	\N	\N	\N	2026-02-18 22:48:55.784
b3a3ebe9-17a0-4edc-9d48-2810deb98f8e	2026-02-18 19:12:03.209	2026-02-18 19:19:29.615	REQUEST	COMPLETED	pixelhubster@gmail.com	EMAIL	\N	patrickkesh90@gmail.com	EMAIL	\N	0.00000000	20.00000000	GHS	USDC	PAYSTACK	KLYRA	abb9b4f4-9d0c-4279-83fd-cc2b55df8cc5	MOMO	BASE SEPOLIA	416kzh3l6d	\N	0.00000000	0.00000000	0.00000000	\N	\N	\N	\N	\N	\N	\N	2026-02-18 19:16:51.038
6c5020a7-b536-45e3-a31b-67a7859cb696	2026-02-18 22:12:40.92	2026-02-18 22:12:44.788	REQUEST	PENDING	patrickkesh90@gmail.com	EMAIL	\N	pixelhubster@gmail.com	EMAIL	\N	0.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	30750c82-dd09-4b14-87b1-23b5585d2c59	MOMO	BASE SEPOLIA	dd5j6sif66	\N	0.00000000	0.00000000	\N	\N	\N	\N	\N	\N	\N	\N	\N
0d85e881-3537-44cc-84a0-8cb227a882ef	2026-02-18 22:32:47.399	2026-02-18 22:32:55.091	REQUEST	PENDING	patrickkesh90@gmail.com	EMAIL	\N	pixelhubster@gmail.com	EMAIL	\N	0.00000000	8.13000000	GHS	USDC	PAYSTACK	KLYRA	45e9cbac-7c80-4efc-a040-6b48872ac5c6	MOMO	BASE SEPOLIA	ha7bzzogwg	\N	0.00000000	0.00000000	\N	\N	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: TransactionBalanceSnapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."TransactionBalanceSnapshot" (id, "createdAt", "transactionId", "assetId", "balanceBefore", "balanceAfter") FROM stdin;
d1492fdd-1ea4-4cef-89ae-f2840e9549fa	2026-02-05 09:33:47.722	90786e01-62a6-41f0-91e8-52320294c495	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1000.00000000	1020.03000000
42646e61-931f-4d32-a738-e2bc388e80ac	2026-02-05 09:33:54.524	b0492501-c7e3-4b92-be8a-ae1d23aeab0d	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	1000.00000000	986.49000000
6c29617d-5d6c-4ea7-9ba1-7df9fe236281	2026-02-05 09:34:00.227	13deaa7d-3f2a-494e-8e24-47ceabc3d8c9	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1020.03000000	1036.08000000
8a3fd9b1-5625-422c-b881-1c50175ffc59	2026-02-05 09:34:10.616	1bea6ded-8e0b-49d5-8463-c9f65a3ebaf3	26d2538a-d527-4bb1-8c88-ddfd0188d29a	1000.00000000	995.16000000
1a2488d2-d20a-4a72-aef8-6cc216b82210	2026-02-05 09:34:12.871	17190f7d-ae3e-4db3-ad1d-b90a4f33717f	036dfe18-25dd-4392-9418-b521cabd1b15	1000.00000000	1015.82000000
ee203a90-909a-4aa6-a846-a62b5e0bfb43	2026-02-05 09:34:15.114	a6965172-c1b2-4250-af56-29db435cbbc7	26d2538a-d527-4bb1-8c88-ddfd0188d29a	995.16000000	989.57000000
188a358c-8bac-41f2-8b2a-201d00547662	2026-02-05 09:34:17.368	a3e3f327-a492-462f-bf61-ce088e5dee4c	036dfe18-25dd-4392-9418-b521cabd1b15	1015.82000000	1011.80000000
5392ae2a-334d-4d1b-b1e1-05833f2e2d54	2026-02-05 09:34:19.637	6898851c-d5e9-42b5-816d-d6d066a04a22	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	986.49000000	998.73000000
ba3c2c55-f6c0-41e7-b42a-aed4ced6510a	2026-02-05 09:34:29.957	46f2d054-c2be-4c37-b22f-036e0fdc1225	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1036.08000000	1071.42000000
ed545a02-97e5-485f-aeb6-548d4089d1ed	2026-02-05 09:34:35.647	58043e60-8ae9-4ada-a802-44221ffabd76	26d2538a-d527-4bb1-8c88-ddfd0188d29a	989.57000000	983.48000000
21158da1-4bae-4f89-bb52-ac72a90fb3f4	2026-02-05 09:34:37.896	bcbace83-4d44-4235-a6c7-359076e63a1b	036dfe18-25dd-4392-9418-b521cabd1b15	1011.80000000	1019.85000000
98cd380f-2608-4613-a2f9-2927efded1ec	2026-02-05 09:34:44.689	f116468a-e8eb-4c7a-9fac-e33d8cc0cad8	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	998.73000000	1029.94000000
ea46097f-d940-4d6a-9ae3-491c3687a921	2026-02-05 09:34:54.934	32e38d92-0f3a-466e-af0e-b09e02da11b8	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1071.42000000	1061.25000000
f08ff480-cb45-4cba-aed1-19e9a4c425df	2026-02-05 09:35:16.478	691d015c-a8c2-46ae-85a4-5ca31b00eaaa	26d2538a-d527-4bb1-8c88-ddfd0188d29a	983.48000000	1012.57000000
7041b0d4-abab-4afa-8346-e48965a854c3	2026-02-05 09:35:18.733	6257516f-1125-467f-b385-2f6e1b362cd0	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	1029.94000000	1060.39000000
743a5417-e2a9-4931-96cf-329d5a6df2ad	2026-02-05 09:35:24.426	ef789e7f-6774-4df3-9124-e079384c72d4	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1061.25000000	1091.00000000
17c02b71-3ec8-4dab-81f7-5cb18b8e7718	2026-02-05 09:35:57.508	ba053616-4978-4c60-9437-42b9203fa252	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c7f	1060.39000000	1100.59000000
eb474d38-abb4-44bf-ad0b-2aee8c7d3d8b	2026-02-05 09:35:59.75	0448d287-35df-4a77-811d-e92a8b6882a8	036dfe18-25dd-4392-9418-b521cabd1b15	1019.85000000	1050.61000000
8c1da55a-9b43-4b27-b86b-309bb64666bd	2026-02-15 23:40:19.058	85cca9de-4928-45b4-82d6-e021251935f6	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1091.00000000	1082.87000000
ad294650-3f14-4dc0-a638-e97119885555	2026-02-15 23:53:47.601	c78ef7e7-5d0c-416b-a5a0-41cd8f057e62	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1082.87000000	1074.74000000
9430dff0-c05e-44c3-98c4-1a31b3c87233	2026-02-15 23:58:26.625	9d396034-17a5-49a4-bb57-1d6d008533ba	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1074.74000000	1066.61000000
19f1fe83-5a19-47a2-a969-2c07f11827f5	2026-02-16 00:01:53.986	40e61efc-1892-41a0-9274-d3f8408b3937	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1066.61000000	1058.48000000
7c8ac13a-5ca1-4b85-894a-63c4b356d398	2026-02-16 00:08:36.847	cd09f925-fd96-4c59-89cd-2df4127a4b88	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1058.48000000	1050.35000000
d1f17c73-3826-4e8d-b9a9-450c5591c908	2026-02-16 00:16:10.706	38ddb174-d876-4876-9725-5cb824f61abf	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1050.35000000	1042.22000000
2ae6e089-e2c8-47e1-8e42-e4eaf9c5e070	2026-02-16 19:02:34.958	5dcb75e8-1e6d-4446-b5c4-c6ca680c4c9a	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1042.22000000	1092.22000000
44439611-2566-4637-91b7-7a7bb6978602	2026-02-16 19:39:40.059	c19791e6-64c6-4221-bfb0-890a552b1c45	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1092.22000000	1142.22000000
f2a498fa-3555-41ba-bea7-a68029b795ad	2026-02-16 20:11:44.889	aff07d87-fb2c-4017-9442-a1cc9644f7e6	f3ec39d4-239b-4224-bcd9-8f74cd71d4e0	1142.22000000	1192.22000000
6f3ca694-ea01-4ce9-b1af-69865ae7fa6b	2026-02-16 22:08:42.843	ea352c13-d5c8-4098-9a2d-0d17cbbf4776	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c32	500.00000000	550.00000000
6bf8c5ae-abc9-4ffc-bb79-6bb607ba8ed6	2026-02-18 15:49:49.906	91904f26-1f5a-44cc-8708-6e9fabe2f51e	5ac16f0e-3cea-47d5-bba1-f4f16ecb4c32	550.00000000	600.00000000
\.


--
-- Data for Name: TransactionPnL; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."TransactionPnL" (id, "createdAt", "transactionId", "lotId", quantity, "costPerTokenUsd", "feeAmountUsd", "profitLossUsd") FROM stdin;
f41662b4-426b-4137-b52d-d2de1e896e7a	2026-02-05 09:34:17.37	a3e3f327-a492-462f-bf61-ce088e5dee4c	cca927a0-e8a3-4328-88ad-d3da65d0446c	4.02000000	1.00000000	0.09837381	0.00000000
777af637-4d8f-4460-80f0-44e48e29d7e8	2026-02-05 09:34:54.937	32e38d92-0f3a-466e-af0e-b09e02da11b8	4ff03d7d-e822-468d-87d3-77222724e961	10.17000000	1.00000000	0.24390282	0.00000000
1a670762-7ab1-4f7b-8f97-b1883c9acd71	2026-02-15 23:40:19.067	85cca9de-4928-45b4-82d6-e021251935f6	4ff03d7d-e822-468d-87d3-77222724e961	8.13000000	1.00000000	0.19837398	0.00000000
9da39f05-40e2-4ca8-b6c0-3239127525c7	2026-02-15 23:53:47.607	c78ef7e7-5d0c-416b-a5a0-41cd8f057e62	4ff03d7d-e822-468d-87d3-77222724e961	1.73000000	1.00000000	0.04221242	0.00000000
8c2f04b3-7640-4733-9a94-3185d38b5f10	2026-02-15 23:53:47.607	c78ef7e7-5d0c-416b-a5a0-41cd8f057e62	2686ef0d-b403-48f8-8ca9-106ce73d378f	6.40000000	1.00000000	0.15616156	0.00000000
b63c5f79-9bd5-4dc2-8745-228da7bbb552	2026-02-15 23:58:26.632	9d396034-17a5-49a4-bb57-1d6d008533ba	2686ef0d-b403-48f8-8ca9-106ce73d378f	8.13000000	1.00000000	0.19837398	0.00000000
90608627-59a5-4967-8fdc-84f12231c5e7	2026-02-16 00:01:53.99	40e61efc-1892-41a0-9274-d3f8408b3937	2686ef0d-b403-48f8-8ca9-106ce73d378f	1.52000000	1.00000000	0.03708837	0.00000000
c8843483-30b9-4962-abf7-002095939c3a	2026-02-16 00:01:53.99	40e61efc-1892-41a0-9274-d3f8408b3937	65839da1-2b8c-474b-9380-a4e335b504c2	6.61000000	1.00000000	0.16128561	0.00000000
864204c5-aa71-4fc3-9c46-e633d89e8239	2026-02-16 00:08:36.854	cd09f925-fd96-4c59-89cd-2df4127a4b88	65839da1-2b8c-474b-9380-a4e335b504c2	8.13000000	1.00000000	0.19837398	0.00000000
f37845d5-6dc1-4570-a622-4b81f158416c	2026-02-16 00:16:10.713	38ddb174-d876-4876-9725-5cb824f61abf	65839da1-2b8c-474b-9380-a4e335b504c2	8.13000000	1.00000000	0.19837398	0.00000000
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."User" (id, "createdAt", "updatedAt", email, address, number, username) FROM stdin;
1cb6e9eb-9879-4064-9ede-52aea85d9675	2026-01-30 11:16:09.921	2026-01-30 11:16:09.921	alice@example.com	0x1111111111111111111111111111111111111111	233201234567	alice
5b39ec49-3f8c-4485-980b-ad013693187b	2026-01-30 11:16:09.925	2026-01-30 11:16:09.925	charlie@example.com	0x3333333333333333333333333333333333333333	\N	charlie
e470d5b7-c2db-453f-8bd0-46e8b2e28e6b	2026-01-30 11:16:09.923	2026-01-30 11:16:09.923	bob@example.com	0x2222222222222222222222222222222222222222	233209876543	bob
\.


--
-- Data for Name: Wallet; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Wallet" (id, "createdAt", "updatedAt", address, "encryptedKey", "supportedTokens", "supportedChains", "isLiquidityPool", "collectFees") FROM stdin;
75cf5c9d-0dcd-491b-829e-5dc2871ec361	2026-01-30 11:22:05.457	2026-01-30 11:22:05.457	0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2	5c5038cae34d456a6831d1a77fc28efb0ce4d61f1f2876ea13151c0921501923f2b3011238b03ab23a55fe9c2f80acdab54f43122e4899f621ed96d1dfcad83481bd9d59f563af120a518402d1e465e917b5f5368aab4022cd5dc737dc5c84fb5fdfe230d7910a	{USDC,DAI}	{ETHEREUM}	f	f
d50ad47b-41b3-4ddf-b557-4d81775ac406	2026-01-30 11:22:05.456	2026-02-16 20:59:10.363	0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1	5c5038cae34d456a6831d1a77fc28efb0ce4d61f1f2876ea13151c0921501923f2b3011238b03ab23a55fe9c2f80acdab54f43122e4899f621ed96d1dfcad83481bd9d59f563af120a518402d1e465e917b5f5368aab4022cd5dc737dc5c84fb5fdfe230d7910a	{ETH,USDC}	{ETHEREUM,BASE}	f	f
9c274687-b555-4f68-ae35-df63a0bf210b	2026-02-16 20:10:47.022	2026-02-16 20:59:10.367	0x9f08eFb0767Bf180B8b8094FaaEF9DAB5a0755e1	placeholder-receive-only-no-private-key	{USDC,ETH}	{BASE,"BASE SEPOLIA"}	t	f
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
ae64be6e-5987-4557-857f-274bbfbb1871	50d513208682a9b826f379a9644afd1ac04741c9a08bd9404908f0fd716afc36	2026-02-01 20:03:26.050012+00	20260201192128_add_transaction_pnl_and_provider_price	\N	\N	2026-02-01 20:03:26.036835+00	1
2cdbbca3-87e1-48f8-8b70-4e56f08f33f8	b8264a67cd91da86cbc0069b75a9985b372256274cbf3abd7c0c77e35b5a32c8	2026-01-30 11:16:03.388734+00	20260129123639_init	\N	\N	2026-01-30 11:16:03.337963+00	1
17ff9f48-db5f-40ab-b2a9-0890afbe61ec	28679c8852a5fe7dba1d070f74fda0625ea4b5c8fb2db1ae25ed1ff5c6ad84c8	2026-01-31 20:26:00.577687+00	20260131020000_country	\N	\N	2026-01-31 20:26:00.559839+00	1
b1a970c0-98ba-4c10-a59c-94e3ea5b8d37	1c13b53b7d341f65eede3cf2c3195f066fd33a5c832c2cd78b86fbfc16330b59	2026-01-30 11:16:03.401069+00	20260129180000_add_api_key	\N	\N	2026-01-30 11:16:03.390014+00	1
98b2ef67-3048-4f53-adf4-f1fe3de850c2	dda0acc4cf55b4e20fa797f9ce6f5ea30294431975355cfd33c63cf91d248df9	2026-01-30 11:16:03.409875+00	20260129183325_apikey	\N	\N	2026-01-30 11:16:03.402007+00	1
afa104a5-bec7-4c44-8edf-731a01948746	71efa3b9e93993ddf8f8170138c0764c37978bb987652ce5937de476bfe79b2e	2026-01-30 11:16:03.415588+00	20260129200000_add_f_chain_t_chain	\N	\N	2026-01-30 11:16:03.410742+00	1
2b017048-b5bc-459a-be78-201c3d13112a	67c739476c36ef0264825c450d7221d7d653aa640178ddf2b675bdcad7e80373	2026-01-31 20:26:00.593666+00	20260131030000_supported_chain_token	\N	\N	2026-01-31 20:26:00.578657+00	1
67977a7f-9e55-432a-8508-3b4a35d26c98	fe5172c98484c013ca1a017699ecc8c39b1ad744e65e4c928ff1e8cb80581ebb	2026-01-30 11:16:03.422849+00	20260129210000_add_klyra_provider_session	\N	\N	2026-01-30 11:16:03.418221+00	1
8cd3fde6-8579-4d30-bb1f-d36b2958b88a	7b80e85ef04e49775473d00dbf6126aa10d96787728eb2448cf324688e7b3a9a	2026-01-30 11:16:03.432169+00	20260129231824_session	\N	\N	2026-01-30 11:16:03.423957+00	1
381edb77-4ce8-41aa-b97b-06de174625e9	0bbef6cbd770f7d38b7583b3c37ed757f1b714265c97ee01a0962af1c627cc81	2026-01-30 12:52:46.274304+00	20260130120000_payout_request	\N	\N	2026-01-30 12:52:46.257045+00	1
762e1d20-4d50-4f4e-b17f-d1b1f409bb59	3b6c4d071014b64a2dd9d793fb55f36e6d63adc72c166665e0a638b67326f810	2026-01-31 20:26:00.638943+00	20260131162659_add_business_layer	\N	\N	2026-01-31 20:26:00.594834+00	1
5c800e6a-b86d-4d3e-971a-78644e8c8311	30de3381a7b936fcd74bbde35b8c89de75f5b22c9b436a098905fa52e5efaa54	2026-01-30 15:50:54.803114+00	20260130140000_paystack_payment_record	\N	\N	2026-01-30 15:50:54.782669+00	1
3adea8d4-fc7b-41e6-935a-b2fc18ebd16f	df428a879ff09965d8f6a3b713c2b75d4b50aada2902aae800f665268c4f4f00	2026-01-30 15:50:54.807493+00	20260130160000_payout_transfer_refs	\N	\N	2026-01-30 15:50:54.803994+00	1
ed04e541-9c43-493c-9fe1-f0d054c2f4f0	9d6ff115facc66db687ce865fdf3182cedfde011f29b384c1a4d89290d7ec717	2026-02-03 15:00:49.422217+00	20260202233523_add_admin_auth	\N	\N	2026-02-03 15:00:49.377125+00	1
8f8a56a7-c565-40fc-99a2-fa1c0c916d4a	3b6b6d2b95d57ceb729207ba6c5486a223c002b32327a23433c1bb62bf55d290	2026-01-30 15:50:54.822771+00	20260130170000_payout_recipient_and_transfer_record	\N	\N	2026-01-30 15:50:54.808397+00	1
4a368ce2-f706-4d71-a816-bc1093518da6	f69ec830078afb45510a6a06a8ab4703a2c6ad569003e7186232b09f683953e3	2026-01-31 20:26:00.654099+00	20260131165425_add_platform_settings	\N	\N	2026-01-31 20:26:00.639654+00	1
347ef02d-10c5-4c73-9d01-a14c531a5d7e	17d4f27a58a20c1dc025fa9ae0339d372248035e8406e84c46c47b36dd5a8082	2026-01-30 22:08:26.887866+00	20260130153529_add_invoices	\N	\N	2026-01-30 22:08:26.851452+00	1
cc5395dd-a919-4c06-850b-95fec061ed1d	572f3aba1d3da7b63a8f40240169642cc26a71e35f6a9ea9068d2cfc70b865e7	2026-01-30 22:08:26.906872+00	20260130180000_crypto_transaction	\N	\N	2026-01-30 22:08:26.889153+00	1
69cffb7a-37fd-4aaf-8a22-3a432a7ba97c	85aedf298c5b47e3afa7db811a77f65ceab2711639cf84018c4440f0559dcb80	2026-01-31 02:45:16.316343+00	20260131010000_inventory_chainid_address	\N	\N	2026-01-31 02:45:16.302686+00	1
331135fb-1056-48ac-8cf5-a796bab675ae	bcd0a0b632929445ab54ed9e17ad005a1cfb95c976ede873117f3648a52d0d78	2026-02-01 10:16:32.224612+00	20260131204327_add_inventory_lots	\N	\N	2026-02-01 10:16:32.210103+00	1
aed9f145-82ba-480a-8879-0896d2c7b97b	a1c150ed1ee7e923fc418fc9ee6d053f39dae97f2e803ca108c4d1410a926eb2	2026-02-18 21:50:54.252841+00	20260208000000_add_request_payout_fiat	\N	\N	2026-02-18 21:50:54.249739+00	1
9b91cead-9ca9-42ba-9200-c933d1718392	be16da312f0e94bb33332df5365c4851bbcdead0550d1da251654c478e75a3bc	2026-02-01 10:16:32.237518+00	20260131205650_add_provider_routing	\N	\N	2026-02-01 10:16:32.225997+00	1
4fb5a62e-871b-4716-820a-62d110dbb1bc	6e54fa92bc4496d212af312654182a3c91f8eed348fdd5f1be45f8220547cca1	2026-02-03 17:33:11.257216+00	20260203000000_add_wallet_liquidity_pool_flags	\N	\N	2026-02-03 17:33:11.25093+00	1
cf7eaf46-b18e-403e-b730-af645677582b	c9f79c3193f41b4edb39d9cd99cd7288c7cfa341802f08227b71185055ba45bb	2026-02-01 10:16:32.248606+00	20260131232246_add_failed_order_validation	\N	\N	2026-02-01 10:16:32.238553+00	1
3731ef80-0bc3-42e1-857c-3d89ccf871fd	fac32915e722d4460d3af4e30d8d867b37a2a5bf8e17da69f5fe12f2a7bd898d	2026-02-01 20:03:26.036041+00	20260201174047_add_transaction_fee	\N	\N	2026-02-01 20:03:26.03203+00	1
215783da-08ee-4d84-80e0-cd97a95ea642	46cb543e5359620f2d717a053bb1a01defe2122eca862131d0bef5ce5a7bc980	2026-02-05 00:49:48.564626+00	20260205004948	\N	\N	2026-02-05 00:49:48.561835+00	1
01d87aa9-a1d4-405f-b8d0-082e3d835625	e1e0ea142fd52f1c36fcaf51fbfb0e5ce4be70ba1bb6ed81ef100e0b9beb4176	2026-02-03 17:33:11.276468+00	20260203010000_transaction_balance_snapshot_and_onramp	\N	\N	2026-02-03 17:33:11.258174+00	1
4500ed6d-5cca-49d5-a077-99384427dcf0	c699403cefe1a6c4b8194f5bc12840a69ff950ff9a9d032e4f79ce47e4a59bac	2026-02-05 00:49:38.964611+00	20260203100000_transaction_absolute_pricing	\N	\N	2026-02-05 00:49:38.958726+00	1
ea23311a-341f-49fe-8c05-2568eafce22b	a80640e2b40518031ca98c10ca00ce5932531b4f25269ae18d35b8f95f15800b	2026-02-18 15:09:14.516166+00	20260206000000_add_payment_confirmed_at	\N	\N	2026-02-18 15:09:14.510629+00	1
65fc6064-7faf-495c-8cfc-749d4c12296c	e1d20607ec3418d15b3a709dd7226965b1de6f45273e31915bc8924c9a947473	2026-02-05 00:49:39.028005+00	20260203110000_inventory_usd_cost_basis_and_ledger	\N	\N	2026-02-05 00:49:38.965755+00	1
2e1cf98c-ee44-4d16-a10e-0c7be3ad75de	bfafe5795779e09f65101c245ccb299e02d1f5a23df6d26d984cc42ee4167fe8	2026-02-18 21:50:54.248993+00	20260207000000_add_request_payout_target	\N	\N	2026-02-18 21:50:54.24507+00	1
\.


--
-- Name: AdminInvite AdminInvite_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminInvite"
    ADD CONSTRAINT "AdminInvite_pkey" PRIMARY KEY (id);


--
-- Name: AdminPasskey AdminPasskey_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminPasskey"
    ADD CONSTRAINT "AdminPasskey_pkey" PRIMARY KEY (id);


--
-- Name: AdminSession AdminSession_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminSession"
    ADD CONSTRAINT "AdminSession_pkey" PRIMARY KEY (id);


--
-- Name: ApiKey ApiKey_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ApiKey"
    ADD CONSTRAINT "ApiKey_pkey" PRIMARY KEY (id);


--
-- Name: BusinessMember BusinessMember_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BusinessMember"
    ADD CONSTRAINT "BusinessMember_pkey" PRIMARY KEY (id);


--
-- Name: Business Business_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Business"
    ADD CONSTRAINT "Business_pkey" PRIMARY KEY (id);


--
-- Name: Chain Chain_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Chain"
    ADD CONSTRAINT "Chain_pkey" PRIMARY KEY (id);


--
-- Name: Claim Claim_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Claim"
    ADD CONSTRAINT "Claim_pkey" PRIMARY KEY (id);


--
-- Name: Country Country_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Country"
    ADD CONSTRAINT "Country_pkey" PRIMARY KEY (id);


--
-- Name: CryptoTransaction CryptoTransaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CryptoTransaction"
    ADD CONSTRAINT "CryptoTransaction_pkey" PRIMARY KEY (id);


--
-- Name: FailedOrderValidation FailedOrderValidation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FailedOrderValidation"
    ADD CONSTRAINT "FailedOrderValidation_pkey" PRIMARY KEY (id);


--
-- Name: FeeSchedule FeeSchedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FeeSchedule"
    ADD CONSTRAINT "FeeSchedule_pkey" PRIMARY KEY (id);


--
-- Name: InventoryAsset InventoryAsset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."InventoryAsset"
    ADD CONSTRAINT "InventoryAsset_pkey" PRIMARY KEY (id);


--
-- Name: InventoryLedger InventoryLedger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."InventoryLedger"
    ADD CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY (id);


--
-- Name: InventoryLot InventoryLot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."InventoryLot"
    ADD CONSTRAINT "InventoryLot_pkey" PRIMARY KEY (id);


--
-- Name: Invoice Invoice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_pkey" PRIMARY KEY (id);


--
-- Name: PayoutMethod PayoutMethod_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutMethod"
    ADD CONSTRAINT "PayoutMethod_pkey" PRIMARY KEY (id);


--
-- Name: PayoutRequest PayoutRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutRequest"
    ADD CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY (id);


--
-- Name: Payout Payout_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payout"
    ADD CONSTRAINT "Payout_pkey" PRIMARY KEY (id);


--
-- Name: PaystackPaymentRecord PaystackPaymentRecord_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PaystackPaymentRecord"
    ADD CONSTRAINT "PaystackPaymentRecord_pkey" PRIMARY KEY (id);


--
-- Name: PaystackTransferRecord PaystackTransferRecord_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PaystackTransferRecord"
    ADD CONSTRAINT "PaystackTransferRecord_pkey" PRIMARY KEY (id);


--
-- Name: PlatformAdmin PlatformAdmin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlatformAdmin"
    ADD CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY (id);


--
-- Name: PlatformSetting PlatformSetting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlatformSetting"
    ADD CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY (id);


--
-- Name: ProviderRouting ProviderRouting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProviderRouting"
    ADD CONSTRAINT "ProviderRouting_pkey" PRIMARY KEY (id);


--
-- Name: Request Request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Request"
    ADD CONSTRAINT "Request_pkey" PRIMARY KEY (id);


--
-- Name: SupportedToken SupportedToken_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportedToken"
    ADD CONSTRAINT "SupportedToken_pkey" PRIMARY KEY (id);


--
-- Name: TransactionBalanceSnapshot TransactionBalanceSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TransactionBalanceSnapshot"
    ADD CONSTRAINT "TransactionBalanceSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: TransactionPnL TransactionPnL_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TransactionPnL"
    ADD CONSTRAINT "TransactionPnL_pkey" PRIMARY KEY (id);


--
-- Name: Transaction Transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Wallet Wallet_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Wallet"
    ADD CONSTRAINT "Wallet_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: AdminInvite_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminInvite_email_idx" ON public."AdminInvite" USING btree (email);


--
-- Name: AdminInvite_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminInvite_expiresAt_idx" ON public."AdminInvite" USING btree ("expiresAt");


--
-- Name: AdminInvite_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminInvite_token_idx" ON public."AdminInvite" USING btree (token);


--
-- Name: AdminInvite_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AdminInvite_token_key" ON public."AdminInvite" USING btree (token);


--
-- Name: AdminPasskey_adminId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminPasskey_adminId_idx" ON public."AdminPasskey" USING btree ("adminId");


--
-- Name: AdminPasskey_credentialId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminPasskey_credentialId_idx" ON public."AdminPasskey" USING btree ("credentialId");


--
-- Name: AdminPasskey_credentialId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AdminPasskey_credentialId_key" ON public."AdminPasskey" USING btree ("credentialId");


--
-- Name: AdminSession_adminId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminSession_adminId_idx" ON public."AdminSession" USING btree ("adminId");


--
-- Name: AdminSession_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminSession_expiresAt_idx" ON public."AdminSession" USING btree ("expiresAt");


--
-- Name: AdminSession_tokenHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminSession_tokenHash_idx" ON public."AdminSession" USING btree ("tokenHash");


--
-- Name: AdminSession_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON public."AdminSession" USING btree ("tokenHash");


--
-- Name: ApiKey_businessId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ApiKey_businessId_idx" ON public."ApiKey" USING btree ("businessId");


--
-- Name: ApiKey_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ApiKey_isActive_idx" ON public."ApiKey" USING btree ("isActive");


--
-- Name: ApiKey_keyHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ApiKey_keyHash_idx" ON public."ApiKey" USING btree ("keyHash");


--
-- Name: ApiKey_keyHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON public."ApiKey" USING btree ("keyHash");


--
-- Name: BusinessMember_businessId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BusinessMember_businessId_idx" ON public."BusinessMember" USING btree ("businessId");


--
-- Name: BusinessMember_userId_businessId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "BusinessMember_userId_businessId_key" ON public."BusinessMember" USING btree ("userId", "businessId");


--
-- Name: BusinessMember_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BusinessMember_userId_idx" ON public."BusinessMember" USING btree ("userId");


--
-- Name: Business_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Business_slug_key" ON public."Business" USING btree (slug);


--
-- Name: Chain_chainId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Chain_chainId_idx" ON public."Chain" USING btree ("chainId");


--
-- Name: Chain_chainId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Chain_chainId_key" ON public."Chain" USING btree ("chainId");


--
-- Name: Claim_requestId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Claim_requestId_key" ON public."Claim" USING btree ("requestId");


--
-- Name: Country_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Country_code_idx" ON public."Country" USING btree (code);


--
-- Name: Country_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Country_code_key" ON public."Country" USING btree (code);


--
-- Name: Country_supportedFonbnk_supportedPaystack_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Country_supportedFonbnk_supportedPaystack_idx" ON public."Country" USING btree ("supportedFonbnk", "supportedPaystack");


--
-- Name: CryptoTransaction_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CryptoTransaction_createdAt_idx" ON public."CryptoTransaction" USING btree ("createdAt");


--
-- Name: CryptoTransaction_provider_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CryptoTransaction_provider_status_idx" ON public."CryptoTransaction" USING btree (provider, status);


--
-- Name: CryptoTransaction_transactionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CryptoTransaction_transactionId_idx" ON public."CryptoTransaction" USING btree ("transactionId");


--
-- Name: CryptoTransaction_txHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CryptoTransaction_txHash_idx" ON public."CryptoTransaction" USING btree ("txHash");


--
-- Name: FailedOrderValidation_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FailedOrderValidation_code_idx" ON public."FailedOrderValidation" USING btree (code);


--
-- Name: FailedOrderValidation_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FailedOrderValidation_createdAt_idx" ON public."FailedOrderValidation" USING btree ("createdAt");


--
-- Name: FeeSchedule_businessId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FeeSchedule_businessId_key" ON public."FeeSchedule" USING btree ("businessId");


--
-- Name: InventoryAsset_address_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "InventoryAsset_address_idx" ON public."InventoryAsset" USING btree (address);


--
-- Name: InventoryAsset_chainId_tokenAddress_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "InventoryAsset_chainId_tokenAddress_address_key" ON public."InventoryAsset" USING btree ("chainId", "tokenAddress", address);


--
-- Name: InventoryAsset_walletId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "InventoryAsset_walletId_idx" ON public."InventoryAsset" USING btree ("walletId");


--
-- Name: InventoryLedger_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "InventoryLedger_assetId_idx" ON public."InventoryLedger" USING btree ("assetId");


--
-- Name: InventoryLedger_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "InventoryLedger_createdAt_idx" ON public."InventoryLedger" USING btree ("createdAt");


--
-- Name: InventoryLot_assetId_acquiredAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "InventoryLot_assetId_acquiredAt_idx" ON public."InventoryLot" USING btree ("assetId", "acquiredAt");


--
-- Name: InventoryLot_assetId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "InventoryLot_assetId_status_idx" ON public."InventoryLot" USING btree ("assetId", status);


--
-- Name: InventoryLot_sourceTransactionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "InventoryLot_sourceTransactionId_idx" ON public."InventoryLot" USING btree ("sourceTransactionId");


--
-- Name: Invoice_billedTo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Invoice_billedTo_idx" ON public."Invoice" USING btree ("billedTo");


--
-- Name: Invoice_invoiceNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON public."Invoice" USING btree ("invoiceNumber");


--
-- Name: Invoice_issued_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Invoice_issued_idx" ON public."Invoice" USING btree (issued);


--
-- Name: Invoice_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Invoice_status_idx" ON public."Invoice" USING btree (status);


--
-- Name: PayoutMethod_businessId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PayoutMethod_businessId_idx" ON public."PayoutMethod" USING btree ("businessId");


--
-- Name: PayoutRequest_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PayoutRequest_code_key" ON public."PayoutRequest" USING btree (code);


--
-- Name: PayoutRequest_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PayoutRequest_status_idx" ON public."PayoutRequest" USING btree (status);


--
-- Name: PayoutRequest_transactionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PayoutRequest_transactionId_idx" ON public."PayoutRequest" USING btree ("transactionId");


--
-- Name: Payout_businessId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Payout_businessId_idx" ON public."Payout" USING btree ("businessId");


--
-- Name: Payout_methodId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Payout_methodId_idx" ON public."Payout" USING btree ("methodId");


--
-- Name: Payout_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Payout_status_idx" ON public."Payout" USING btree (status);


--
-- Name: PaystackPaymentRecord_paystackId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaystackPaymentRecord_paystackId_idx" ON public."PaystackPaymentRecord" USING btree ("paystackId");


--
-- Name: PaystackPaymentRecord_reference_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PaystackPaymentRecord_reference_key" ON public."PaystackPaymentRecord" USING btree (reference);


--
-- Name: PaystackPaymentRecord_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaystackPaymentRecord_status_idx" ON public."PaystackPaymentRecord" USING btree (status);


--
-- Name: PaystackPaymentRecord_transactionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaystackPaymentRecord_transactionId_idx" ON public."PaystackPaymentRecord" USING btree ("transactionId");


--
-- Name: PaystackTransferRecord_payoutRequestId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaystackTransferRecord_payoutRequestId_idx" ON public."PaystackTransferRecord" USING btree ("payoutRequestId");


--
-- Name: PaystackTransferRecord_reference_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PaystackTransferRecord_reference_key" ON public."PaystackTransferRecord" USING btree (reference);


--
-- Name: PaystackTransferRecord_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaystackTransferRecord_status_idx" ON public."PaystackTransferRecord" USING btree (status);


--
-- Name: PaystackTransferRecord_transferCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaystackTransferRecord_transferCode_idx" ON public."PaystackTransferRecord" USING btree ("transferCode");


--
-- Name: PlatformAdmin_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PlatformAdmin_email_idx" ON public."PlatformAdmin" USING btree (email);


--
-- Name: PlatformAdmin_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON public."PlatformAdmin" USING btree (email);


--
-- Name: PlatformAdmin_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PlatformAdmin_role_idx" ON public."PlatformAdmin" USING btree (role);


--
-- Name: PlatformSetting_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PlatformSetting_key_idx" ON public."PlatformSetting" USING btree (key);


--
-- Name: PlatformSetting_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PlatformSetting_key_key" ON public."PlatformSetting" USING btree (key);


--
-- Name: ProviderRouting_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProviderRouting_code_idx" ON public."ProviderRouting" USING btree (code);


--
-- Name: ProviderRouting_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ProviderRouting_code_key" ON public."ProviderRouting" USING btree (code);


--
-- Name: ProviderRouting_enabled_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProviderRouting_enabled_priority_idx" ON public."ProviderRouting" USING btree (enabled, priority);


--
-- Name: Request_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Request_code_key" ON public."Request" USING btree (code);


--
-- Name: Request_linkId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Request_linkId_key" ON public."Request" USING btree ("linkId");


--
-- Name: Request_transactionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Request_transactionId_key" ON public."Request" USING btree ("transactionId");


--
-- Name: SupportedToken_chainId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportedToken_chainId_idx" ON public."SupportedToken" USING btree ("chainId");


--
-- Name: SupportedToken_chainId_tokenAddress_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SupportedToken_chainId_tokenAddress_key" ON public."SupportedToken" USING btree ("chainId", "tokenAddress");


--
-- Name: SupportedToken_symbol_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportedToken_symbol_idx" ON public."SupportedToken" USING btree (symbol);


--
-- Name: TransactionBalanceSnapshot_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TransactionBalanceSnapshot_assetId_idx" ON public."TransactionBalanceSnapshot" USING btree ("assetId");


--
-- Name: TransactionBalanceSnapshot_transactionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TransactionBalanceSnapshot_transactionId_idx" ON public."TransactionBalanceSnapshot" USING btree ("transactionId");


--
-- Name: TransactionPnL_lotId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TransactionPnL_lotId_idx" ON public."TransactionPnL" USING btree ("lotId");


--
-- Name: TransactionPnL_transactionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TransactionPnL_transactionId_idx" ON public."TransactionPnL" USING btree ("transactionId");


--
-- Name: Transaction_businessId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Transaction_businessId_idx" ON public."Transaction" USING btree ("businessId");


--
-- Name: Transaction_requestId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Transaction_requestId_key" ON public."Transaction" USING btree ("requestId");


--
-- Name: Transaction_status_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Transaction_status_type_idx" ON public."Transaction" USING btree (status, type);


--
-- Name: User_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_address_key" ON public."User" USING btree (address);


--
-- Name: User_email_address_username_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_email_address_username_idx" ON public."User" USING btree (email, address, username);


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: Wallet_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Wallet_address_key" ON public."Wallet" USING btree (address);


--
-- Name: AdminInvite AdminInvite_invitedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminInvite"
    ADD CONSTRAINT "AdminInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES public."PlatformAdmin"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AdminPasskey AdminPasskey_adminId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminPasskey"
    ADD CONSTRAINT "AdminPasskey_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES public."PlatformAdmin"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AdminSession AdminSession_adminId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminSession"
    ADD CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES public."PlatformAdmin"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ApiKey ApiKey_businessId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ApiKey"
    ADD CONSTRAINT "ApiKey_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public."Business"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BusinessMember BusinessMember_businessId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BusinessMember"
    ADD CONSTRAINT "BusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public."Business"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BusinessMember BusinessMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BusinessMember"
    ADD CONSTRAINT "BusinessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Claim Claim_requestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Claim"
    ADD CONSTRAINT "Claim_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES public."Request"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CryptoTransaction CryptoTransaction_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CryptoTransaction"
    ADD CONSTRAINT "CryptoTransaction_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public."Transaction"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FeeSchedule FeeSchedule_businessId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FeeSchedule"
    ADD CONSTRAINT "FeeSchedule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public."Business"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: InventoryAsset InventoryAsset_walletId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."InventoryAsset"
    ADD CONSTRAINT "InventoryAsset_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES public."Wallet"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: InventoryLedger InventoryLedger_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."InventoryLedger"
    ADD CONSTRAINT "InventoryLedger_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public."InventoryAsset"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: InventoryLot InventoryLot_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."InventoryLot"
    ADD CONSTRAINT "InventoryLot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public."InventoryAsset"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PayoutMethod PayoutMethod_businessId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutMethod"
    ADD CONSTRAINT "PayoutMethod_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public."Business"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PayoutRequest PayoutRequest_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutRequest"
    ADD CONSTRAINT "PayoutRequest_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public."Transaction"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Payout Payout_businessId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payout"
    ADD CONSTRAINT "Payout_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public."Business"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Payout Payout_methodId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payout"
    ADD CONSTRAINT "Payout_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES public."PayoutMethod"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PaystackPaymentRecord PaystackPaymentRecord_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PaystackPaymentRecord"
    ADD CONSTRAINT "PaystackPaymentRecord_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public."Transaction"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PaystackTransferRecord PaystackTransferRecord_payoutRequestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PaystackTransferRecord"
    ADD CONSTRAINT "PaystackTransferRecord_payoutRequestId_fkey" FOREIGN KEY ("payoutRequestId") REFERENCES public."PayoutRequest"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Request Request_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Request"
    ADD CONSTRAINT "Request_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public."Transaction"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TransactionBalanceSnapshot TransactionBalanceSnapshot_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TransactionBalanceSnapshot"
    ADD CONSTRAINT "TransactionBalanceSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public."InventoryAsset"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TransactionBalanceSnapshot TransactionBalanceSnapshot_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TransactionBalanceSnapshot"
    ADD CONSTRAINT "TransactionBalanceSnapshot_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public."Transaction"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TransactionPnL TransactionPnL_lotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TransactionPnL"
    ADD CONSTRAINT "TransactionPnL_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES public."InventoryLot"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TransactionPnL TransactionPnL_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TransactionPnL"
    ADD CONSTRAINT "TransactionPnL_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public."Transaction"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Transaction Transaction_businessId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public."Business"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Transaction Transaction_fromUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Transaction Transaction_toUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict kMcSg0O4laksLLIu4M8ta45ogrSPgprXMcL442WltBsRyVAZDvLVp8KyNdoyYIX

