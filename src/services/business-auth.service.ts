import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import type { BusinessRole, MerchantPrimaryGoal, MerchantSignupRole } from "../../prisma/generated/prisma/client.js";
import { getEnv } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getRedis, PORTAL_PASSKEY_AUTH_PREFIX, PORTAL_PASSKEY_AUTH_TTL } from "../lib/redis.js";
import { signBusinessPortalToken } from "../lib/business-session.js";
import { hashPassword, verifyPassword } from "./admin-auth.service.js";
import { sendEmail } from "./email.service.js";
import {
  businessMagicLinkHtml,
  businessMagicLinkSubject,
  businessMagicLinkText,
} from "../email/templates/business-magic-link.js";

const MAGIC_LINK_PREFIX = "business_magic:";
const MAGIC_SPENT_PREFIX = "business_magic_spent:";
const MAGIC_SPENT_TTL_SECONDS = 300;
const OAUTH_STATE_PREFIX = "business_oauth_state:";
const MAGIC_TTL_SECONDS = 900;
const OAUTH_STATE_TTL_SECONDS = 600;
const PORTAL_LOGIN_CODE_PREFIX = "business_login_code:";
export const PORTAL_LOGIN_CODE_TTL_SECONDS = 60;

function slugifyCompanyName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return base.length > 0 ? base : "business";
}

export async function ensureUniqueBusinessSlug(base: string): Promise<string> {
  let slug = base;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const existing = await prisma.business.findUnique({ where: { slug } });
    if (!existing) return slug;
    slug = `${base}-${randomBytes(3).toString("hex")}`;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export function mapSignupRoleToBusinessRole(role: MerchantSignupRole): BusinessRole {
  switch (role) {
    case "DEVELOPER":
      return "DEVELOPER";
    case "FOUNDER_EXECUTIVE":
      return "OWNER";
    case "FINANCE_OPS":
      return "FINANCE";
    case "PRODUCT":
      return "ADMIN";
    default:
      return "DEVELOPER";
  }
}

export function computeLandingHint(
  signupRole: MerchantSignupRole,
  primaryGoal: MerchantPrimaryGoal
): string {
  if (signupRole === "DEVELOPER" && primaryGoal === "INTEGRATE_SDK") {
    return "docs_sdk_sandbox";
  }
  if (primaryGoal === "ACCEPT_PAYMENTS") {
    return "dashboard_payments_flow";
  }
  if (primaryGoal === "SEND_PAYOUTS") {
    return "dashboard_payouts";
  }
  if (primaryGoal === "INTEGRATE_SDK") {
    return "docs_api_overview";
  }
  return "dashboard_overview";
}

export async function registerWithEmailPassword(
  email: string,
  password: string
): Promise<{ userId: string; accessToken: string }> {
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || !normalized.includes("@")) {
    throw new Error("Enter a valid work email.");
  }
  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters.");
  }
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing?.passwordHash) {
    throw new Error("An account with this email already exists. Sign in instead.");
  }
  if (existing && !existing.passwordHash) {
    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash },
    });
    return { userId: existing.id, accessToken: signBusinessPortalToken(existing.id) };
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email: normalized, passwordHash },
  });
  return { userId: user.id, accessToken: signBusinessPortalToken(user.id) };
}

export async function loginWithEmailPassword(
  email: string,
  password: string
): Promise<{ userId: string; accessToken: string }> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user?.passwordHash) {
    throw new Error("Invalid email or password.");
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    throw new Error("Invalid email or password.");
  }
  return { userId: user.id, accessToken: signBusinessPortalToken(user.id) };
}

/** Whether an email can be used for a brand-new business portal account (no User row yet). */
export async function getPortalEmailAvailability(email: string): Promise<{
  available: boolean;
  registered: boolean;
  hasPassword: boolean;
}> {
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || !normalized.includes("@")) {
    throw new Error("Enter a valid email.");
  }
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { passwordHash: true },
  });
  if (!user) {
    return { available: true, registered: false, hasPassword: false };
  }
  return {
    available: false,
    registered: true,
    hasPassword: Boolean(user.passwordHash),
  };
}

export async function createPortalLoginCode(accessToken: string): Promise<string> {
  const trimmed = accessToken.trim();
  if (trimmed.length < 10) {
    throw new Error("Invalid access token.");
  }
  const code = randomBytes(16).toString("base64url");
  const redis = getRedis();
  await redis.set(
    `${PORTAL_LOGIN_CODE_PREFIX}${code}`,
    trimmed,
    "EX",
    PORTAL_LOGIN_CODE_TTL_SECONDS
  );
  return code;
}

