#!/usr/bin/env node
"use strict";
/**
 * Runs the Supabase CLI via npx (no global install required).
 * Run from core/: node scripts/run-supabase.cjs status
 */
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const r = spawnSync("npx", ["--yes", "supabase", ...args], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
process.exit(r.status === null ? 1 : r.status);
