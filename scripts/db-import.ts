#!/usr/bin/env node
/**
 * Import a database backup (from a teammate) into your local DB.
 * Requires: PostgreSQL client tools (psql) on PATH.
 *
 * Usage: pnpm run db:import
 * Expects: prisma/backup.sql (place the file they sent you there).
 *
 * WARNING: This replaces data in your database. Run migrations first if needed.
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url || !url.startsWith("postgresql")) {
  console.error("Set DIRECT_URL or DATABASE_URL in .env (postgresql://...)");
  process.exit(1);
}

const backupPath = resolve(process.cwd(), "prisma", "backup.sql");
if (!existsSync(backupPath)) {
  console.error("Backup file not found:", backupPath);
  console.error("Place the backup.sql file from your teammate in prisma/backup.sql");
  process.exit(1);
}

console.log("Importing", backupPath, "into your database...");
const child = spawn("psql", [url, "-f", backupPath], { stdio: "inherit" });
child.on("exit", (code) => {
  if (code === 0) {
    console.log("Done. Your database now has the same data.");
  } else {
    process.exit(code ?? 1);
  }
});
