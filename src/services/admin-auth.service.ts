/**
 * Admin auth: invite flow, password + TOTP + passkey, session (15/30 min).
 */

import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { generateSecret, generateURI, verify as verifyOtp } from "otplib";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "../lib/prisma.js";
import { getEnv } from "../config/env.js";
import type { PlatformAdminRole } from "../../prisma/generated/prisma/client.js";

const INVITE_TOKEN_BYTES = 32;
const SESSION_TOKEN_BYTES = 32;
const INVITE_EXPIRY_DAYS = 7;
const SESSION_TTL_OPTIONS = [15, 30] as const;
export type SessionTtlMinutes = (typeof SESSION_TTL_OPTIONS)[number];

function getRpConfig(): { rpID: string; origin: string; allowedOrigins: string[] } {
  const env = getEnv();
  const rpID = env.ADMIN_RP_ID ?? "localhost";
  const origin = env.ADMIN_ORIGIN ?? `http://localhost:${env.PORT}`;
  const allowedOrigins = env.ADMIN_ALLOWED_ORIGINS
    ? env.ADMIN_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [origin];
  return { rpID, origin, allowedOrigins };
}

/** Resolve expected WebAuthn origin: use request Origin if in allowlist, else first allowed (dashboard) origin. */
export function getExpectedWebAuthnOrigin(requestOrigin: string | undefined): string {
  const { origin, allowedOrigins } = getRpConfig();
  const list = allowedOrigins.length > 0 ? allowedOrigins : [origin];
  if (requestOrigin && list.includes(requestOrigin)) return requestOrigin;
  return list[0] ?? origin;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function generateTotpSecret(): string {
  return generateSecret();
}

export function getTotpUri(secret: string, email: string, issuer = "Klyra Admin"): string {
  return generateURI({ issuer, label: email, secret });
}

export async function verifyTotp(token: string, secret: string): Promise<boolean> {
  try {
    const result = await verifyOtp({ secret, token });
    return result.valid;
  } catch {
    return false;
  }
}

/** Create invite; only super_admin (API key or session) may call. */
export async function createInvite(
  email: string,
  role: PlatformAdminRole,
  invitedById?: string | null
): Promise<{ token: string; expiresAt: Date; inviteId: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.platformAdmin.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new Error("An admin with this email already exists.");
  }
  const pendingInvite = await prisma.adminInvite.findFirst({
    where: { email: normalizedEmail, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (pendingInvite && pendingInvite.expiresAt > new Date()) {
    throw new Error("A valid invite for this email already exists. Use the existing link or wait for it to expire.");
  }
  const token = randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);
  const invite = await prisma.adminInvite.create({
    data: {
      email: normalizedEmail,
      role,
      token,
      expiresAt,
      invitedById: invitedById ?? undefined,
    },
  });
  return { token, expiresAt, inviteId: invite.id };
}

export async function getInviteByToken(token: string): Promise<{
  email: string;
  role: PlatformAdminRole;
  expiresAt: Date;
  usedAt: Date | null;
} | null> {
  const invite = await prisma.adminInvite.findUnique({
    where: { token: token.trim() },
  });
  if (!invite || invite.usedAt) return null;
  if (invite.expiresAt < new Date()) return null;
  return {
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    usedAt: invite.usedAt,
  };
}

/** Create PlatformAdmin from valid invite, set password, mark invite used. Returns TOTP secret for client to show QR. */
export async function setupAccount(
  token: string,
  password: string
): Promise<{ adminId: string; email: string; role: PlatformAdminRole; totpSecret: string; totpUri: string }> {
  const invite = await prisma.adminInvite.findUnique({
    where: { token: token.trim() },
  });
  if (!invite || invite.usedAt) {
    throw new Error("Invalid or already used invite.");
  }
  if (invite.expiresAt < new Date()) {
    throw new Error("Invite has expired.");
  }
  const passwordHash = await hashPassword(password);
  const totpSecret = generateTotpSecret();
  const now = new Date();
  const admin = await prisma.platformAdmin.create({
    data: {
      email: invite.email,
      role: invite.role,
      passwordHash,
      totpSecret,
      emailVerifiedAt: now,
      twoFaEnabled: false, // will be true after confirm-totp
    },
  });
  await prisma.adminInvite.update({
    where: { id: invite.id },
    data: { usedAt: now },
  });
  const totpUri = getTotpUri(totpSecret, invite.email);
  return {
    adminId: admin.id,
    email: admin.email,
    role: admin.role,
    totpSecret,
    totpUri,
  };
}

/** Confirm TOTP code and enable 2FA for admin (invite token no longer needed; use adminId from setup). */
export async function confirmTotp(adminId: string, code: string): Promise<void> {
  const admin = await prisma.platformAdmin.findUnique({
    where: { id: adminId },
  });
  if (!admin || !admin.totpSecret) {
    throw new Error("Admin not found or TOTP not set up.");
  }
  if (!(await verifyTotp(code, admin.totpSecret))) {
    throw new Error("Invalid authenticator code.");
  }
  await prisma.platformAdmin.update({
    where: { id: adminId },
    data: { twoFaEnabled: true },
  });
}

/** Create session; returns raw token (send to client once). */
export async function createSession(
  adminId: string,
  ttlMinutes: SessionTtlMinutes = 15
): Promise<{ token: string; expiresAt: Date }> {
  if (!SESSION_TTL_OPTIONS.includes(ttlMinutes)) {
    throw new Error("Session TTL must be 15 or 30 minutes.");
  }
  const rawToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);
  await prisma.adminSession.create({
    data: {
      adminId,
      tokenHash,
      expiresAt,
      sessionTtlMinutes: ttlMinutes,
    },
  });
  return { token: rawToken, expiresAt };
}

export async function getSessionByToken(rawToken: string): Promise<{
  adminId: string;
  email: string;
  name: string | null;
  role: PlatformAdminRole;
  expiresAt: Date;
} | null> {
  const tokenHash = hashSessionToken(rawToken);
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    include: { admin: true },
  });
  if (!session || session.expiresAt < new Date()) {
    return null;
  }
  return {
    adminId: session.admin.id,
    email: session.admin.email,
    name: session.admin.name,
    role: session.admin.role,
    expiresAt: session.expiresAt,
  };
}

