/**
 * █ [API_ROUTE] :: MATCHES_HANDLER (HONO EDITION)
 * =====================================================================
 * DESC:   Gestiona operaciones CRUD para partidos.
 *         Delega la lógica de negocio a MatchService.
 * STATUS: STABLE
 * =====================================================================
 */
import { Hono } from "hono";
import {
  createMatchSchema,
  listMatchesQuerySchema,
  matchIdParamSchema,
} from "../validation/matches.ts";
import { db } from "../db/db.ts";
import { matches } from "../db/schema.ts";
import { getMatchStatus } from "../utils/match-status.ts";
import { desc } from "drizzle-orm";
import { pointActionSchema } from "../validation/point_action.ts";
import { processPointScored } from "../controllers/match.ts";
import { MatchService } from "../services/matchService.ts";

export const matchesApp = new Hono();

const MAX_LIMIT = 100;

// =============================================================================
// █ ENDPOINT: GET /
// DESC: Lista partidos con paginación.
// =============================================================================
matchesApp.get("/", async (c) => {
  const parsed = listMatchesQuerySchema.safeParse(c.req.query());

  if (!parsed.success) {
    return c.json(
      { error: "Invalid query params", details: parsed.error },
      400,
    );
  }

  const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);

  try {
    const data = await db
      .select()
      .from(matches)
      .orderBy(desc(matches.createdAt))
      .limit(limit);

    return c.json({ data });
  } catch (error) {
    console.error(`[ERR]   :: DB_QUERY_ERR  :: ${error}`);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// =============================================================================
// █ ENDPOINT: POST /
// DESC: Crea un partido nuevo. Delega todo a MatchService.createMatch.
//       - Valida body con Zod
//       - Calcula status inicial
//       - Delega creación, stats, court update y broadcast al Service
//       - Devuelve 409 si la pista ya está ocupada
// =============================================================================
matchesApp.post("/", async (c) => {
  // 1. PARSE BODY
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // 2. VALIDATE
  const result = createMatchSchema.safeParse(body);
  if (!result.success) {
    console.log(
      `[API]   :: INVALID_BODY  :: ${JSON.stringify(result.error).slice(0, 100)}...`,
    );
    return c.json({ error: "Validation failed", details: result.error }, 400);
  }

  const data = result.data;

  // 3. CALCULATE STATUS
  let calculatedStatus: "scheduled" | "live" | "finished" = "scheduled";
  if (data.endTime) {
    const status = getMatchStatus(data.startTime, data.endTime);
    if (status) calculatedStatus = status as typeof calculatedStatus;
  } else if (new Date(data.startTime) <= new Date()) {
    calculatedStatus = "live";
  }

  // 4. DELEGATE TO SERVICE
  try {
    const newMatch = await MatchService.createMatch({
      pairAName: data.pairAName,
      pairBName: data.pairBName,
      pairAPlayer1Id: data.pairAPlayer1Id,
      pairAPlayer2Id: data.pairAPlayer2Id,
      pairBPlayer1Id: data.pairBPlayer1Id,
      pairBPlayer2Id: data.pairBPlayer2Id,
      hasGoldPoint: data.hasGoldPoint,
      startTime: new Date(data.startTime),
      endTime: data.endTime ? new Date(data.endTime) : null,
      status: calculatedStatus,
      courtId: data.courtId,
    });

    return c.json({ data: newMatch }, 201);
  } catch (error: any) {
    // Service throws "already occupied" when court has an active match
    if (error.message?.includes("already occupied")) {
      return c.json(
        { error: "Court is already occupied", details: error.message },
        409,
      );
    }
    if (error.message?.includes("not found")) {
      return c.json({ error: error.message }, 404);
    }
    console.error(`[ERR]   :: CREATE_MATCH_ERR :: ${error}`);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// =============================================================================
// █ ENDPOINT: POST /:id/point
// DESC: Procesa un punto marcado en el partido.
//       Delega a processPointScored (Controller).
// =============================================================================
matchesApp.post("/:id/point", async (c) => {
  // 1. VALIDATE PARAMS
  const paramsResult = matchIdParamSchema.safeParse(c.req.param());
  if (!paramsResult.success) {
    return c.json({ error: "Invalid Match ID" }, 400);
  }
  const matchId = paramsResult.data.id;

  // 2. VALIDATE BODY
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const result = pointActionSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: "Invalid Action Data", details: result.error }, 400);
  }

  // 3. DELEGATE TO CONTROLLER
  try {
    await processPointScored({
      matchId: matchId.toString(),
      playerId: result.data.playerId.toString(),
      actionType: result.data.actionType,
      stroke: result.data.stroke,
      isNetPoint: result.data.isNetPoint,
    });
    return c.json({ success: true, message: "Point processed" });
  } catch (error: any) {
    console.error(`[ERR] :: POINT_PROCESS :: ${error.message}`);
    if (error.message.includes("not found")) {
      return c.json({ error: error.message }, 404);
    }
    if (error.message.includes("finished")) {
      return c.json({ error: "Match is finished" }, 400);
    }
    return c.json({ error: error.message || "Internal Error" }, 500);
  }
});
