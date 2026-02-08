/**
 * █ [HANDLER] :: STATS_REQUESTS
 * =====================================================================
 * DESC:   Request/Response pattern para estadísticas bajo demanda.
 * STATUS: STABLE
 * =====================================================================
 */
import type { ServerWebSocket } from "bun";
import type { WebSocketData, ClientMessage } from "../../types/index.ts";
import { db } from "../../db/db.ts";
import { matches, matchStats } from "../../db/schema.ts";
import { eq, and } from "drizzle-orm";
import { sendJson } from "../utils.ts";

// =============================================================================
// █ HANDLER: STATS REQUEST
// =============================================================================

/**
 * ◼️ FUNCTION: PROCESS_STATS_REQUEST
 * ---------------------------------------------------------
 * Maneja peticiones bajo demanda (Request/Response pattern over WS).
 * Consulta la DB y responde solo al socket solicitante.
 */
export async function processStatsRequest(
  socket: ServerWebSocket<WebSocketData>,
  payload: ClientMessage & { type: "REQUEST_STATS" },
): Promise<void> {
  const { matchId, subtype, playerId } = payload;
  const matchIdInt = parseInt(matchId);
  if (Number.isNaN(matchIdInt)) {
    throw new Error("Invalid matchId");
  }

  try {
    if (subtype === "PLAYER") {
      if (!playerId) throw new Error("Missing playerId for PLAYER stats");
      const playerIdInt = parseInt(playerId);
      if (Number.isNaN(playerIdInt)) {
        throw new Error("Invalid playerId");
      }

      const [stats] = await db
        .select()
        .from(matchStats)
        .where(
          and(
            eq(matchStats.matchId, matchIdInt),
            eq(matchStats.playerId, playerIdInt),
          ),
        );

      sendJson(socket, {
        type: "STATS_RESPONSE",
        subtype: "PLAYER",
        matchId,
        data: stats || {
          pointsWon: 0,
          winners: 0,
          unforcedErrors: 0,
          smashWinners: 0,
        },
      });
    } else if (subtype === "MATCH_SUMMARY") {
      const [matchData] = await db
        .select()
        .from(matches)
        .where(eq(matches.id, matchIdInt));

      if (!matchData) throw new Error("Match not found");

      // Calcular duración aproximada
      let durationSeconds = 0;
      if (matchData.startTime) {
        const end = matchData.endTime || new Date();
        durationSeconds = Math.floor(
          (end.getTime() - matchData.startTime.getTime()) / 1000,
        );
      }

      sendJson(socket, {
        type: "STATS_RESPONSE",
        subtype: "MATCH_SUMMARY",
        matchId,
        data: {
          id: matchData.id,
          pairAName: matchData.pairAName,
          pairBName: matchData.pairBName,
          pairAGames: matchData.pairAGames,
          pairBGames: matchData.pairBGames,
          pairASets: matchData.pairASets,
          pairBSets: matchData.pairBSets,
          pairAScore: matchData.pairAScore,
          pairBScore: matchData.pairBScore,
          currentSetIdx: matchData.currentSetIdx,
          isTieBreak: matchData.isTieBreak,
          hasGoldPoint: matchData.hasGoldPoint,
          currentScore: {
            sets: `${matchData.pairAGames}-${matchData.pairBGames} (Set ${matchData.currentSetIdx})`,
            points: `${matchData.pairAScore}-${matchData.pairBScore}`,
          },
          durationSeconds,
          status: matchData.status,
          servingPlayerId: matchData.servingPlayerId,
        },
      });
    } else {
      // ◼️ UNKNOWN SUBTYPE: Notificar al cliente de forma determinista
      sendJson(socket, {
        type: "ERROR",
        payload: `Unknown stats subtype: "${subtype}". Supported subtypes are: PLAYER, MATCH_SUMMARY`,
      });
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[WS]    :: STATS_ERR     ::`, err);
    sendJson(socket, {
      type: "ERROR",
      payload: `Stats Request Failed: ${err.message}`,
    });
  }
}
