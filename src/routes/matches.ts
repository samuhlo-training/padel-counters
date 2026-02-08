/**
 * █ [API_ROUTE] :: MATCHES_HANDLER (HONO EDITION)
 * =====================================================================
 * DESC:   Gestiona operaciones CRUD para partidos.
 *         Refactorizado para Padel Pro (Gold Master Schema).
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
import { matches, matchStats } from "../db/schema.ts";
import { getMatchStatus } from "../utils/match-status.ts";
import { desc } from "drizzle-orm";
import { broadcastMatchCreated } from "../ws/server.ts"; // RESTORED
import { pointActionSchema } from "../validation/point_action.ts";
import { processPointScored } from "../controllers/match.ts";

export const matchesApp = new Hono();

const MAX_LIMIT = 100;

// =============================================================================
// █ ENDPOINT: GET /
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
// =============================================================================
matchesApp.post("/", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const result = createMatchSchema.safeParse(body);

  if (!result.success) {
    console.log(
      `[API]   :: INVALID_BODY  :: ${JSON.stringify(result.error).slice(0, 100)}...`,
    );
    return c.json({ error: "Validation failed", details: result.error }, 400);
  }

  const data = result.data;

  // Estado inicial
  let calculatedStatus = "scheduled";
  if (data.endTime) {
    const status = getMatchStatus(data.startTime, data.endTime);
    if (status) calculatedStatus = status;
  } else {
    if (new Date(data.startTime) <= new Date()) {
      calculatedStatus = "live";
    }
  }

  try {
    const newMatch = await db.transaction(async (tx) => {
      // A. Insert Match (Relational Structure)
      const [match] = await tx
        .insert(matches)
        .values({
          pairAName: data.pairAName ?? "Pair A",
          pairBName: data.pairBName ?? "Pair B",
          pairAPlayer1Id: data.pairAPlayer1Id,
          pairAPlayer2Id: data.pairAPlayer2Id,
          pairBPlayer1Id: data.pairBPlayer1Id,
          pairBPlayer2Id: data.pairBPlayer2Id,
          servingPlayerId: data.pairAPlayer1Id, // Initial server
          hasGoldPoint: data.hasGoldPoint, // Modo de juego (Punto de Oro vs Clásico)

          startTime: new Date(data.startTime),
          endTime: data.endTime ? new Date(data.endTime) : null,
          status: calculatedStatus as "scheduled" | "live" | "finished",

          // Initial Score Snapshot
          currentSetIdx: 1,
          pairAGames: 0,
          pairBGames: 0,
          pairAScore: "0",
          pairBScore: "0",
          isTieBreak: false,
        })
        .returning();

      if (!match) throw new Error("Match insert failed");

      // B. Init Stats for 4 players (deduplicated to avoid constraint violations)
      const baseStats = {
        matchId: match.id,
        pointsWon: 0,
        winners: 0,
        unforcedErrors: 0,
        smashWinners: 0, // NEW field
      };

      // Collect all player IDs, filter falsy, and deduplicate
      const allPlayerIds = [
        data.pairAPlayer1Id,
        data.pairAPlayer2Id,
        data.pairBPlayer1Id,
        data.pairBPlayer2Id,
      ].filter((id): id is number => id != null);

      const uniquePlayerIds = [...new Set(allPlayerIds)];

      // Map each unique ID to a stats object
      const uniqueStatsArray = uniquePlayerIds.map((playerId) => ({
        ...baseStats,
        playerId,
      }));

      // E. Init Stats (only if we have players)
      if (uniqueStatsArray.length > 0) {
        await tx.insert(matchStats).values(uniqueStatsArray);
      } else {
        console.warn(
          `[DB]    :: SKIP_STATS    :: No unique players to initialize for match ${match.id}`,
        );
      }

      return match;
    });

    console.log(`[DB]    ++ SAVED         :: id: ${newMatch.id}`);

    // Broadcast logic needs update to support MatchSnapshot type if strict
    // But broadcastMatchCreated likely just sends the object.
    try {
      broadcastMatchCreated(newMatch);
    } catch (e) {
      console.error(`[ERR]   :: BCAST_FAIL    :: match: ${newMatch.id}`, e);
    }

    return c.json({ data: newMatch }, 201);
  } catch (error) {
    console.error(`[ERR]   :: CREATE_MATCH_ERR :: ${error}`);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * ◼️ ENDPOINT: POST /:id/point
 * ---------------------------------------------------------
 * DESC: Procesa un punto marcado en el partido.
 */
matchesApp.post("/:id/point", async (c) => {
  // 1. VALIDATION: PARAMS
  const paramsResult = matchIdParamSchema.safeParse(c.req.param());
  if (!paramsResult.success) {
    return c.json({ error: "Invalid Match ID" }, 400);
  }
  const matchId = paramsResult.data.id;

  // 2. VALIDATION: BODY
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

  // 3. CONTROLLER LOGIC
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
