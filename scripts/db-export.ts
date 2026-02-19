#!/usr/bin/env node
/**
 * Export database to a SQL file so you can share it with teammates.
 * Requires: PostgreSQL client tools (pg_dump) on PATH.
 *
 * Usage: pnpm run db:export
 * Output: prisma/backup.sql (add to .gitignore; share via file transfer).
 *
 * Load .env from project root (same as prisma.config).
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url || !url.startsWith("postgresql")) {
  console.error("Set DIRECT_URL or DATABASE_URL in .env (postgresql://...)");
  process.exit(1);
}

const outPath = resolve(process.cwd(), "prisma", "backup.sql");
const args = [
  "--dbname=" + url,
  "--no-owner",
  "--no-acl",
  "-f",
  outPath,
];

console.log("Exporting database to", outPath, "...");
const child = spawn("pg_dump", args, { stdio: "inherit" });
child.on("exit", (code) => {
  if (code === 0) {
    console.log("Done. Send prisma/backup.sql to your teammate and they run: pnpm run db:import");
  } else {
    process.exit(code ?? 1);
  }
});
