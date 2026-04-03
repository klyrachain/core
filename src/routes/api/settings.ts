/**
 * Platform Settings API: general, financials, providers, risk, team, api.
 * All endpoints require platform admin key (no businessId). Used by dashboard /settings/*.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "crypto";
import { prisma } from "../../lib/prisma.js";
import {
  successEnvelope,
  errorEnvelope,
} from "../../lib/api-helpers.js";
import {
  getPlatformSettingOrDefault,
  patchPlatformSetting,
  maskSecret,
  getSwapFeeConfigMasked,
} from "../../services/platform-settings.service.js";
import {
  listFonbnkSupportedAssets,
  syncFonbnkSupportedAssetsInDb,
} from "../../services/fonbnk.service.js";
import { listRecentQuoteRouteAttempts } from "../../services/quote-route-memory.service.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import {
  PERMISSION_SETTINGS_READ,
  PERMISSION_SETTINGS_WRITE,
  PERMISSION_TEAM_READ,
  PERMISSION_TEAM_INVITE,
} from "../../lib/permissions.js";

const DEFAULT_GENERAL = {
  publicName: "MyCryptoApp",
  supportEmail: "",
  supportPhone: "",
  defaultCurrency: "USD",
  timezone: "UTC",
  maintenanceMode: false,
};

const DEFAULT_FINANCIALS = {
  baseFeePercent: 1,
  fixedFee: 0,
  minTransactionSize: 0,
  maxTransactionSize: 1_000_000,
  lowBalanceAlert: 1000,
};

const DEFAULT_PROVIDERS = {
  maxSlippagePercent: 1,
  providers: [
    { id: "SQUID", enabled: true, priority: 1, apiKey: "", status: "operational", latencyMs: null },
    { id: "LIFI", enabled: true, priority: 2, apiKey: "", status: "operational", latencyMs: null },
    { id: "0X", enabled: true, priority: 3, apiKey: "", status: "operational", latencyMs: null },
    { id: "PAYSTACK", enabled: true, priority: 4, apiKey: "", status: "operational", latencyMs: null },
  ],
};

const DEFAULT_RISK = {
  enforceKycOver1000: false,
  blockHighRiskIp: false,
  blacklist: [] as string[],
};

const DEFAULT_API = {
  webhookSigningSecret: "",
  slackWebhookUrl: "",
  alertEmails: "",
};

function parseBlacklist(input: unknown): string[] {
  if (Array.isArray(input)) return input.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean);
  if (typeof input === "string") return input.split(/\n/).map((s) => s.trim()).filter(Boolean);
  return [];
}

export async function settingsApiRoutes(app: FastifyInstance): Promise<void> {
  // --- GET /api/settings/general ---
  app.get("/api/settings/general", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
      const data = await getPlatformSettingOrDefault("general", DEFAULT_GENERAL);
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/settings/general");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- PATCH /api/settings/general ---
  app.patch("/api/settings/general", async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (body.publicName !== undefined) patch.publicName = String(body.publicName).slice(0, 100);
      if (body.supportEmail !== undefined) patch.supportEmail = String(body.supportEmail);
      if (body.supportPhone !== undefined) patch.supportPhone = body.supportPhone === null ? "" : String(body.supportPhone);
      if (body.defaultCurrency !== undefined) patch.defaultCurrency = String(body.defaultCurrency);
      if (body.timezone !== undefined) patch.timezone = String(body.timezone);
      if (body.maintenanceMode !== undefined) patch.maintenanceMode = Boolean(body.maintenanceMode);
      const data = await patchPlatformSetting("general", DEFAULT_GENERAL, patch);
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "PATCH /api/settings/general");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- GET /api/settings/swap-fee (admin only; recipient never exposed, masked only) ---
  app.get("/api/settings/swap-fee", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
      const data = await getSwapFeeConfigMasked();
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/settings/swap-fee");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- PATCH /api/settings/swap-fee (admin only; fee config set only here, never from client request body on quote endpoints) ---
  app.patch("/api/settings/swap-fee", async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const body = req.body ?? {};
      const current = await getPlatformSettingOrDefault("swapFee", {
        squidFeeRecipient: null,
        squidFeeBps: null,
        lifiIntegrator: "klyra",
        lifiFeePercent: null,
      });
      const patch: Record<string, unknown> = { ...current };
      if (body.squidFeeRecipient !== undefined) {
        const v = typeof body.squidFeeRecipient === "string" ? body.squidFeeRecipient.trim() : "";
        if (v === "" || v === null) {
          patch.squidFeeRecipient = null;
        } else if (/^0x[a-fA-F0-9]{40}$/.test(v)) {
          patch.squidFeeRecipient = v;
        } else {
          return errorEnvelope(reply, "squidFeeRecipient must be a valid 0x + 40 hex address or empty.", 400);
        }
      }
      if (body.squidFeeBps !== undefined) {
        const n = Number(body.squidFeeBps);
        if (Number.isNaN(n) || n < 0 || n > 10000) {
          return errorEnvelope(reply, "squidFeeBps must be between 0 and 10000 (basis points).", 400);
        }
        patch.squidFeeBps = n;
      }
      if (body.lifiIntegrator !== undefined) {
        patch.lifiIntegrator = typeof body.lifiIntegrator === "string" && body.lifiIntegrator.trim() ? body.lifiIntegrator.trim() : "klyra";
      }
      if (body.lifiFeePercent !== undefined) {
        const n = Number(body.lifiFeePercent);
        if (Number.isNaN(n) || n < 0 || n >= 1) {
          return errorEnvelope(reply, "lifiFeePercent must be between 0 and 1 (e.g. 0.005 = 0.5%).", 400);
        }
        patch.lifiFeePercent = n;
      }
      await patchPlatformSetting("swapFee", { squidFeeRecipient: null, squidFeeBps: null, lifiIntegrator: "klyra", lifiFeePercent: null }, patch);
      const data = await getSwapFeeConfigMasked();
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "PATCH /api/settings/swap-fee");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- GET /api/settings/financials ---
  app.get("/api/settings/financials", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
      const data = await getPlatformSettingOrDefault("financials", DEFAULT_FINANCIALS);
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/settings/financials");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- PATCH /api/settings/financials ---
  app.patch("/api/settings/financials", async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (body.baseFeePercent !== undefined) patch.baseFeePercent = Math.min(100, Math.max(0, Number(body.baseFeePercent) || 0));
      if (body.fixedFee !== undefined) patch.fixedFee = Math.max(0, Number(body.fixedFee) || 0);
      if (body.minTransactionSize !== undefined) patch.minTransactionSize = Math.max(0, Number(body.minTransactionSize) || 0);
      if (body.maxTransactionSize !== undefined) patch.maxTransactionSize = Math.max(0, Number(body.maxTransactionSize) || 0);
      if (body.lowBalanceAlert !== undefined) patch.lowBalanceAlert = Math.max(0, Number(body.lowBalanceAlert) || 0);
      const data = await patchPlatformSetting("financials", DEFAULT_FINANCIALS, patch);
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "PATCH /api/settings/financials");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- GET /api/settings/providers ---
  app.get("/api/settings/providers", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
      const raw = await getPlatformSettingOrDefault("providers", DEFAULT_PROVIDERS);
      const providers = Array.isArray(raw.providers) ? raw.providers : DEFAULT_PROVIDERS.providers;
      const masked = providers.map((p: Record<string, unknown>) => ({
        id: p.id,
        enabled: p.enabled,
        priority: p.priority,
        apiKeyMasked: maskSecret(p.apiKey as string),
        status: p.status ?? "operational",
        latencyMs: p.latencyMs ?? null,
      }));
      return successEnvelope(reply, { maxSlippagePercent: raw.maxSlippagePercent ?? 1, providers: masked });
    } catch (err) {
      req.log.error({ err }, "GET /api/settings/providers");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- PATCH /api/settings/providers ---
  app.patch("/api/settings/providers", async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const body = req.body ?? {};
      const current = await getPlatformSettingOrDefault("providers", DEFAULT_PROVIDERS);
      const providers = Array.isArray(current.providers) ? (current.providers as Record<string, unknown>[]) : [...DEFAULT_PROVIDERS.providers];
      if (body.maxSlippagePercent !== undefined) {
        current.maxSlippagePercent = Math.min(10, Math.max(0.1, Number(body.maxSlippagePercent) || 1));
      }
      if (Array.isArray(body.providers)) {
        for (const item of body.providers as { id?: string; enabled?: boolean; priority?: number }[]) {
          const id = item?.id;
          const existing = providers.find((p) => p.id === id);
          if (existing) {
            if (item.enabled !== undefined) existing.enabled = item.enabled;
            if (item.priority !== undefined) existing.priority = Math.max(1, Math.min(10, Number(item.priority) || 1));
          }
        }
      }
      await patchPlatformSetting("providers", DEFAULT_PROVIDERS, { ...current, providers });
      const masked = providers.map((p: Record<string, unknown>) => ({
        id: p.id,
        enabled: p.enabled,
        priority: p.priority,
        apiKeyMasked: maskSecret(p.apiKey as string),
        status: p.status ?? "operational",
        latencyMs: p.latencyMs ?? null,
      }));
      return successEnvelope(reply, { maxSlippagePercent: current.maxSlippagePercent, providers: masked });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/settings/providers");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- PATCH /api/settings/providers/:id (set apiKey or update enabled/priority) ---
  app.patch("/api/settings/providers/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: { apiKey?: string; enabled?: boolean; priority?: number } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const id = String(req.params?.id ?? "").toUpperCase();
      const validIds = ["SQUID", "LIFI", "0X", "PAYSTACK"];
      if (!validIds.includes(id)) return errorEnvelope(reply, "Invalid provider id", 400);
      const body = req.body ?? {};
      const current = await getPlatformSettingOrDefault("providers", DEFAULT_PROVIDERS);
      const providers = Array.isArray(current.providers) ? (current.providers as Record<string, unknown>[]) : [...DEFAULT_PROVIDERS.providers];
      const existing = providers.find((p) => p.id === id);
      if (!existing) return errorEnvelope(reply, "Provider not found", 404);
      if (body.apiKey !== undefined) existing.apiKey = String(body.apiKey);
      if (body.enabled !== undefined) existing.enabled = Boolean(body.enabled);
      if (body.priority !== undefined) existing.priority = Math.max(1, Math.min(10, Number(body.priority) || 1));
      await patchPlatformSetting("providers", DEFAULT_PROVIDERS, { ...current, providers });
      return successEnvelope(reply, {
        id: existing.id,
        enabled: existing.enabled,
        priority: existing.priority,
        apiKeyMasked: maskSecret(existing.apiKey as string),
        status: existing.status ?? "operational",
        latencyMs: existing.latencyMs ?? null,
      });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/settings/providers/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- GET /api/settings/risk ---
  app.get("/api/settings/risk", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
      const data = await getPlatformSettingOrDefault("risk", DEFAULT_RISK);
      const blacklist = Array.isArray(data.blacklist) ? data.blacklist : [];
      return successEnvelope(reply, {
        enforceKycOver1000: data.enforceKycOver1000 ?? false,
        blockHighRiskIp: data.blockHighRiskIp ?? false,
        blacklist,
      });
    } catch (err) {
      req.log.error({ err }, "GET /api/settings/risk");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- PATCH /api/settings/risk ---
  app.patch("/api/settings/risk", async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (body.enforceKycOver1000 !== undefined) patch.enforceKycOver1000 = Boolean(body.enforceKycOver1000);
      if (body.blockHighRiskIp !== undefined) patch.blockHighRiskIp = Boolean(body.blockHighRiskIp);
      if (body.blacklist !== undefined) patch.blacklist = parseBlacklist(body.blacklist);
      const data = await patchPlatformSetting("risk", DEFAULT_RISK, patch);
      return successEnvelope(reply, {
        enforceKycOver1000: data.enforceKycOver1000 ?? false,
        blockHighRiskIp: data.blockHighRiskIp ?? false,
        blacklist: Array.isArray(data.blacklist) ? data.blacklist : [],
      });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/settings/risk");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- GET /api/settings/team/admins ---
  app.get("/api/settings/team/admins", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_TEAM_READ)) return;
      const admins = await prisma.platformAdmin.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, role: true, twoFaEnabled: true },
      });
      const data = admins.map((a) => ({
        id: a.id,
        name: a.name ?? "",
        email: a.email,
        role: a.role,
        twoFaEnabled: a.twoFaEnabled,
      }));
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/settings/team/admins");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- POST /api/settings/team/invite ---
  app.post("/api/settings/team/invite", async (req: FastifyRequest<{ Body: { email?: string; role?: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_TEAM_INVITE)) return;
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const role = String(req.body?.role ?? "viewer").toLowerCase();
      const validRoles = ["super_admin", "support", "developer", "viewer"];
      if (!email) return errorEnvelope(reply, "email is required", 400);
      if (!validRoles.includes(role)) return errorEnvelope(reply, "Invalid role", 400);
      const existing = await prisma.platformAdmin.findUnique({ where: { email } });
      if (existing) return errorEnvelope(reply, "Admin with this email already exists", 409);
      await prisma.platformAdmin.create({
        data: {
          email,
          role: role as "super_admin" | "support" | "developer" | "viewer",
        },
      });
      return successEnvelope(reply, { invited: true, email }, 201);
    } catch (err) {
      req.log.error({ err }, "POST /api/settings/team/invite");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- GET /api/settings/api ---
  app.get("/api/settings/api", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
      const data = await getPlatformSettingOrDefault("api", DEFAULT_API);
      return successEnvelope(reply, {
        webhookSigningSecretMasked: maskSecret(data.webhookSigningSecret as string, 4),
        slackWebhookUrl: data.slackWebhookUrl ?? "",
        alertEmails: data.alertEmails ?? "",
      });
    } catch (err) {
      req.log.error({ err }, "GET /api/settings/api");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- PATCH /api/settings/api ---
  app.patch("/api/settings/api", async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (body.slackWebhookUrl !== undefined) patch.slackWebhookUrl = String(body.slackWebhookUrl);
      if (body.alertEmails !== undefined) patch.alertEmails = String(body.alertEmails);
      await patchPlatformSetting("api", DEFAULT_API, patch);
      const data = await getPlatformSettingOrDefault("api", DEFAULT_API);
      return successEnvelope(reply, {
        webhookSigningSecretMasked: maskSecret(data.webhookSigningSecret as string, 4),
        slackWebhookUrl: data.slackWebhookUrl ?? "",
        alertEmails: data.alertEmails ?? "",
      });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/settings/api");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- POST /api/settings/api/rotate-webhook-secret ---
  app.post("/api/settings/api/rotate-webhook-secret", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const newSecret = "whsec_" + randomBytes(32).toString("hex");
      await patchPlatformSetting("api", DEFAULT_API, { webhookSigningSecret: newSecret });
      return successEnvelope(reply, {
        webhookSigningSecretMasked: maskSecret(newSecret, 4),
      }, 200);
    } catch (err) {
      req.log.error({ err }, "POST /api/settings/api/rotate-webhook-secret");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- POST /api/settings/quotes/fonbnk/sync ---
  app.post(
    "/api/settings/quotes/fonbnk/sync",
    async (
      req: FastifyRequest<{ Body: { codes?: string[]; source?: string } }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
        const body = req.body ?? {};
        const data = await syncFonbnkSupportedAssetsInDb({
          codes: Array.isArray(body.codes) ? body.codes : undefined,
          source: typeof body.source === "string" ? body.source : "admin_manual",
        });
        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "POST /api/settings/quotes/fonbnk/sync");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- GET /api/settings/quotes/fonbnk/supported ---
  app.get(
    "/api/settings/quotes/fonbnk/supported",
    async (
      req: FastifyRequest<{ Querystring: { limit?: string; network?: string } }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
        const limit = Number.parseInt(req.query.limit ?? "100", 10);
        const data = await listFonbnkSupportedAssets({
          limit: Number.isFinite(limit) ? limit : 100,
          network: req.query.network,
        });
        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "GET /api/settings/quotes/fonbnk/supported");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- GET /api/settings/quotes/routes ---
  app.get(
    "/api/settings/quotes/routes",
    async (
      req: FastifyRequest<{
        Querystring: {
          limit?: string;
          chainId?: string;
          tokenKey?: string;
          countryCode?: string;
          provider?: string;
        };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
        const parsedChainId = Number.parseInt(req.query.chainId ?? "", 10);
        const parsedLimit = Number.parseInt(req.query.limit ?? "50", 10);
        const data = await listRecentQuoteRouteAttempts({
          limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
          chainId: Number.isFinite(parsedChainId) ? parsedChainId : undefined,
          tokenKey: req.query.tokenKey,
          countryCode: req.query.countryCode,
          provider: req.query.provider,
        });
        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "GET /api/settings/quotes/routes");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}

