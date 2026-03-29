#!/usr/bin/env node
"use strict";
/**
 * Dump DATABASE_URL (or DIRECT_URL) to a SQL file. Requires pg_dump on PATH.
 *
 * From core/:
 *   pnpm db:backup
 *   pnpm db:backup ./my-backup.sql
 *   pnpm db:backup -- --data-only
 *   pnpm db:backup -- --data-only ./data-only.sql
 *
 * Use --data-only when remote already has schema (pnpm db:migrate:deploy); then pnpm db:restore.
 *
 * Loads core/.env (keys already in process.env are left unchanged).
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

const dbUrl = sanitizePgUrlForLibpq(rawDbUrl);

/** pnpm/npm pass a literal `--` before forwarded args; never treat it as the output path. */
function parseBackupArgv(argv) {
  const tokens = argv.filter((a) => a !== "--");
  let dataOnly = false;
  const positionals = [];
  for (const a of tokens) {
    if (a === "--data-only") dataOnly = true;
    else if (!a.startsWith("-")) positionals.push(a);
  }
  return { dataOnly, outArg: positionals[0] };
}

const { dataOnly, outArg } = parseBackupArgv(process.argv.slice(2));
const backupsDir = path.join(projectRoot, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const defaultName = dataOnly ? `data-only-${stamp}.sql` : `backup-${stamp}.sql`;
const outFile =
  outArg && path.isAbsolute(outArg)
    ? outArg
    : outArg
      ? path.resolve(process.cwd(), outArg)
      : path.join(backupsDir, defaultName);

if (!outArg) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const parentDir = path.dirname(outFile);
if (!fs.existsSync(parentDir)) {
  fs.mkdirSync(parentDir, { recursive: true });
}

const dumpArgs = ["--no-owner", "--no-acl", "--format=p", "-f", outFile];
if (dataOnly) dumpArgs.unshift("--data-only");
dumpArgs.push(dbUrl);

const r = spawnSync("pg_dump", dumpArgs, { stdio: "inherit", env: process.env });

if (r.error) {
  console.error(r.error.message);
  console.error(
    "Install PostgreSQL client tools so `pg_dump` is available on your PATH."
  );
  process.exit(1);
}

if (r.status === 0) {
  console.error(`Wrote ${outFile}`);
}

process.exit(r.status ?? 1);
