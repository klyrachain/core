/**
 * Business portal signup: email+password, magic link, Google OAuth; progressive onboarding (entity + intent).
 * Public routes under /api/business-auth/*.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getWebAuthnRequestOrigin } from "../../lib/webauthn-request-origin.js";
import { z } from "zod";
import { errorEnvelope, successEnvelope } from "../../lib/api-helpers.js";
import { verifyBusinessPortalToken } from "../../lib/business-session.js";
import { getEnv } from "../../config/env.js";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  getRedis,
  PORTAL_PASSKEY_REG_PREFIX,
  PORTAL_PASSKEY_REG_TTL,
} from "../../lib/redis.js";
import {
  registerWithEmailPassword,
  loginWithEmailPassword,
  getPortalEmailAvailability,
  storeMagicLinkToken,
  consumeMagicLinkToken,
  sendBusinessMagicLinkEmail,
  createGoogleOAuthState,
  assertValidOAuthState,
  exchangeGoogleCode,
  upsertUserFromGoogleProfile,
  saveOnboardingEntity,
  completeBusinessOnboarding,
  getBusinessPortalSession,
  parseSignupRole,
  parsePrimaryGoal,
  setupPortalProfile,
  getPortalPasskeyRegistrationOptions,
  verifyPortalPasskeyRegistration,
  getPortalPasskeyAuthOptions,
  verifyPortalPasskeyLogin,
  storePortalPasskeyAuthChallenge,
  takePortalPasskeyAuthChallenge,
  getExpectedBusinessPortalOrigin,
  createPortalLoginCode,
  consumePortalLoginCode,
  PORTAL_LOGIN_CODE_TTL_SECONDS,
} from "../../services/business-auth.service.js";
import { signupBusinessPageHtml } from "../web/signup-business-html.js";
import { isLikelyDatabaseUnavailableError } from "../../lib/db-errors.js";
import { acceptBusinessMemberInvite } from "../../services/business-member-invite.service.js";

function portalSignupLanding(req: FastifyRequest): string {
  const env = getEnv();
  if (env.BUSINESS_SIGNUP_LANDING_URL) {
    return env.BUSINESS_SIGNUP_LANDING_URL.replace(/\/$/, "");
  }
  const forwarded = req.headers["x-forwarded-proto"];
  const proto =
    typeof forwarded === "string" ? forwarded.split(",")[0]!.trim() : "http";
  const host = req.headers.host ?? `localhost:${env.PORT}`;
  return `${proto}://${host}/signup/business`;
}

/**
 * Base URL for magic-link emails (?magic=...).
 * Uses BUSINESS_SIGNUP_LANDING_URL when set (e.g. http://localhost:3001/business/signup) so links match Google OAuth landing.
 * If unset, uses BUSINESS_MAGIC_LINK_BASE_URL + /signup/business, else Core host + /signup/business.
 */
function businessMagicLinkLandingUrl(req: FastifyRequest): string {
  const env = getEnv();
  if (env.BUSINESS_SIGNUP_LANDING_URL?.trim()) {
    return env.BUSINESS_SIGNUP_LANDING_URL.replace(/\/$/, "");
  }
  const forceCore = env.BUSINESS_MAGIC_LINK_BASE_URL?.trim();
  if (forceCore) {
    return `${forceCore.replace(/\/$/, "")}/signup/business`;
  }
  const forwarded = req.headers["x-forwarded-proto"];
  const proto =
    typeof forwarded === "string" ? forwarded.split(",")[0]!.trim() : "http";
  const host = req.headers.host ?? `localhost:${env.PORT}`;
  return `${proto}://${host}/signup/business`;
}

function parseBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

async function requirePortalUser(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const token = parseBearer(req);
  if (!token) {
    reply.status(401).send({
      success: false,
      error: "Missing Bearer token.",
      code: "UNAUTHORIZED",
    });
    return null;
  }
  const v = verifyBusinessPortalToken(token);
  if (!v) {
    reply.status(401).send({
      success: false,
      error: "Invalid or expired session.",
      code: "UNAUTHORIZED",
    });
    return null;
  }
  return v.userId;
}

const emailCheckInput = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
});

const bodyRegister = z.object({
  email: z.string().email(),
  password: z.string().min(10),
});
const bodyLogin = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const bodyLoginCode = z.object({
  accessToken: z.string().min(10),
  redirectUrl: z.string().url().optional(),
});
const bodyLoginCodeConsume = z.object({
  code: z.string().min(6),
});
const bodyMagicRequest = z.object({ email: z.string().email() });
const bodyEntity = z.object({
  companyName: z.string().min(2).max(200),
  website: z.string().max(500).optional(),
});
const bodyComplete = z.object({
  signupRole: z.enum([
    "DEVELOPER",
    "FOUNDER_EXECUTIVE",
    "FINANCE_OPS",
    "PRODUCT",
  ]),
  primaryGoal: z.enum([
    "ACCEPT_PAYMENTS",
    "SEND_PAYOUTS",
    "INTEGRATE_SDK",
    "EXPLORING",
  ]),
});

