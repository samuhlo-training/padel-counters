import { db } from "../src/db/db";
import { sql } from "drizzle-orm";

/**
 * █ SCRIPT: DB PURGE
 * =====================================================================
 * DESC:   Limpia TODAS las tablas de la base de datos.
 *         Usa TRUNCATE ... CASCADE para eliminar datos manteniendo estructura.
 * USAGE:  bun run db:purge
 * =====================================================================
 */
async function purgeDatabase() {
  console.log("🧨 STARTING DATABASE PURGE...");

  try {
    // -------------------------------------------------------------------------
    // █ TRUNCATE CASCADE
    // -------------------------------------------------------------------------
    // [EXPLICACIÓN] -> Postgres requiere CASCADE porque estas tablas tienen
    // ForeignKey constraints. Borrar 'matches' afecta a 'match_stats', etc.
    // RESTART IDENTITY -> Reinicia los contadores de ID (serial) a 1.
    await db.execute(sql`
      TRUNCATE TABLE 
        point_history,
        match_sets,
        match_stats, 
        commentary, 
        matches, 
        players 
      RESTART IDENTITY CASCADE;
    `);

    // [LOGGING] -> Feedback visual del éxito
    console.log("✅ DATABASE PURGED SUCCESSFULLY");
    console.log("   - point_history [CLEARED]");
    console.log("   - match_sets    [CLEARED]");
    console.log("   - match_stats   [CLEARED]");
    console.log("   - commentary    [CLEARED]");
    console.log("   - matches       [CLEARED]");
    console.log("   - players       [CLEARED]");
  } catch (error) {
    console.error("❌ PURGE FAILED:", error);
    process.exit(1);
  }

  process.exit(0);
}

purgeDatabase();
