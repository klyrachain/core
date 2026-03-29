#!/usr/bin/env node
"use strict";
/**
 * Restore a plain-SQL backup (from pnpm db:backup) into DATABASE_URL.
 * Requires `psql` on PATH. This does NOT run migrations — apply those first if needed.
 *
 * Usage (from core/):
 *   pnpm db:restore ./backups/backup-2026-03-28T12-00-00.sql
 *   pnpm db:restore /absolute/path/dump.sql
 *
 * Migrations (pnpm db:migrate:deploy) only change schema. To copy data from local to remote,
 * backup local, point DATABASE_URL at remote, then run this command.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { sanitizePgUrlForLibpq } = require("./sanitize-pg-url.cjs");

const projectRoot = path.join(__dirname, "..");

function loadDotEnv(filePath) {
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

loadDotEnv(path.join(projectRoot, ".env"));

const rawDbUrl =
  process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
if (!rawDbUrl) {
  console.error(
    "DATABASE_URL (or DIRECT_URL) not set in core/.env (or pass via environment)."
  );
  process.exit(1);
}

/** libpq rejects ?pgbouncer=true; Supabase pooler URLs include it for Prisma. */
const dbUrl = sanitizePgUrlForLibpq(rawDbUrl);

const positionals = process.argv
  .slice(2)
  .filter((a) => a !== "--" && !a.startsWith("-"));
const rel = positionals[0];
if (!rel?.trim()) {
  console.error("Usage: pnpm db:restore <path-to-backup.sql>");
  console.error(
    "Example: pnpm db:restore ./backups/backup-2026-03-28T12-00-00.sql"
  );
  process.exit(1);
}

const abs = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
if (!fs.existsSync(abs)) {
  console.error(`File not found: ${abs}`);
  process.exit(1);
}

const r = spawnSync(
  "psql",
  ["-v", "ON_ERROR_STOP=1", "-f", abs, "-d", dbUrl],
  { stdio: "inherit", env: process.env }
);

if (r.error) {
  console.error(r.error.message);
  console.error("Install PostgreSQL client tools so `psql` is on your PATH.");
  process.exit(1);
}

process.exit(r.status ?? 1);
