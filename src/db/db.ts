/**
 * █ [CORE] :: DB_CONFIG
 * =====================================================================
 * DESC:   Inicializa Drizzle ORM con el pool de Node-Postgres.
 * STATUS: STABLE
 * =====================================================================
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

// =============================================================================
// █ CORE: CONFIG & VALIDATION
// =============================================================================
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida");
}

// =============================================================================
// █ INSTANCE: DATABASE CONNECTION
// =============================================================================
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL +
    (process.env.DATABASE_URL?.includes("?") ? "&" : "?") +
    // [FIX]: PG WARNING -> 'uselibpqcompat=true' silencia warning de versiones futuras
    // [SEC]: FORCE SSL  -> 'sslmode=require' asegura conexión encriptada (Neon/Cloud)
    "sslmode=require&uselibpqcompat=true",
});

export const db = drizzle(pool, { schema });