export async function consumePortalLoginCode(code: string): Promise<string> {
  const trimmed = code.trim();
  if (trimmed.length < 6) {
    throw new Error("Invalid or expired login code.");
  }
  const redis = getRedis();
  const key = `${PORTAL_LOGIN_CODE_PREFIX}${trimmed}`;
  const value = await redis.get(key);
  if (!value) {
    throw new Error("Invalid or expired login code.");
  }
  await redis.del(key);
  return value;
}

export async function storeMagicLinkToken(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || !normalized.includes("@")) {
    throw new Error("Enter a valid email.");
  }
  const token = randomBytes(32).toString("base64url");
  const redis = getRedis();
  await redis.set(`${MAGIC_LINK_PREFIX}${token}`, normalized, "EX", MAGIC_TTL_SECONDS);
  return token;
}

export async function consumeMagicLinkToken(
  token: string
): Promise<{ userId: string; accessToken: string }> {
  const trimmed = token.trim();
  if (trimmed.length < 10) {
    throw new Error("Invalid or expired link.");
  }
  const redis = getRedis();
  const key = `${MAGIC_LINK_PREFIX}${trimmed}`;
  const spentKey = `${MAGIC_SPENT_PREFIX}${trimmed}`;

  const luaClaimAndReserve = `
local v = redis.call('GET', KEYS[1])
if v == false then
  return '__MISS__'
end
redis.call('DEL', KEYS[1])
local payload = cjson.encode({ provisioning = true, email = v })
redis.call('SET', KEYS[2], payload, 'EX', 120)
return v
`;
  const claimResult = (await redis.eval(
    luaClaimAndReserve,
    2,
    key,
    spentKey
  )) as string;

  if (claimResult === "__MISS__") {
    const spentRaw = await redis.get(spentKey);
    if (spentRaw) {
      try {
        const spent = JSON.parse(spentRaw) as {
          userId?: string;
          accessToken?: string;
          provisioning?: boolean;
          email?: string;
        };
        if (spent.userId && spent.accessToken) {
          return { userId: spent.userId, accessToken: spent.accessToken };
        }
        if (spent.provisioning === true && typeof spent.email === "string" && spent.email.length > 0) {
          return finalizeMagicLinkSession(spent.email, spentKey, redis);
        }
      } catch {
        /* fall through */
      }
    }
    throw new Error("Invalid or expired link.");
  }

  if (!claimResult || claimResult.length === 0) {
    throw new Error("Invalid or expired link.");
  }

  return finalizeMagicLinkSession(claimResult, spentKey, redis);
}

async function finalizeMagicLinkSession(
  email: string,
  spentKey: string,
  redis: ReturnType<typeof getRedis>
): Promise<{ userId: string; accessToken: string }> {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    try {
      user = await prisma.user.create({ data: { email } });
    } catch {
      user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new Error("Invalid or expired link.");
      }
    }
  }
  const accessToken = signBusinessPortalToken(user.id);
  await redis.set(
    spentKey,
    JSON.stringify({ userId: user.id, accessToken }),
    "EX",
    MAGIC_SPENT_TTL_SECONDS
  );
  return { userId: user.id, accessToken };
}

export async function sendBusinessMagicLinkEmail(
  email: string,
  magicLinkUrl: string
): Promise<{ sent: boolean; message: string }> {
  const result = await sendEmail({
    to: email.trim().toLowerCase(),
    subject: businessMagicLinkSubject(),
    html: businessMagicLinkHtml({ magicLinkUrl }),
    text: businessMagicLinkText({ magicLinkUrl }),
    entityRefId: `business-magic-${email.slice(0, 20)}`,
    fromPersona: "business",
  });
  if (!result.ok) {
    return {
      sent: false,
      message: result.error,
    };
  }
  return { sent: true, message: "Check your inbox for the sign-in link." };
}

export async function createGoogleOAuthState(): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const redis = getRedis();
  await redis.set(`${OAUTH_STATE_PREFIX}${state}`, "1", "EX", OAUTH_STATE_TTL_SECONDS);
  return state;
}

