/**
 * █ [ROUTE] :: COURTS_APP
 * =====================================================================
 * DESC:   Gestiona el estado y disponibilidad de las pistas.
 * STATUS: STABLE
 * =====================================================================
 */
import { Hono } from "hono";
import { eq, desc, sql, aliasedTable } from "drizzle-orm";
import { db } from "../db/db.ts";
import { courts, matches } from "../db/schema.ts";

export const courtsApp = new Hono();

// =============================================================================
// █ GET /courts
// =============================================================================
// DESC: Lista todas las pistas con su estado (busy/free).
// LOGIC: Si activeMatchId != null -> 'busy'. Incluye startTime del match activo.
courtsApp.get("/", async (c) => {
  try {
    // 1. QUERY -> LEFT JOIN para traer datos del match activo
    // SUBQUERY: Obtener el último partido jugado en la pista (ordenado por fecha desc)
    // Usamos una subquery correlacionada en la lista de selección
    const historyMatches = aliasedTable(matches, "history_matches");

    const allCourts = await db
      .select({
        id: courts.id,
        name: courts.name,
        activeMatchId: courts.activeMatchId,
        startTime: matches.startTime,
        matchType: matches.matchType,
        pairAName: matches.pairAName,
        pairBName: matches.pairBName,
        lastMatchId: sql<number | null>`(${db
          .select({ id: historyMatches.id })
          .from(historyMatches)
          .where(eq(historyMatches.courtId, courts.id))
          .orderBy(desc(historyMatches.createdAt))
          .limit(1)})`, // Drizzle permite esto para subqueries escalares
      })
      .from(courts)
      .leftJoin(matches, eq(courts.activeMatchId, matches.id));

    // 2. MAPPING -> Transformar a DTO con estado
    const courtsWithStatus = allCourts.map((court) => ({
      id: court.id,
      name: court.name,
      status: court.activeMatchId ? "busy" : "free",
      activeMatchId: court.activeMatchId,
      lastMatchId: court.lastMatchId ?? null, // <-- Mapeo
      startTime: court.startTime ?? null,
      matchType: court.matchType ?? null,
      pairAName: court.pairAName ?? null,
      pairBName: court.pairBName ?? null,
    }));

    return c.json(courtsWithStatus);
  } catch (error) {
    console.error("Error fetching courts:", error);
    return c.json({ error: "Failed to fetch courts" }, 500);
  }
});