export async function businessAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/signup/business", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply
      .type("text/html; charset=utf-8")
      .send(signupBusinessPageHtml());
  });

  app.get("/api/business-auth/google/start", async (_req: FastifyRequest, reply: FastifyReply) => {
    const env = getEnv();
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_REDIRECT_URI) {
      return reply.status(503).send({
        success: false,
        error: "Google sign-in is not configured.",
        code: "GOOGLE_DISABLED",
      });
    }
    const state = await createGoogleOAuthState();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
      prompt: "select_account",
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/business-auth/google/callback", async (req: FastifyRequest, reply: FastifyReply) => {
    const env = getEnv();
    const q = req.query as Record<string, string | undefined>;
    const code = q.code;
    const state = q.state;
    const err = q.error;
    const landing = portalSignupLanding(req);
    if (err) {
      return reply.redirect(`${landing}?error=${encodeURIComponent(String(err))}`);
    }
    if (!code || !state || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_REDIRECT_URI) {
      return reply.redirect(`${landing}?error=oauth_failed`);
    }
    try {
      await assertValidOAuthState(state);
      const profile = await exchangeGoogleCode(
        code,
        env.GOOGLE_OAUTH_CLIENT_ID,
        env.GOOGLE_OAUTH_CLIENT_SECRET,
        env.GOOGLE_OAUTH_REDIRECT_URI
      );
      if (!profile.id || !profile.email || !profile.verified_email) {
        return reply.redirect(`${landing}?error=email_not_verified`);
      }
      const { accessToken } = await upsertUserFromGoogleProfile(profile.id, profile.email);
      return reply.redirect(`${landing}?portal_token=${encodeURIComponent(accessToken)}`);
    } catch {
      return reply.redirect(`${landing}?error=oauth_failed`);
    }
  });

  app.get("/api/business-auth/email/check", async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { email?: string };
    const parsed = emailCheckInput.safeParse({ email: q.email });
    if (!parsed.success) {
      return errorEnvelope(reply, "Valid email query parameter is required.", 400);
    }
    try {
      const result = await getPortalEmailAvailability(parsed.data.email);
      return successEnvelope(reply, result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid email.";
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.post("/api/business-auth/email/check", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = emailCheckInput.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      const result = await getPortalEmailAvailability(parsed.data.email);
      return successEnvelope(reply, result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid email.";
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.post("/api/business-auth/register", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = bodyRegister.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      const { userId, accessToken } = await registerWithEmailPassword(
        parsed.data.email,
        parsed.data.password
      );
      return successEnvelope(reply, { userId, accessToken });
    } catch (e) {
      if (isLikelyDatabaseUnavailableError(e)) {
        req.log.error({ err: e }, "POST /api/business-auth/register database unavailable");
        return reply.status(503).send({
          success: false,
          error:
            "Database unreachable or misconfigured. Verify DATABASE_URL (host, password, db name, ?sslmode=require for cloud).",
          code: "DATABASE_UNAVAILABLE",
        });
      }
      const msg = e instanceof Error ? e.message : "Registration failed.";
      return reply.status(400).send({ success: false, error: msg, code: "REGISTER_FAILED" });
    }
  });

  app.post("/api/business-auth/login", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = bodyLogin.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      const { userId, accessToken } = await loginWithEmailPassword(
        parsed.data.email,
        parsed.data.password
      );
      return successEnvelope(reply, { userId, accessToken });
    } catch (e) {
      if (isLikelyDatabaseUnavailableError(e)) {
        req.log.error({ err: e }, "POST /api/business-auth/login database unavailable");
        return reply.status(503).send({
          success: false,
          error:
            "Database unreachable or misconfigured. Verify DATABASE_URL (host, password, db name, ?sslmode=require for cloud).",
          code: "DATABASE_UNAVAILABLE",
        });
      }
      return reply.status(401).send({
        success: false,
        error: "Invalid email or password.",
        code: "LOGIN_FAILED",
      });
    }
  });

  app.post("/api/business-auth/team/accept-invite", async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = await requirePortalUser(req, reply);
    if (!userId) return;
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, "Invalid body.", 400);
    }
    try {
      const { businessId } = await acceptBusinessMemberInvite(parsed.data.token, userId);
      return successEnvelope(reply, { businessId, message: "You joined the team." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Accept failed.";
      return reply.status(400).send({ success: false, error: msg, code: "INVITE_ACCEPT_FAILED" });
    }
  });

  app.post("/api/business-auth/login/code", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = bodyLoginCode.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    const { accessToken, redirectUrl } = parsed.data;
    const verified = verifyBusinessPortalToken(accessToken);
    if (!verified) {
      return reply.status(401).send({
        success: false,
        error: "Invalid or expired access token.",
        code: "UNAUTHORIZED",
      });
    }
    try {
      const code = await createPortalLoginCode(accessToken);
      return successEnvelope(reply, {
        code,
        redirectUrl: redirectUrl ?? undefined,
        ttlSeconds: PORTAL_LOGIN_CODE_TTL_SECONDS,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create login code.";
      return reply.status(400).send({ success: false, error: msg, code: "LOGIN_CODE_FAILED" });
    }
  });

  app.post(
    "/api/business-auth/login/code/consume",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = bodyLoginCodeConsume.safeParse(req.body);
      if (!parsed.success) {
        return errorEnvelope(reply, parsed.error.message, 400);
      }
      try {
        const accessToken = await consumePortalLoginCode(parsed.data.code);
        return successEnvelope(reply, { accessToken });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Invalid or expired login code.";
        return reply
          .status(400)
          .send({ success: false, error: msg, code: "LOGIN_CODE_INVALID" });
      }
    }
  );

  app.post("/api/business-auth/magic-link/request", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = bodyMagicRequest.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      const token = await storeMagicLinkToken(parsed.data.email);
      const magicUrl = `${businessMagicLinkLandingUrl(req)}?magic=${encodeURIComponent(token)}`;
      const emailResult = await sendBusinessMagicLinkEmail(parsed.data.email, magicUrl);
      return successEnvelope(reply, {
        message: emailResult.message,
        emailSent: emailResult.sent,
        ...(getEnv().NODE_ENV === "development" && !emailResult.sent
          ? { devMagicUrl: magicUrl }
          : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send magic link.";
      return reply.status(400).send({ success: false, error: msg, code: "MAGIC_LINK_FAILED" });
    }
  });

  app.post("/api/business-auth/magic-link/consume", async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string | undefined>;
    const b =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const pick = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const token =
      pick(b.token).length >= 10
        ? pick(b.token)
        : pick(b.magic).length >= 10
          ? pick(b.magic)
          : pick(q.token).length >= 10
            ? pick(q.token)
            : pick(q.magic).length >= 10
              ? pick(q.magic)
              : "";
    if (token.length < 10) {
      return reply.status(400).send({
        success: false,
        error: "Invalid or expired link.",
        code: "MAGIC_INVALID",
      });
    }
    try {
      const { userId, accessToken } = await consumeMagicLinkToken(token);
      return successEnvelope(reply, { userId, accessToken });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid link.";
      return reply.status(400).send({ success: false, error: msg, code: "MAGIC_INVALID" });
    }
  });

  app.get("/api/business-auth/session", async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = await requirePortalUser(req, reply);
    if (!userId) return;
    try {
      const session = await getBusinessPortalSession(userId);
      return successEnvelope(reply, session);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Session error.";
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.post("/api/business-auth/onboarding/entity", async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = await requirePortalUser(req, reply);
    if (!userId) return;
    const parsed = bodyEntity.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      await saveOnboardingEntity(userId, parsed.data.companyName, parsed.data.website);
      return successEnvelope(reply, { ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save.";
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.post("/api/business-auth/onboarding/complete", async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = await requirePortalUser(req, reply);
    if (!userId) return;
    const parsed = bodyComplete.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      const signupRole = parseSignupRole(parsed.data.signupRole);
      const primaryGoal = parsePrimaryGoal(parsed.data.primaryGoal);
      const result = await completeBusinessOnboarding(userId, signupRole, primaryGoal);
      return successEnvelope(reply, {
        businessId: result.businessId,
        slug: result.slug,
        landingHint: result.landingHint,
        accessToken: result.accessToken,
        alreadyHadBusiness: result.alreadyHadBusiness,
        mode: "sandbox",
        deferredKybNote:
          "Legal name, registration number, and address are collected when you request live API keys or go live.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not complete signup.";
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.get("/api/business-auth/config", async (_req: FastifyRequest, reply: FastifyReply) => {
    const env = getEnv();
    return successEnvelope(reply, {
      googleEnabled: Boolean(
        env.GOOGLE_OAUTH_CLIENT_ID &&
          env.GOOGLE_OAUTH_CLIENT_SECRET &&
          env.GOOGLE_OAUTH_REDIRECT_URI
      ),
    });
  });

  const bodyProfileSetup = z.object({
    displayName: z.string().min(2).max(120),
    password: z.string().min(10).optional(),
  });
  const bodyPasskeyRegister = z.object({
    response: z.record(z.unknown()),
    passkeyName: z.string().max(80).optional(),
  });
  const bodyPasskeyLoginOptions = z.object({
    email: z.string().email(),
  });
  const bodyPasskeyLoginVerify = z.object({
    email: z.string().email(),
    response: z.record(z.unknown()),
  });

  app.post("/api/business-auth/profile/setup", async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = await requirePortalUser(req, reply);
    if (!userId) return;
    const parsed = bodyProfileSetup.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    try {
      await setupPortalProfile(
        userId,
        parsed.data.displayName,
        parsed.data.password
      );
      return successEnvelope(reply, { ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save profile.";
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.get(
    "/api/business-auth/passkey/registration-options",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = await requirePortalUser(req, reply);
      if (!userId) return;
      const requestOrigin = getWebAuthnRequestOrigin(req);
      const options = await getPortalPasskeyRegistrationOptions(userId, requestOrigin);
      if (!options) {
        return reply.status(500).send({
          success: false,
          error: "Could not build passkey options.",
          code: "OPTIONS_FAILED",
        });
      }
      const redis = getRedis();
      await redis.set(
        `${PORTAL_PASSKEY_REG_PREFIX}${userId}`,
        options.challenge,
        "EX",
        PORTAL_PASSKEY_REG_TTL
      );
      return successEnvelope(reply, { options });
    }
  );

  app.post("/api/business-auth/passkey/register", async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = await requirePortalUser(req, reply);
    if (!userId) return;
    const parsed = bodyPasskeyRegister.safeParse(req.body);
    if (!parsed.success) {
      return errorEnvelope(reply, parsed.error.message, 400);
    }
    const redis = getRedis();
    const chKey = `${PORTAL_PASSKEY_REG_PREFIX}${userId}`;
    const expectedChallenge = await redis.get(chKey);
    await redis.del(chKey);
    if (!expectedChallenge) {
      return reply.status(400).send({
        success: false,
        error: "Challenge expired. Open registration options again.",
        code: "CHALLENGE_EXPIRED",
      });
    }
    const requestOrigin = getWebAuthnRequestOrigin(req);
    const expectedOrigin = getExpectedBusinessPortalOrigin(requestOrigin);
    try {
      await verifyPortalPasskeyRegistration(
        userId,
        parsed.data.response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin,
        parsed.data.passkeyName
      );
      return successEnvelope(reply, { message: "Passkey registered." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Passkey verification failed.";
      return reply.status(400).send({ success: false, error: msg, code: "PASSKEY_VERIFY_FAILED" });
    }
  });

  app.post(
    "/api/business-auth/login/passkey/options",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = bodyPasskeyLoginOptions.safeParse(req.body);
      if (!parsed.success) {
        return errorEnvelope(reply, parsed.error.message, 400);
      }
      const requestOrigin = getWebAuthnRequestOrigin(req);
      const result = await getPortalPasskeyAuthOptions(parsed.data.email, requestOrigin);
      if (!result) {
        return reply.status(400).send({
          success: false,
          error: "No passkey on file for this account.",
          code: "NO_PASSKEY",
        });
      }
      await storePortalPasskeyAuthChallenge(parsed.data.email, result.challenge);
      return successEnvelope(reply, { options: result.options });
    }
  );

  app.post(
    "/api/business-auth/login/passkey/verify",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = bodyPasskeyLoginVerify.safeParse(req.body);
      if (!parsed.success) {
        return errorEnvelope(reply, parsed.error.message, 400);
      }
      const email = parsed.data.email.trim().toLowerCase();
      const expectedChallenge = await takePortalPasskeyAuthChallenge(email);
      if (!expectedChallenge) {
        return reply.status(400).send({
          success: false,
          error: "Challenge expired. Request passkey options again.",
          code: "CHALLENGE_EXPIRED",
        });
      }
      const requestOrigin = getWebAuthnRequestOrigin(req);
      const expectedOrigin = getExpectedBusinessPortalOrigin(requestOrigin);
      const session = await verifyPortalPasskeyLogin(
        email,
        parsed.data.response as unknown as AuthenticationResponseJSON,
        expectedChallenge,
        expectedOrigin
      );
      if (!session) {
        return reply.status(401).send({
          success: false,
          error: "Passkey verification failed.",
          code: "PASSKEY_AUTH_FAILED",
        });
      }
      return successEnvelope(reply, {
        userId: session.userId,
        accessToken: session.accessToken,
      });
    }
  );
}