export async function assertValidOAuthState(state: string): Promise<void> {
  const redis = getRedis();
  const key = `${OAUTH_STATE_PREFIX}${state}`;
  const ok = await redis.get(key);
  if (!ok) {
    throw new Error("Invalid or expired OAuth state. Try again.");
  }
  await redis.del(key);
}

type GoogleTokenResponse = {
  access_token?: string;
  id_token?: string;
};

type GoogleUserInfo = {
  id?: string;
  email?: string;
  verified_email?: boolean;
};

export async function exchangeGoogleCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<GoogleUserInfo> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${text.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as GoogleTokenResponse;
  if (!tokens.access_token) {
    throw new Error("Google did not return an access token.");
  }
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    throw new Error("Failed to load Google profile.");
  }
  return (await userRes.json()) as GoogleUserInfo;
}

export async function upsertUserFromGoogleProfile(
  googleSub: string,
  email: string
): Promise<{ userId: string; accessToken: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const bySub = await prisma.user.findFirst({ where: { googleSub } });
  if (bySub) {
    return { userId: bySub.id, accessToken: signBusinessPortalToken(bySub.id) };
  }
  const byEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (byEmail) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { googleSub },
    });
    return { userId: byEmail.id, accessToken: signBusinessPortalToken(byEmail.id) };
  }
  const user = await prisma.user.create({
    data: { email: normalizedEmail, googleSub },
  });
  return { userId: user.id, accessToken: signBusinessPortalToken(user.id) };
}

export async function saveOnboardingEntity(
  userId: string,
  companyName: string,
  website: string | undefined
): Promise<void> {
  const name = companyName.trim();
  if (name.length < 2) {
    throw new Error("Company name is required.");
  }
  let websiteNorm: string | undefined;
  if (website != null && website.trim() !== "") {
    const w = website.trim();
    websiteNorm = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  }
  await prisma.merchantOnboarding.upsert({
    where: { userId },
    create: { userId, companyName: name, website: websiteNorm ?? null },
    update: { companyName: name, website: websiteNorm ?? null },
  });
}

const signupRoleSchema = [
  "DEVELOPER",
  "FOUNDER_EXECUTIVE",
  "FINANCE_OPS",
  "PRODUCT",
] as const;
const primaryGoalSchema = [
  "ACCEPT_PAYMENTS",
  "SEND_PAYOUTS",
  "INTEGRATE_SDK",
  "EXPLORING",
] as const;

export function parseSignupRole(value: string): MerchantSignupRole {
  if (signupRoleSchema.includes(value as (typeof signupRoleSchema)[number])) {
    return value as MerchantSignupRole;
  }
  throw new Error("Invalid role selection.");
}

export function parsePrimaryGoal(value: string): MerchantPrimaryGoal {
  if (primaryGoalSchema.includes(value as (typeof primaryGoalSchema)[number])) {
    return value as MerchantPrimaryGoal;
  }
  throw new Error("Invalid goal selection.");
}

export async function completeBusinessOnboarding(
  userId: string,
  signupRole: MerchantSignupRole,
  primaryGoal: MerchantPrimaryGoal
): Promise<{
  businessId: string;
  slug: string;
  landingHint: string;
  accessToken: string;
  alreadyHadBusiness: boolean;
}> {
  const member = await prisma.businessMember.findFirst({
    where: { userId, isActive: true },
    include: { business: true },
  });
  if (member) {
    return {
      businessId: member.businessId,
      slug: member.business.slug,
      landingHint: computeLandingHint(signupRole, primaryGoal),
      accessToken: signBusinessPortalToken(userId),
      alreadyHadBusiness: true,
    };
  }

  const draft = await prisma.merchantOnboarding.findUnique({ where: { userId } });
  const companyName = draft?.companyName?.trim();
  if (!companyName || companyName.length < 2) {
    throw new Error("Complete the company step first (company name required).");
  }
  const websiteForBusiness = draft?.website ?? null;

  const slug = await ensureUniqueBusinessSlug(slugifyCompanyName(companyName));
  const businessRole = mapSignupRoleToBusinessRole(signupRole);
  const landingHint = computeLandingHint(signupRole, primaryGoal);

  const result = await prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        name: companyName,
        slug,
        website: websiteForBusiness,
        country: "US",
        kybStatus: "NOT_STARTED",
        supportEmail: null,
      },
    });
    await tx.businessMember.create({
      data: {
        userId,
        businessId: business.id,
        role: businessRole,
        isActive: true,
      },
    });
    await tx.feeSchedule.create({
      data: {
        businessId: business.id,
        flatFee: 0,
        percentageFee: 1,
        maxFee: 50,
      },
    });
    await tx.merchantOnboarding.deleteMany({ where: { userId } });
    return business;
  });

  return {
    businessId: result.id,
    slug: result.slug,
    landingHint,
    accessToken: signBusinessPortalToken(userId),
    alreadyHadBusiness: false,
  };
}

