#!/usr/bin/env node
"use strict";
/**
 * Push Supabase SQL migrations to the linked remote database.
 * Run from core/: pnpm db:supabase:push   or   node supabase/push.cjs
 *
 * If not linked:
 *   1. Set SUPABASE_PROJECT_REF or NEXT_PUBLIC_SUPABASE_REF in core/.env
 *   2. Run pnpm db:supabase:push again (script tries link then push)
 *
 * Canonical schema for this service is Prisma (prisma/migrations).
 * For remote Supabase Postgres, prefer: pnpm db:migrate:deploy with DATABASE_URL
 * pointing at the remote. Use this script only if you maintain SQL under supabase/migrations.
 */
const path = require("path");
const { spawnSync } = require("child_process");
const fs = require("fs");

const projectRoot = path.join(__dirname, "..");
const runSupabase = path.join(projectRoot, "scripts", "run-supabase.cjs");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: projectRoot,
    shell: opts.shell ?? false,
    stdio: opts.stdio ?? "inherit",
    encoding: opts.encoding,
    env: { ...process.env, ...opts.env },
  });
}

function loadEnvFrom(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    content.split("\n").forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
      }
    });
  } catch (_) {
    /* ignore */
  }
}

loadEnvFrom(path.join(projectRoot, ".env"));

function isLinked() {
  const r = run(process.execPath, [runSupabase, "status"], {
    stdio: "pipe",
    encoding: "utf8",
  });
  return r.status === 0;
}

function getProjectRef() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_REF?.trim() ||
    process.env.SUPABASE_PROJECT_REF?.trim() ||
    ""
  );
}

function tryLink() {
  const ref = getProjectRef();
  if (!ref) return false;
  const args = ["link", "--project-ref", ref];
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (password) args.push("--password", password);
  const r = run(process.execPath, [runSupabase, ...args], {
    stdio: "inherit",
  });
  return r.status === 0;
}

function printLinkHelp() {
  console.error("");
  console.error(
    "Supabase project is not linked. Link once, then run pnpm db:supabase:push again."
  );
  console.error("");
  console.error("Option A — auto link from core/.env:");
  console.error("  1. SUPABASE_PROJECT_REF=<ref> (or NEXT_PUBLIC_SUPABASE_REF)");
  console.error("     Ref = subdomain only (https://abcd.supabase.co → abcd)");
  console.error("  2. Optional: SUPABASE_DB_PASSWORD for non-interactive link");
  console.error("  3. cd core && pnpm db:supabase:push");
  console.error("");
  console.error("Option B — link manually (from core/):");
  console.error("  node scripts/run-supabase.cjs link --project-ref <ref>");
  console.error("  pnpm db:supabase:push");
  console.error("");
  console.error("Prisma workflow (default): pnpm db:migrate:deploy");
  console.error("");
}

if (!isLinked()) {
  if (!tryLink()) {
    printLinkHelp();
    process.exit(1);
  }
}

const args = ["db", "push", ...process.argv.slice(2)];
const result = run(process.execPath, [runSupabase, ...args]);
process.exit(result.status ?? 1);
