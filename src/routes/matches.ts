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
import { matches, courts, matchSets, pointHistory } from "../db/schema.ts";
import { getMatchStatus } from "../utils/match-status.ts";
import { desc, asc, eq, inArray } from "drizzle-orm";
import { pointActionSchema } from "../validation/point_action.ts";
import { processPointScored } from "../controllers/match.ts";
import { MatchService } from "../services/matchService.ts";

export const matchesApp = new Hono();

const MAX_LIMIT = 100;

// =============================================================================
// █ ENDPOINT: GET /
// DESC: Lista partidos con filtros, ordenación y paginación.
// =============================================================================
matchesApp.get("/", async (c) => {
  const parsed = listMatchesQuerySchema.safeParse(c.req.query());

  if (!parsed.success) {
    return c.json(
      { error: "Invalid query params", details: parsed.error },
      400,
    );
  }

  const { sortBy, sortDir, status } = parsed.data;
  const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);
  const offset = parsed.data.offset ?? 0;

  try {
    // Build query con filtros opcionales
    let query = db
      .select({
        id: matches.id,
        matchType: matches.matchType,
        pairAName: matches.pairAName,
        pairBName: matches.pairBName,
        pairAScore: matches.pairAScore,
        pairBScore: matches.pairBScore,
        pairAGames: matches.pairAGames,
        pairBGames: matches.pairBGames,
        pairASets: matches.pairASets,
        pairBSets: matches.pairBSets,
        startTime: matches.startTime,
        endTime: matches.endTime,
        status: matches.status,
        winnerSide: matches.winnerSide,
        courtId: matches.courtId,
        courtName: courts.name,
        createdAt: matches.createdAt,
      })
      .from(matches)
      .leftJoin(courts, eq(matches.courtId, courts.id))
      .$dynamic();

    // Filtro por status
    if (status) {
      query = query.where(eq(matches.status, status));
    }

    // Ordenación
    const sortColumn =
      sortBy === "startTime" ? matches.startTime : matches.createdAt;
    const sortFn = sortDir === "asc" ? asc : desc;
    query = query.orderBy(sortFn(sortColumn));

    // Paginación
    query = query.limit(limit).offset(offset);

    const data = await query;

    // Fetch sets for all matches to build score string
    const matchIds = data.map((m) => m.id);
    let setsMap: Record<number, any[]> = {};

    if (matchIds.length > 0) {
      const sets = await db
        .select()
        .from(matchSets)
        .where(inArray(matchSets.matchId, matchIds))
        .orderBy(asc(matchSets.setNumber));

      setsMap = sets.reduce(
        (acc, set) => {
          if (!acc[set.matchId]) acc[set.matchId] = [];
          acc[set.matchId]!.push(set);
          return acc;
        },
        {} as Record<number, any[]>,
      );
    }

    const enrichedData = data.map((m) => {
      const sets = setsMap[m.id] || [];
      // Build score string "6-4 3-6 6-2"
      const score = sets
        .map((s: any) => `${s.pairAGames}-${s.pairBGames}`)
        .join(" ");

      // Calculate duration
      let durationStr = "N/A";
      if (m.startTime && m.endTime) {
        const start = new Date(m.startTime);
        const end = new Date(m.endTime);
        const diffMs = end.getTime() - start.getTime();
        const diffMins = Math.round(diffMs / 60000);
        durationStr = `${diffMins}m`;
      }

      // Format date and time
      const dateObj = m.startTime
        ? new Date(m.startTime)
        : new Date(m.createdAt);
      const dateStr = dateObj.toISOString().split("T")[0];
      const timeStr = dateObj.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });

      return {
        id: m.id,
        type: m.matchType || "PARTIDO AMISTOSO",
        date: dateStr,
        time: timeStr,
        duration: durationStr,
        court: m.courtName || "Unknown Court",
        winner_side: m.winnerSide,
        score,
        status: m.status,
        team_a: {
          name: m.pairAName,
          sets_won: m.pairASets,
        },
        team_b: {
          name: m.pairBName,
          sets_won: m.pairBSets,
        },
      };
    });

    return c.json({
      data: enrichedData,
      meta: { limit, offset, count: data.length },
    });
  } catch (error) {
    console.error(`[ERR]   :: DB_QUERY_ERR  :: ${error}`);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// =============================================================================
// █ ENDPOINT: GET /:id
// DESC: Devuelve un partido completo con snapshot enriquecido (player names,
//       sets, court, timing). Usa MatchService.getSnapshot para consistencia.
// =============================================================================
matchesApp.get("/:id", async (c) => {
  const paramsResult = matchIdParamSchema.safeParse(c.req.param());
  if (!paramsResult.success) {
    return c.json({ error: "Invalid Match ID" }, 400);
  }

  try {
    const s = await MatchService.getSnapshot(paramsResult.data.id);

    // Calculate duration
    let durationStr = "N/A";
    if (s.startTime && s.endTime) {
      const start = new Date(s.startTime);
      const end = new Date(s.endTime);
      const diffMs = end.getTime() - start.getTime();
      const diffMins = Math.round(diffMs / 60000);
      durationStr = `${diffMins}'`;
    }

    const dateObj = s.startTime ? new Date(s.startTime) : new Date();
    const dateStr = dateObj.toISOString().split("T")[0];
    const timeStartStr = dateObj.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const timeEndStr = s.endTime
      ? new Date(s.endTime).toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "N/A";

    // Transform sets for simpler consumption
    const sets = s.sets.map((set) => ({
      set: set.setNumber,
      a: set.pairAGames,
      b: set.pairBGames,
    }));

    // 1. Fetch Point History
    const history = await db
      .select()
      .from(pointHistory)
      .where(eq(pointHistory.matchId, s.id))
      .orderBy(asc(pointHistory.createdAt));

    // 2. Transform History for Response
    const pointHistoryData = history.map((h) => ({
      id: h.id,
      set: h.setNumber,
      game: h.gameNumber,
      score: `${h.scoreAfterPairA}-${h.scoreAfterPairB}`,
      winnerId: h.winnerPlayerId,
      type:
        h.method === "winner" || h.method === "service_ace"
          ? "winner"
          : "error",
      stroke: h.stroke,
      timestamp:
        h.createdAt.toISOString().split("T")[1]?.split(".")[0] ?? "00:00:00", // HH:MM:SS
    }));

    // 3. Helper to Calculate Extended Stats (Restored getStats)
    const getStats = (playerId: number) => {
      const stat = s.stats.find((st) => st.playerId === playerId);
      return {
        points: stat?.pointsWon || 0,
        winners: stat?.winners || 0,
        errors: stat?.unforcedErrors || 0,
        smashWinners: stat?.smashWinners || 0,
      };
    };

    const getExtendedStats = (playerId: number) => {
      // Base stats from match snapshot (already calculated by service)
      const baseStat = s.stats.find((st) => st.playerId === playerId);

      // Extended stats from point history
      const playerPoints = history.filter((h) => h.winnerPlayerId === playerId);
      const playerErrors = history.filter(
        (h) =>
          h.winnerPlayerId !== playerId &&
          h.winnerPlayerId !== null &&
          (h.method === "unforced_error" || h.method === "forced_error"),
      );
      // Note: Logic for errors is tricky from point history because we record WHO WON the point, not necessarily who made the error.
      // However, if I won a point by 'unforced_error', it means the opponent made the error.
      // So to get MY errors, I need to find points where OPPONENT won by 'unforced_error' or 'forced_error'.
      // BUT current schema 'winnerPlayerId' is the point winner.
      // Let's rely on 'method' and 'winnerSide' to deduce.
      // Actually, 'point_history' doesn't explicitly store the error committer ID easily unless we infer from teams.
      // Simplification: We will filter where I am NOT the winner, and method is error.
      // Wait, if I am TeamA Player1, and TeamB wins query by 'unforced_error', who made it? Could be P1 or P2 of TeamA.
      // The current 'point_history' schema DOES NOT store `errorPlayerId`.
      // It only stores `winnerPlayerId`.
      // LIMITATION: We cannot accurately assign errors to specific players from 'point_history' alone if strictly following schema without extra logic.
      // HOWEVER, `MatchService` does track individual stats in `match_stats` table during `addPoint`.
      // `match_stats` has `unforcedErrors`.
      // For breakdowns like `netErrors` vs `baselineErrors`, we need to know IF it was me.
      // SINCE we can't perfectly distinguish which partner made the error from history alone (unless 1v1),
      // we might have to approximate or rely on `match_stats` for totals and just use history for winners (which have player_id).

      // Let's focus on WINNERS breakdown which is accurate (winnerPlayerId is set).
      const winners = playerPoints.filter(
        (p) => p.method === "winner" || p.method === "service_ace",
      );

      const smashWinners = winners.filter((p) => p.stroke === "smash").length;
      const volleyWinners = winners.filter(
        (p) => p.stroke === "volley_forehand" || p.stroke === "volley_backhand",
      ).length;
      const forehandWinners = winners.filter(
        (p) => p.stroke === "forehand",
      ).length;
      const backhandWinners = winners.filter(
        (p) => p.stroke === "backhand",
      ).length;

      // For errors, we will fallback to `match_stats` count for total, and maybe 0 for breakdown if we can't determine.
      // Or we can try to use `winnerPlayerId` if we interpret it carefully? No, winner ID is the beneficiary.

      return {
        winners: baseStat?.winners || 0,
        smashWinners: baseStat?.smashWinners || 0, // Service tracks this
        volleyWinners,
        forehandWinners,
        backhandWinners,
        unforcedErrors: baseStat?.unforcedErrors || 0,
        netErrors: 0, // Cannot accurately determine without errorPlayerId
        baselineErrors: 0, // Cannot accurately determine without errorPlayerId
      };
    };

    // MVP Calculation (simple: max points)
    const maxPoints = Math.max(...s.stats.map((st) => st.pointsWon || 0));

    // Build player objects
    const buildPlayer = (id: number, name: string) => {
      const st = getStats(id); // Base stats
      const extended = getExtendedStats(id); // derived stats

      return {
        id,
        name,
        points: st.points,
        errors: st.errors, // Total unforced errors
        isMvp: st.points > 0 && st.points === maxPoints,
        stats: {
          winners: extended.winners,
          smashWinners: extended.smashWinners,
          volleyWinners: extended.volleyWinners,
          forehandWinners: extended.forehandWinners,
          backhandWinners: extended.backhandWinners,
          unforcedErrors: extended.unforcedErrors,
          netErrors: extended.netErrors,
          baselineErrors: extended.baselineErrors,
        },
      };
    };

    const teamA = {
      name: s.pairAName,
      players: [
        buildPlayer(s.pairAPlayer1Id, s.pairAPlayer1Name),
        buildPlayer(s.pairAPlayer2Id, s.pairAPlayer2Name),
      ],
    };

    const teamB = {
      name: s.pairBName,
      players: [
        buildPlayer(s.pairBPlayer1Id, s.pairBPlayer1Name),
        buildPlayer(s.pairBPlayer2Id, s.pairBPlayer2Name),
      ],
    };

    return c.json({
      id: s.id,
      type: s.matchType || "PARTIDO AMISTOSO",
      date: dateStr,
      timeStart: timeStartStr,
      timeEnd: timeEndStr,
      duration: durationStr,
      court: s.courtName || `Court ${s.courtId}`, // Use resolved name
      scoreA: s.pairASets,
      scoreB: s.pairBSets,
      sets,
      teamA,
      teamB,
      pointHistory: pointHistoryData,
    });
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return c.json({ error: error.message }, 404);
    }
    console.error(`[ERR]   :: GET_MATCH_ERR :: ${error}`);
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
