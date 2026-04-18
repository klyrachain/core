/**
 * Admin auth: invite (super_admin only), verify invite, setup (password + TOTP), login (password+TOTP or passkey), session (15/30 min).
 * Public routes: /api/auth/invite/:token (GET), setup (POST), setup/confirm-totp (POST), login (POST), login/passkey/options (POST), login/passkey/verify (POST).
 * Protected by API key (super_admin): POST /api/auth/invite.
 * Protected by session: GET me, POST logout, GET passkey/options, POST passkey/verify.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  successEnvelope,
  errorEnvelope,
} from "../../lib/api-helpers.js";
import { requireApiKey } from "../../lib/auth.guard.js";
import { resolveAdminSessionIfPresent, requireAdminSession, isSuperAdmin } from "../../lib/admin-auth.guard.js";
import {
  createInvite,
  getInviteByToken,
  setupAccount,
  confirmTotp,
  createSession,
  deleteSession,
  loginWithPassword,
  getRegistrationOptionsForAdmin,
  verifyAndSavePasskey,
  getAuthenticationOptionsForEmail,
  verifyPasskeyAssertion,
  getExpectedWebAuthnOrigin,
  type SessionTtlMinutes,
} from "../../services/admin-auth.service.js";
import { getRedis } from "../../lib/redis.js";
import {
  ADMIN_AUTH_REG_CHALLENGE_PREFIX,
  ADMIN_AUTH_REG_CHALLENGE_TTL,
  ADMIN_AUTH_AUTH_CHALLENGE_PREFIX,
  ADMIN_AUTH_AUTH_CHALLENGE_TTL,
} from "../../lib/redis.js";
import { assertAdminPasskeyOptionsRateLimit } from "../../lib/admin-passkey-rate-limit.js";
import { getWebAuthnRequestOrigin } from "../../lib/webauthn-request-origin.js";

const bodyInvite = z.object({ email: z.string().email().transform((s) => s.trim().toLowerCase()), role: z.enum(["super_admin", "support", "developer", "viewer"]) });
const bodySetup = z.object({ inviteToken: z.string().min(1), password: z.string().min(8) });
const bodyConfirmTotp = z.object({ adminId: z.string().uuid(), code: z.string().length(6) });
const bodyLogin = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1),
  code: z.string().length(6),
  sessionTtlMinutes: z.union([z.literal(15), z.literal(30)]).optional().default(15),
});
const bodyPasskeyVerify = z.object({
  response: z.record(z.unknown()),
  name: z.string().optional(),
});
const bodyLoginPasskeyVerify = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  response: z.record(z.unknown()),
  sessionTtlMinutes: z.union([z.literal(15), z.literal(30)]).optional(),
});
const bodyLoginPasskeyOptions = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
});

export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  // --- GET /api/auth/invite/:token (public) ---
  app.get<{ Params: { token: string } }>("/api/auth/invite/:token", async (req, reply) => {
    const invite = await getInviteByToken(req.params.token);
    if (!invite) {
      return reply.status(404).send({ success: false, error: "Invalid or expired invite.", code: "INVALID_INVITE" });
    }
    return successEnvelope(reply, {
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      message: `You have been invited as ${invite.role.replace("_", " ")}.`,
    });
  });

  // --- POST /api/auth/invite (requires super_admin: session or platform API key) ---
  app.post("/api/auth/invite", async (req: FastifyRequest, reply: FastifyReply) => {
    await resolveAdminSessionIfPresent(req);
    let invitedById: string | null = null;
    if (req.adminSession?.role === "super_admin") {
      invitedById = req.adminSession.adminId;
    } else {
      await requireApiKey(req, reply);
      if (!req.apiKey) return;
      if (!isSuperAdmin(req.apiKey.permissions)) {
        return reply.status(403).send({ success: false, error: "Only super admin can invite users.", code: "FORBIDDEN" });
      }
      if (req.apiKey.businessId) {
        return reply.status(403).send({ success: false, error: "Platform key required.", code: "FORBIDDEN" });
      }
    }
    const parsed = bodyInvite.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      const { token, expiresAt, inviteId } = await createInvite(
        parsed.data.email,
        parsed.data.role as "super_admin" | "support" | "developer" | "viewer",
        invitedById
      );
      return successEnvelope(reply, {
        inviteId,
        expiresAt,
        inviteLink: `/signup?token=${token}`,
        message: "Invite created. Send the invite link to the user.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create invite.";
      return reply.status(400).send({ success: false, error: msg, code: "INVITE_FAILED" });
    }
  });

  // --- POST /api/auth/setup (public; invite token + password) ---
  app.post("/api/auth/setup", async (req, reply) => {
    const parsed = bodySetup.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      const result = await setupAccount(parsed.data.inviteToken, parsed.data.password);
      return successEnvelope(reply, {
        adminId: result.adminId,
        email: result.email,
        role: result.role,
        totpSecret: result.totpSecret,
        totpUri: result.totpUri,
        message: "Account created. Add the TOTP to your authenticator app, then call POST /api/auth/setup/confirm-totp with adminId and code.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Setup failed.";
      return reply.status(400).send({ success: false, error: msg, code: "SETUP_FAILED" });
    }
  });

  // --- POST /api/auth/setup/confirm-totp (public; adminId + code) ---
  app.post("/api/auth/setup/confirm-totp", async (req, reply) => {
    const parsed = bodyConfirmTotp.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      await confirmTotp(parsed.data.adminId, parsed.data.code);
      return successEnvelope(reply, { message: "Two-factor authentication enabled. You can now log in." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid code.";
      return reply.status(400).send({ success: false, error: msg, code: "INVALID_CODE" });
    }
  });

  // --- POST /api/auth/login (public; email + password + TOTP code) ---
  app.post("/api/auth/login", async (req, reply) => {
    const parsed = bodyLogin.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      const ttl = parsed.data.sessionTtlMinutes as SessionTtlMinutes;
      const result = await loginWithPassword(
        parsed.data.email,
        parsed.data.password,
        parsed.data.code,
        ttl
      );
      return successEnvelope(reply, {
        token: result.token,
        expiresAt: result.expiresAt,
        sessionTtlMinutes: ttl,
        admin: result.admin,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed.";
      return reply.status(401).send({ success: false, error: msg, code: "LOGIN_FAILED" });
    }
  });

  // --- POST /api/auth/login/passkey/options (public; email) ---
  app.post("/api/auth/login/passkey/options", async (req, reply) => {
    const parsed = bodyLoginPasskeyOptions.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    const normalizedEmail = parsed.data.email;
    const rate = await assertAdminPasskeyOptionsRateLimit(req, normalizedEmail);
    if (!rate.ok) {
      reply.header("Retry-After", String(rate.retryAfterSec));
      return reply.status(429).send({
        success: false,
        error: "Too many passkey sign-in attempts. Try again shortly.",
        code: "RATE_LIMITED",
      });
    }
    const result = await getAuthenticationOptionsForEmail(normalizedEmail);
    if (!result) {
      return reply.status(400).send({ success: false, error: "No passkey found for this email.", code: "NO_PASSKEY" });
    }
    const redis = getRedis();
    await redis.set(
      `${ADMIN_AUTH_AUTH_CHALLENGE_PREFIX}${normalizedEmail}`,
      result.challenge,
      "EX",
      ADMIN_AUTH_AUTH_CHALLENGE_TTL
    );
    return successEnvelope(reply, { options: result.options });
  });

  // --- POST /api/auth/login/passkey/verify (public; email + response) ---
  app.post("/api/auth/login/passkey/verify", async (req, reply) => {
    const parsed = bodyLoginPasskeyVerify.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    const redis = getRedis();
    const challengeKey = `${ADMIN_AUTH_AUTH_CHALLENGE_PREFIX}${parsed.data.email}`;
    const expectedChallenge = await redis.get(challengeKey);
    await redis.del(challengeKey);
    if (!expectedChallenge) {
      return reply.status(400).send({ success: false, error: "Challenge expired or missing. Request options again.", code: "CHALLENGE_EXPIRED" });
    }
    const requestOrigin = getWebAuthnRequestOrigin(req);
    const expectedOrigin = getExpectedWebAuthnOrigin(requestOrigin);
    const admin = await verifyPasskeyAssertion(
      parsed.data.email,
      parsed.data.response as unknown as import("@simplewebauthn/server").AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin
    );
    if (!admin) {
      return reply.status(401).send({ success: false, error: "Passkey verification failed.", code: "VERIFY_FAILED" });
    }
    const sessionTtlMinutes = (parsed.data.sessionTtlMinutes ?? 15) as SessionTtlMinutes;
    const { token, expiresAt } = await createSession(admin.adminId, sessionTtlMinutes);
    return successEnvelope(reply, {
      token,
      expiresAt,
      sessionTtlMinutes,
      admin: { id: admin.adminId, email: admin.email, name: admin.name, role: admin.role },
    });
  });

  // --- GET /api/auth/me (requires session) ---
  app.get("/api/auth/me", async (req, reply) => {
    const session = await requireAdminSession(req, reply);
    if (!session) return;
    return successEnvelope(reply, {
      adminId: session.adminId,
      email: session.email,
      name: session.name,
      role: session.role,
      expiresAt: session.expiresAt,
    });
  });

  // --- POST /api/auth/logout (requires session) ---
  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : (req as { cookies?: { admin_session?: string } }).cookies?.admin_session;
    if (token) {
      await deleteSession(token);
    }
    return successEnvelope(reply, { message: "Logged out." });
  });

  // --- GET /api/auth/passkey/options (requires session; add passkey) ---
  app.get("/api/auth/passkey/options", async (req, reply) => {
    const session = await requireAdminSession(req, reply);
    if (!session) return;
    const options = await getRegistrationOptionsForAdmin(session.adminId);
    if (!options) {
      return reply.status(500).send({ success: false, error: "Failed to generate options.", code: "OPTIONS_FAILED" });
    }
    const redis = getRedis();
    await redis.set(
      `${ADMIN_AUTH_REG_CHALLENGE_PREFIX}${session.adminId}`,
      options.challenge,
      "EX",
      ADMIN_AUTH_REG_CHALLENGE_TTL
    );
    return successEnvelope(reply, { options });
  });

  // --- POST /api/auth/passkey/verify (requires session; add passkey) ---
  app.post("/api/auth/passkey/verify", async (req, reply) => {
    const session = await requireAdminSession(req, reply);
    if (!session) return;
    const parsed = bodyPasskeyVerify.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    const redis = getRedis();
    const challengeKey = `${ADMIN_AUTH_REG_CHALLENGE_PREFIX}${session.adminId}`;
    const expectedChallenge = await redis.get(challengeKey);
    await redis.del(challengeKey);
    if (!expectedChallenge) {
      return reply.status(400).send({ success: false, error: "Challenge expired. Request options again.", code: "CHALLENGE_EXPIRED" });
    }
    const requestOrigin = getWebAuthnRequestOrigin(req);
    const expectedOrigin = getExpectedWebAuthnOrigin(requestOrigin);
    try {
      await verifyAndSavePasskey(
        session.adminId,
        parsed.data.response as unknown as import("@simplewebauthn/server").RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin,
        parsed.data.name
      );
      return successEnvelope(reply, { message: "Passkey added." });
    } catch (e) {
      req.log.warn({ err: e }, "admin passkey registration verify failed");
      return reply.status(400).send({
        success: false,
        error: "Passkey verification failed. Try again or request new passkey options.",
        code: "VERIFY_FAILED",
      });
    }
  });
}
