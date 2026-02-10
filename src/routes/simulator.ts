import { Hono } from "hono";
import { Simulator } from "../../services/simulator.ts";

export const simulatorApp = new Hono();

/**
 * █ [ROUTE] :: /simulator
 * =====================================================================
 * DESC:   Controla la simulación de partidos para pruebas de Frontend.
 * STATUS: DEVELOPMENT
 * =====================================================================
 */

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

    // Iniciar simulación (async, no esperamos a que termine el partido)
    Simulator.createAndSimulate(Number(courtId)).catch((err) => {
      console.error("[SIM] Error en background:", err);
    });

    return c.json({
      status: "success",
      message: `Simulation started for court ${courtId}`,
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

    const stopped = Simulator.stop(Number(matchId));

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
