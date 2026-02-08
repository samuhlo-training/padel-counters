import { db } from "../src/db/db";
import { sql } from "drizzle-orm";

/**
 * █ SCRIPT: DB RESET (HARD)
 * =====================================================================
 * DESC:   ELIMINA y RECREA el schema 'public'.
 *         ¡¡DESTRUCTIVO!! Borra tablas, tipos, vistas y datos.
 * USAGE:  bun scripts/db_reset.ts
 * =====================================================================
 */
async function resetDatabase() {
  const env = process.env.NODE_ENV || process.env.APP_ENV;
  if (env === "production") {
    console.error("❌ ABORTED: Cannot run db_reset in production environment.");
    process.exit(1);
  }

  console.log("🧨 STARTING HARD DATABASE RESET...");

  try {
    // -------------------------------------------------------------------------
    // █ SCHEMA RECREATION
    // -------------------------------------------------------------------------
    // [WARNING] -> Esto elimina TODO. Es más agresivo que un truncate.
    // Útil cuando las migraciones están rotas o inconsistentes.
    await db.execute(sql`DROP SCHEMA public CASCADE;`);
    await db.execute(sql`CREATE SCHEMA public;`);

    // [CONFIG] -> Restaurar permisos estándar para que el usuario pueda crear tablas
    await db.execute(sql`GRANT ALL ON SCHEMA public TO public;`);
    await db.execute(
      sql`COMMENT ON SCHEMA public IS 'standard public schema';`,
    );

    console.log("✅ DATABASE RESET SUCCESSFULLY");
    console.log("   - Schema 'public' dropped and recreated.");
  } catch (error) {
    console.error("❌ RESET FAILED:", error);
    await db.$client.end?.();
    process.exit(1);
  }
  await db.$client.end?.();
  process.exit(0);
}

resetDatabase();