/**
 * @param requestOrigin - Prefer `Origin` header from the HTTP request. When `BUSINESS_WEBAUTHN_RP_ID`
 * is unset, hostname is derived from this URL so production (e.g. Vercel) is not stuck on `localhost`.
 */
function getBusinessWebAuthnRpConfig(requestOrigin?: string | null): {
  rpID: string;
  defaultOrigin: string;
  allowedOrigins: string[];
} {
  const env = getEnv();
  let rpID = env.BUSINESS_WEBAUTHN_RP_ID?.trim() || env.ADMIN_RP_ID?.trim() || "";
  const originTrim = requestOrigin?.trim() ?? "";
  if (!rpID && originTrim) {
    try {
      const host = new URL(originTrim).hostname;
      if (host) rpID = host;
    } catch {
      /* ignore */
    }
  }
  if (!rpID) {
    rpID = "localhost";
  }

  const defaultOrigin =
    env.BUSINESS_WEBAUTHN_ORIGINS?.split(",")[0]?.trim() ||
    env.FRONTEND_APP_URL ||
    `http://localhost:${env.PORT}`;

  let allowedOrigins = env.BUSINESS_WEBAUTHN_ORIGINS
    ? env.BUSINESS_WEBAUTHN_ORIGINS.split(",").map((part) => part.trim()).filter(Boolean)
    : env.ADMIN_ALLOWED_ORIGINS
      ? env.ADMIN_ALLOWED_ORIGINS.split(",").map((part) => part.trim()).filter(Boolean)
      : [defaultOrigin];

  if (
    originTrim &&
    !allowedOrigins.includes(originTrim) &&
    env.BUSINESS_WEBAUTHN_ORIGINS?.trim() === undefined
  ) {
    try {
      if (new URL(originTrim).hostname === rpID) {
        allowedOrigins = [...allowedOrigins, originTrim];
      }
    } catch {
      /* ignore */
    }
  }

  return { rpID, defaultOrigin, allowedOrigins };
}

export function getExpectedBusinessPortalOrigin(
  requestOrigin: string | undefined
): string {
  const { defaultOrigin, allowedOrigins } = getBusinessWebAuthnRpConfig(requestOrigin);
  const list =
    allowedOrigins.length > 0 ? allowedOrigins : [defaultOrigin];
  if (requestOrigin && list.includes(requestOrigin)) return requestOrigin;
  return list[0] ?? defaultOrigin;
}

export async function setupPortalProfile(
  userId: string,
  displayName: string,
  password: string | undefined
): Promise<void> {
  const name = displayName.trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error("Name must be between 2 and 120 characters.");
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error("User not found.");
  }
  const pwd = password?.trim() ?? "";
  if (!user.passwordHash) {
    if (pwd.length < 10) {
      throw new Error("Password must be at least 10 characters.");
    }
    const passwordHash = await hashPassword(pwd);
    await prisma.user.update({
      where: { id: userId },
      data: { portalDisplayName: name, passwordHash },
    });
    return;
  }
  const data: { portalDisplayName: string; passwordHash?: string } = {
    portalDisplayName: name,
  };
  if (pwd.length > 0) {
    if (pwd.length < 10) {
      throw new Error("New password must be at least 10 characters.");
    }
    data.passwordHash = await hashPassword(pwd);
  }
  await prisma.user.update({ where: { id: userId }, data });
}

export async function getPortalPasskeyRegistrationOptions(
  userId: string,
  requestOrigin?: string | null
): Promise<Awaited<ReturnType<typeof generateRegistrationOptions>> | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { portalPasskeys: true },
  });
  if (!user) return null;
  const { rpID } = getBusinessWebAuthnRpConfig(requestOrigin);
  const display =
    user.portalDisplayName?.trim() || user.email.split("@")[0] || user.email;
  return generateRegistrationOptions({
    rpName: "Morapay Business",
    rpID,
    userName: user.email,
    userDisplayName: display,
    attestationType: "none",
    excludeCredentials: user.portalPasskeys.map((p) => ({ id: p.credentialId })),
  });
}