export async function deleteSession(rawToken: string): Promise<void> {
  const tokenHash = hashSessionToken(rawToken);
  await prisma.adminSession.deleteMany({ where: { tokenHash } });
}

/** Login with email + password + TOTP code. */
export async function loginWithPassword(
  email: string,
  password: string,
  code: string,
  sessionTtlMinutes: SessionTtlMinutes = 15
): Promise<{ token: string; expiresAt: Date; admin: { id: string; email: string; name: string | null; role: PlatformAdminRole } }> {
  const normalizedEmail = email.trim().toLowerCase();
  const admin = await prisma.platformAdmin.findUnique({
    where: { email: normalizedEmail },
  });
  if (!admin || !admin.passwordHash) {
    throw new Error("Invalid email or password.");
  }
  const valid = await verifyPassword(admin.passwordHash, password);
  if (!valid) {
    throw new Error("Invalid email or password.");
  }
  if (!admin.totpSecret) {
    throw new Error("Account has no authenticator set up.");
  }
  if (!(await verifyTotp(code, admin.totpSecret))) {
    throw new Error("Invalid authenticator code.");
  }
  const { token, expiresAt } = await createSession(admin.id, sessionTtlMinutes);
  return {
    token,
    expiresAt,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  };
}

// --- Passkey (WebAuthn) ---

export async function getRegistrationOptionsForSetup(inviteToken: string): Promise<{
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
  inviteEmail: string;
} | null> {
  const invite = await getInviteByToken(inviteToken);
  if (!invite) return null;
  const { rpID } = getRpConfig();
  const options = await generateRegistrationOptions({
    rpName: "Klyra Admin",
    rpID,
    userName: invite.email,
    userDisplayName: invite.email,
    attestationType: "none",
    excludeCredentials: [],
  });
  return { options, inviteEmail: invite.email };
}

/** After setup: admin exists; get registration options for adding passkey. */
export async function getRegistrationOptionsForAdmin(adminId: string): Promise<Awaited<ReturnType<typeof generateRegistrationOptions>> | null> {
  const admin = await prisma.platformAdmin.findUnique({
    where: { id: adminId },
    include: { passkeys: true },
  });
  if (!admin) return null;
  const { rpID } = getRpConfig();
  const options = await generateRegistrationOptions({
    rpName: "Klyra Admin",
    rpID,
    userName: admin.email,
    userDisplayName: admin.name ?? admin.email,
    attestationType: "none",
    excludeCredentials: admin.passkeys.map((p) => ({ id: p.credentialId })),
  });
  return options;
}

export async function verifyAndSavePasskey(
  adminId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  expectedOrigin: string,
  name?: string | null
): Promise<void> {
  const { rpID } = getRpConfig();
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
  await prisma.adminPasskey.create({
    data: {
      adminId,
      credentialId: credential.id,
      publicKey: publicKeyBytes,
      counter: credential.counter,
      name: name ?? null,
    },
  });
}

export async function getAuthenticationOptionsForEmail(email: string): Promise<{
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  challenge: string;
} | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const admin = await prisma.platformAdmin.findUnique({
    where: { email: normalizedEmail },
    include: { passkeys: true },
  });
  if (!admin || admin.passkeys.length === 0) return null;
  const { rpID } = getRpConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: admin.passkeys.map((p) => ({ id: p.credentialId })),
  });
  return {
    options,
    challenge: options.challenge,
  };
}

export async function verifyPasskeyAssertion(
  email: string,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  expectedOrigin: string
): Promise<{ adminId: string; email: string; name: string | null; role: PlatformAdminRole } | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const admin = await prisma.platformAdmin.findUnique({
    where: { email: normalizedEmail },
    include: { passkeys: true },
  });
  if (!admin) return null;
  const passkey = admin.passkeys.find((p) => p.credentialId === response.id);
  if (!passkey) return null;
  const { rpID } = getRpConfig();
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
  await prisma.adminPasskey.update({
    where: { id: passkey.id },
    data: { counter: newCounter },
  });
  return {
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  };
}
