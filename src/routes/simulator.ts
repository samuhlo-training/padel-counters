import { Hono } from "hono";
import { Simulator } from "../../services/simulator.ts";
import { db } from "../db/db.ts";
import { matches } from "../db/schema.ts";
import { inArray } from "drizzle-orm";

export const simulatorApp = new Hono();

/**
 * █ [ROUTE] :: /simulator
 * =====================================================================
 * DESC:   Controla la simulación de partidos para pruebas de Frontend.
 * STATUS: DEVELOPMENT
 * =====================================================================
 */

/**
 * GET /simulator/status
 * Returns active simulations with match details (matchId, courtId, startTime, status).
 * Allows the frontend to recover state on reload.
 */
simulatorApp.get("/status", async (c) => {
  try {
    const activeMatchIds = [...Simulator.getActiveMatchIds()];

    if (activeMatchIds.length === 0) {
      return c.json({ activeSimulations: [] });
    }

    // Fetch match details for all active simulations in one query
    const activeMatches = await db
      .select({
        matchId: matches.id,
        courtId: matches.courtId,
        startTime: matches.startTime,
        status: matches.status,
      })
      .from(matches)
      .where(inArray(matches.id, activeMatchIds));

    return c.json({ activeSimulations: activeMatches });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500);
  }
});

/**
 * POST /simulator/start
 * Body: { courtId: number }
 * Inicia una simulación en la pista indicada.
 */
simulatorApp.post("/start", async (c) => {
  try {
    const body = await c.req.json();
    const courtId = body.courtId;

    if (!courtId) {
      return c.json({ error: "courtId is required" }, 400);
    }

    const numericCourtId = Number(courtId);
    if (!Number.isInteger(numericCourtId) || numericCourtId <= 0) {
      return c.json({ error: "courtId must be a positive integer" }, 400);
    }

    // Await match creation to get the matchId, the simulation loop runs in background via setTimeout
    const result = await Simulator.createAndSimulate(numericCourtId);

    return c.json({
      status: "success",
      message: `Simulation started for court ${courtId}`,
      matchId: result.matchId,
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500);
  }
});

/**
 * POST /simulator/stop
 * Body: { matchId: number }
 * Detiene la simulación de un partido específico.
 */
simulatorApp.post("/stop", async (c) => {
  try {
    const body = await c.req.json();
    const matchId = body.matchId;

    if (!matchId) {
      return c.json({ error: "matchId is required" }, 400);
    }

    const numericMatchId = Number(matchId);
    if (!Number.isInteger(numericMatchId) || numericMatchId <= 0) {
      return c.json({ error: "matchId must be a positive integer" }, 400);
    }

    const stopped = await Simulator.stop(numericMatchId);

    if (stopped) {
      return c.json({
        status: "success",
        message: `Simulation stopped for match ${matchId}`,
      });
    } else {
      return c.json(
        { status: "error", message: `Match ${matchId} is not being simulated` },
        404,
      );
    }
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500);
  }
});