export async function verifyPortalPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  expectedOrigin: string,
  passkeyName: string | undefined
): Promise<void> {
  const { rpID } = getBusinessWebAuthnRpConfig(expectedOrigin);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey verification failed.");
  }
  const { credential } = verification.registrationInfo;
  const publicKeyBytes = Buffer.from(credential.publicKey);
  const label =
    passkeyName?.trim().slice(0, 80) ||
    "Passkey";
  await prisma.userPortalPasskey.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: publicKeyBytes,
      counter: credential.counter,
      name: label,
    },
  });
}

export async function getPortalPasskeyAuthOptions(
  email: string,
  requestOrigin?: string | null
): Promise<{
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  challenge: string;
} | null> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: { portalPasskeys: true },
  });
  if (!user || user.portalPasskeys.length === 0) return null;
  const { rpID } = getBusinessWebAuthnRpConfig(requestOrigin);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: user.portalPasskeys.map((passkey) => ({ id: passkey.credentialId })),
  });
  return { options, challenge: options.challenge };
}

export async function verifyPortalPasskeyLogin(
  email: string,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  expectedOrigin: string
): Promise<{ userId: string; accessToken: string } | null> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: { portalPasskeys: true },
  });
  if (!user) return null;
  const passkey = user.portalPasskeys.find((pk) => pk.credentialId === response.id);
  if (!passkey) return null;
  const { rpID } = getBusinessWebAuthnRpConfig(expectedOrigin);
  const credential = {
    id: passkey.credentialId,
    publicKey: new Uint8Array(passkey.publicKey),
    counter: passkey.counter,
    transports: undefined as import("@simplewebauthn/server").AuthenticatorTransportFuture[] | undefined,
  };
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    credential,
  });
  if (!verification.verified) return null;
  const { newCounter } = verification.authenticationInfo;
  await prisma.userPortalPasskey.update({
    where: { id: passkey.id },
    data: { counter: newCounter },
  });
  return {
    userId: user.id,
    accessToken: signBusinessPortalToken(user.id),
  };
}

function portalAuthChallengeKey(email: string): string {
  return `${PORTAL_PASSKEY_AUTH_PREFIX}${createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex")}`;
}

export async function storePortalPasskeyAuthChallenge(
  email: string,
  challenge: string
): Promise<void> {
  const redis = getRedis();
  await redis.set(
    portalAuthChallengeKey(email),
    challenge,
    "EX",
    PORTAL_PASSKEY_AUTH_TTL
  );
}

export async function takePortalPasskeyAuthChallenge(
  email: string
): Promise<string | null> {
  const redis = getRedis();
  const key = portalAuthChallengeKey(email);
  const c = await redis.get(key);
  await redis.del(key);
  return c;
}

export async function getBusinessPortalSession(userId: string): Promise<{
  email: string;
  portalDisplayName: string | null;
  hasPassword: boolean;
  passkeyCount: number;
  profileComplete: boolean;
  onboarding: {
    companyName: string | null;
    website: string | null;
    signupRole: MerchantSignupRole | null;
    primaryGoal: MerchantPrimaryGoal | null;
  } | null;
  businesses: { id: string; name: string; slug: string; kybStatus: string }[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      merchantOnboarding: true,
      members: {
        where: { isActive: true },
        include: { business: true },
      },
      _count: { select: { portalPasskeys: true } },
    },
  });
  if (!user) {
    throw new Error("User not found.");
  }
  const onboarding = user.merchantOnboarding;
  const hasPassword = Boolean(user.passwordHash);
  const passkeyCount = user._count.portalPasskeys;
  /** Display name plus password or at least one portal passkey (passkey-only sign-in is valid). */
  const profileComplete = Boolean(
    user.portalDisplayName?.trim() && (hasPassword || passkeyCount > 0)
  );
  return {
    email: user.email,
    portalDisplayName: user.portalDisplayName ?? null,
    hasPassword,
    passkeyCount,
    profileComplete,
    onboarding: onboarding
      ? {
          companyName: onboarding.companyName,
          website: onboarding.website,
          signupRole: onboarding.signupRole,
          primaryGoal: onboarding.primaryGoal,
        }
      : null,
    businesses: user.members.map((membership) => ({
      id: membership.business.id,
      name: membership.business.name,
      slug: membership.business.slug,
      kybStatus: membership.business.kybStatus,
    })),
  };
}
