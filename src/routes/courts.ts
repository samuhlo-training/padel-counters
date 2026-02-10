/**
 * █ [ROUTE] :: COURTS_APP
 * =====================================================================
 * DESC:   Gestiona el estado y disponibilidad de las pistas.
 * STATUS: STABLE
 * =====================================================================
 */
import { Hono } from "hono";
import { db } from "../db/db.ts";
import { courts } from "../db/schema.ts";

export const courtsApp = new Hono();

// =============================================================================
// █ GET /courts
// =============================================================================
// DESC: Lista todas las pistas con su estado (busy/free).
// LOGIC: Si activeMatchId != null -> 'busy'.
courtsApp.get("/", async (c) => {
  try {
    // 1. QUERY -> Obtener todas las pistas
    const allCourts = await db.select().from(courts);

    // 2. MAPPING -> Transformar a DTO con estado
    const courtsWithStatus = allCourts.map((court) => ({
      id: court.id,
      name: court.name,
      status: court.activeMatchId ? "busy" : "free",
      activeMatchId: court.activeMatchId,
    }));

    return c.json(courtsWithStatus);
  } catch (error) {
    console.error("Error fetching courts:", error);
    return c.json({ error: "Failed to fetch courts" }, 500);
  }
});
