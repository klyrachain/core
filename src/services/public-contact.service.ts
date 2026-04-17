import { z } from "zod";
import { getEnv } from "../config/env.js";
import { getRedis } from "../lib/redis.js";
import { sendEmail } from "./email.service.js";
import {
  publicContactAckHtml,
  publicContactAckSubject,
  publicContactAckText,
  publicContactTeamHtml,
  publicContactTeamSubject,
  publicContactTeamText,
} from "../email/templates/public-contact-form.js";

const BodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(200).optional(),
  topic: z.enum(["general", "sales", "support", "partnerships", "compliance"]),
  message: z.string().trim().min(20).max(8000),
  /** Honeypot — must be empty */
  website: z.string().optional(),
});

const TOPIC_LABEL: Record<string, string> = {
  general: "General",
  sales: "Sales",
  support: "Support",
  partnerships: "Partnerships",
  compliance: "Compliance",
};

const RATE_PREFIX = "contact_form:";
const RATE_MAX = 5;
const RATE_WINDOW_SEC = 3600;

function clientIpFromHeaders(h: Record<string, string | string[] | undefined>): string {
  const xf = h["x-forwarded-for"];
  const first = typeof xf === "string" ? xf.split(",")[0]?.trim() : "";
  if (first) return first;
  const rip = h["x-real-ip"];
  return typeof rip === "string" ? rip.trim() : "unknown";
}

async function checkRateLimit(ip: string): Promise<boolean> {
  try {
    const r = getRedis();
    const key = `${RATE_PREFIX}${ip}`;
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, RATE_WINDOW_SEC);
    return n <= RATE_MAX;
  } catch {
    return true;
  }
}

export async function submitPublicContact(
  body: unknown,
  headers: Record<string, string | string[] | undefined>
): Promise<{ ok: true } | { ok: false; error: string; code: string; status: number }> {
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check all fields and try again.",
      code: "VALIDATION",
      status: 400,
    };
  }
  const data = parsed.data;
  if ((data.website ?? "").trim().length > 0) {
    return { ok: false, error: "Invalid request.", code: "REJECTED", status: 400 };
  }

  const env = getEnv();
  const inbox = env.CONTACT_INBOX_EMAIL?.trim();
  if (!inbox) {
    return {
      ok: false,
      error: "Contact form is not configured.",
      code: "NOT_CONFIGURED",
      status: 503,
    };
  }

  const ip = clientIpFromHeaders(headers);
  const allowed = await checkRateLimit(ip);
  if (!allowed) {
    return { ok: false, error: "Too many submissions. Try again later.", code: "RATE_LIMIT", status: 429 };
  }

  const topicLabel = TOPIC_LABEL[data.topic] ?? data.topic;
  const submittedAtIso = new Date().toISOString();
  const entityRef = `contact:${submittedAtIso}:${data.email}`;

  const teamVars = {
    name: data.name,
    email: data.email,
    company: data.company,
    topic: topicLabel,
    message: data.message,
    submittedAtIso,
  };

  const teamResult = await sendEmail({
    to: inbox,
    replyTo: data.email,
    subject: publicContactTeamSubject({ topic: topicLabel }),
    html: publicContactTeamHtml(teamVars),
    text: publicContactTeamText(teamVars),
    entityRefId: entityRef,
    fromPersona: "general",
  });

  if (!teamResult.ok) {
    return {
      ok: false,
      error: "Could not send message. Please try again later.",
      code: "EMAIL_FAILED",
      status: 502,
    };
  }

  const ack = await sendEmail({
    to: data.email,
    subject: publicContactAckSubject(),
    html: publicContactAckHtml({ name: data.name }),
    text: publicContactAckText(),
    entityRefId: `${entityRef}:ack`,
    fromPersona: "general",
  });
  if (!ack.ok) {
    /* Team mail succeeded; ack is best-effort */
  }

  return { ok: true };
}
