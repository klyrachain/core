"use strict";

/**
 * Prisma / Supabase pooler URLs often include ?pgbouncer=true. libpq (psql, some pg_dump
 * builds) rejects unknown URI params. Strip known Supabase extras for CLI tools.
 */
function sanitizePgUrlForLibpq(connectionString) {
  if (!connectionString || typeof connectionString !== "string") {
    return connectionString;
  }
  try {
    const u = new URL(connectionString);
    u.searchParams.delete("pgbouncer");
    const q = u.searchParams.toString();
    u.search = q ? `?${q}` : "";
    return u.toString();
  } catch {
    return connectionString
      .replace(/([?&])pgbouncer=[^&]*/gi, "$1")
      .replace(/\?&+/g, "?")
      .replace(/&&+/g, "&")
      .replace(/\?$/, "");
  }
}

module.exports = { sanitizePgUrlForLibpq };
