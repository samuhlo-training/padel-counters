/**
 * █ [SERVICE] :: MATCH_SERVICE
 * =====================================================================
 * DESC:   Capa de servicio que centraliza toda la lógica de negocio
 *         para partidos. Orquesta DB, Engine y Broadcasting.
 * STATUS: STABLE
 * =====================================================================
 */
import { db } from "../db/db.ts";
import {
  matches,
  matchStats,
  pointHistory,
  matchSets,
  commentary,
} from "../db/schema.ts";
import { PadelEngine } from "../utils/padelScoring.ts";
import { eq, and, sql, desc } from "drizzle-orm";
import type {
  MatchSnapshot,
  PointMethod,
  PadelStroke,
  PointOutcome,
} from "../types/padel.types.ts";
import { broadcastToAll, broadcastMatchCreated } from "../ws/utils.ts";

// =============================================================================
// █ TYPES: SERVICE INPUTS
// =============================================================================

/**
 * [DTO] -> Payload para registrar un punto.
 */
export interface AddPointPayload {
  matchId: string;
  playerId: string;
  actionType: PointMethod;
  stroke?: PadelStroke;
  isNetPoint?: boolean;
}

/**
 * [DTO] -> Payload para crear un partido.
 */
export interface CreateMatchInput {
  pairAName?: string;
  pairBName?: string;
  pairAPlayer1Id: number;
  pairAPlayer2Id: number;
  pairBPlayer1Id: number;
  pairBPlayer2Id: number;
  hasGoldPoint?: boolean;
  startTime: Date;
  endTime?: Date | null;
  status: "scheduled" | "live" | "finished";
}

// =============================================================================
// █ SERVICE: MATCH_SERVICE
// =============================================================================

export const MatchService = {
  // ===========================================================================
  // █ READ OPERATIONS
  // ===========================================================================

  /**
   * ◼️ FUNCTION: GET_SNAPSHOT
   * ---------------------------------------------------------
   * Recupera el estado completo de un partido por ID.
   */
  async getSnapshot(matchId: number): Promise<MatchSnapshot> {
    const [matchData] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId));

    if (!matchData) {
      throw new Error(`Match ${matchId} not found`);
    }

    return {
      id: matchData.id,
      pairAName: matchData.pairAName || "Unknown",
      pairBName: matchData.pairBName || "Unknown",
      pairAScore: matchData.pairAScore || "0",
      pairBScore: matchData.pairBScore || "0",
      pairAGames: matchData.pairAGames || 0,
      pairBGames: matchData.pairBGames || 0,
      pairASets: matchData.pairASets || 0,
      pairBSets: matchData.pairBSets || 0,
      currentSetIdx: matchData.currentSetIdx || 1,
      isTieBreak: matchData.isTieBreak || false,
      hasGoldPoint: matchData.hasGoldPoint || false,
      winnerSide: matchData.winnerSide as "pair_a" | "pair_b" | null,
      servingPlayerId: matchData.servingPlayerId,
      status: matchData.status,
    };
  },

  // ===========================================================================
  // █ WRITE OPERATIONS
  // ===========================================================================

  /**
   * ◼️ FUNCTION: ADD_POINT
   * ---------------------------------------------------------
   * [CORE] -> Procesa un punto y orquesta todo el ciclo:
   * 1. Fetch estado actual
   * 2. Calcular siguiente estado (PadelEngine)
   * 3. Transacción atómica (DB)
   * 4. Broadcast a clientes (WS)
   */
  async addPoint(payload: AddPointPayload): Promise<PointOutcome> {
    const { matchId, playerId, actionType, stroke, isNetPoint } = payload;
    const matchIdInt = parseInt(matchId);
    const playerIdInt = parseInt(playerId);

    // 1. FETCH MATCH
    const [matchData] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, matchIdInt));

    if (!matchData) throw new Error(`Match ${matchId} not found`);

    if (matchData.status === "finished") {
      console.warn(`[LOGIC] :: IGNORED :: Match ${matchId} is finished`);
      // Return a dummy outcome that represents no change
      const dummySnapshot: MatchSnapshot = {
        id: matchData.id,
        pairAName: matchData.pairAName || "Unknown",
        pairBName: matchData.pairBName || "Unknown",
        pairAScore: matchData.pairAScore || "0",
        pairBScore: matchData.pairBScore || "0",
        pairAGames: matchData.pairAGames || 0,
        pairBGames: matchData.pairBGames || 0,
        pairASets: matchData.pairASets || 0,
        pairBSets: matchData.pairBSets || 0,
        currentSetIdx: matchData.currentSetIdx || 1,
        isTieBreak: matchData.isTieBreak || false,
        hasGoldPoint: matchData.hasGoldPoint || false,
        winnerSide: matchData.winnerSide as "pair_a" | "pair_b" | null,
        servingPlayerId: matchData.servingPlayerId,
        status: matchData.status,
      };
      return {
        nextSnapshot: dummySnapshot,
        history: {
          setNumber: 0,
          gameNumber: 0,
          pointNumber: 0,
          winnerSide: "pair_a",
          method: actionType,
          scoreAfterPairA: "0",
          scoreAfterPairB: "0",
          isGamePoint: false,
          isSetPoint: false,
          isMatchPoint: false,
        },
        setCompleted: undefined,
      };
    }

    // 2. DETERMINE SIDES
    let playerSide: "pair_a" | "pair_b";
    if (
      playerIdInt === matchData.pairAPlayer1Id ||
      playerIdInt === matchData.pairAPlayer2Id
    ) {
      playerSide = "pair_a";
    } else if (
      playerIdInt === matchData.pairBPlayer1Id ||
      playerIdInt === matchData.pairBPlayer2Id
    ) {
      playerSide = "pair_b";
    } else {
      throw new Error(`Player ${playerId} not in match ${matchId}`);
    }

    const isPositiveAction = ["winner", "service_ace"].includes(actionType);
    const scorerSide = isPositiveAction
      ? playerSide
      : playerSide === "pair_a"
        ? "pair_b"
        : "pair_a";

    // 3. ENGINE PROCESS (Pure)
    const currentSnapshot: MatchSnapshot = {
      id: matchData.id,
      pairAName: matchData.pairAName || "Unknown",
      pairBName: matchData.pairBName || "Unknown",
      pairAScore: matchData.pairAScore || "0",
      pairBScore: matchData.pairBScore || "0",
      pairAGames: matchData.pairAGames || 0,
      pairBGames: matchData.pairBGames || 0,
      pairASets: matchData.pairASets || 0,
      pairBSets: matchData.pairBSets || 0,
      currentSetIdx: matchData.currentSetIdx || 1,
      isTieBreak: matchData.isTieBreak || false,
      hasGoldPoint: matchData.hasGoldPoint || false,
      winnerSide: matchData.winnerSide as "pair_a" | "pair_b" | null,
      servingPlayerId: matchData.servingPlayerId,
      status: matchData.status,
    };

    const outcome = PadelEngine.processPoint(
      currentSnapshot,
      scorerSide,
      actionType,
      stroke,
      isNetPoint,
    );
    const { nextSnapshot, history, setCompleted } = outcome;

    // 4. TRANSACTION
    await db.transaction(async (tx) => {
      // A. Point History
      await tx.insert(pointHistory).values({
        matchId: matchIdInt,
        ...history,
        winnerPlayerId: isPositiveAction ? playerIdInt : null,
      });

      // B. Player Stats
      if (isPositiveAction) {
        await tx.execute(sql`
          UPDATE match_stats SET 
            points_won = points_won + 1,
            winners = winners + 1,
            smash_winners = ${stroke === "smash" ? sql`smash_winners + 1` : sql`smash_winners`}
          WHERE match_id = ${matchIdInt} AND player_id = ${playerIdInt}
        `);
      } else {
        await tx.execute(sql`
          UPDATE match_stats SET unforced_errors = unforced_errors + 1
          WHERE match_id = ${matchIdInt} AND player_id = ${playerIdInt}
        `);
      }

      // C. Set Completion
      let finalStatus = nextSnapshot.status;
      let finalWinner = nextSnapshot.winnerSide;

      if (setCompleted) {
        // Increment sets count FIRST
        const setWinner =
          setCompleted.pairAGames > setCompleted.pairBGames
            ? "pair_a"
            : "pair_b";

        if (setWinner === "pair_a") nextSnapshot.pairASets++;
        else nextSnapshot.pairBSets++;

        // Check for 2-set victory (2-0)
        if (nextSnapshot.pairASets >= 2) {
          finalWinner = "pair_a";
          finalStatus = "finished";
          nextSnapshot.status = "finished";
          nextSnapshot.winnerSide = "pair_a";
        } else if (nextSnapshot.pairBSets >= 2) {
          finalWinner = "pair_b";
          finalStatus = "finished";
          nextSnapshot.status = "finished";
          nextSnapshot.winnerSide = "pair_b";
        }

        // THEN save set record to DB
        await tx.insert(matchSets).values({
          matchId: matchIdInt,
          ...setCompleted,
        });
      }

      // D. Update Match
      if (matchData.status === "scheduled") finalStatus = "live";

      await tx
        .update(matches)
        .set({
          pairAScore: nextSnapshot.pairAScore,
          pairBScore: nextSnapshot.pairBScore,
          pairAGames: nextSnapshot.pairAGames,
          pairBGames: nextSnapshot.pairBGames,
          pairASets: nextSnapshot.pairASets,
          pairBSets: nextSnapshot.pairBSets,
          currentSetIdx: nextSnapshot.currentSetIdx,
          isTieBreak: nextSnapshot.isTieBreak,
          winnerSide: finalWinner,
          status: finalStatus as
            | "scheduled"
            | "warmup"
            | "live"
            | "finished"
            | "canceled",
        })
        .where(eq(matches.id, matchIdInt));

      nextSnapshot.status = finalStatus;
      nextSnapshot.winnerSide = finalWinner;
    });

    // 5. BROADCAST
    await broadcastToAll(matchId, {
      type: "MATCH_UPDATE",
      matchId,
      timestamp: Date.now(),
      snapshot: nextSnapshot,
      lastPoint: history,
    });

    console.log(
      `[GAME]  :: POINT :: ${matchId} | ${actionType} by ${playerId} | State: ${nextSnapshot.pairAGames}-${nextSnapshot.pairBGames} (${nextSnapshot.pairAScore}-${nextSnapshot.pairBScore})`,
    );

    return outcome;
  },

  /**
   * ◼️ FUNCTION: ADD_COMMENTARY
   * ---------------------------------------------------------
   * Guarda un comentario y lo difunde a los suscriptores.
   */
  async addCommentary(
    matchId: number,
    message: string,
    options?: { setNumber?: number; gameNumber?: number; tags?: string[] },
  ): Promise<{ id: number }> {
    const [savedComment] = await db
      .insert(commentary)
      .values({
        matchId,
        message,
        setNumber: options?.setNumber,
        gameNumber: options?.gameNumber,
        tags: options?.tags,
      })
      .returning();

    if (!savedComment) throw new Error("Failed to insert commentary");

    await broadcastToAll(String(matchId), {
      type: "COMMENTARY",
      data: savedComment,
    });

    return { id: savedComment.id };
  },

  /**
   * ◼️ FUNCTION: CREATE_MATCH
   * ---------------------------------------------------------
   * Crea un partido con estadísticas iniciales para jugadores.
   */
  async createMatch(
    data: CreateMatchInput,
  ): Promise<{ id: number; [key: string]: unknown }> {
    const newMatch = await db.transaction(async (tx) => {
      const [match] = await tx
        .insert(matches)
        .values({
          pairAName: data.pairAName ?? "Pair A",
          pairBName: data.pairBName ?? "Pair B",
          pairAPlayer1Id: data.pairAPlayer1Id,
          pairAPlayer2Id: data.pairAPlayer2Id,
          pairBPlayer1Id: data.pairBPlayer1Id,
          pairBPlayer2Id: data.pairBPlayer2Id,
          servingPlayerId: data.pairAPlayer1Id,
          hasGoldPoint: data.hasGoldPoint,
          startTime: data.startTime,
          endTime: data.endTime,
          status: data.status,
          currentSetIdx: 1,
          pairAGames: 0,
          pairBGames: 0,
          pairAScore: "0",
          pairBScore: "0",
          isTieBreak: false,
        })
        .returning();

      if (!match) throw new Error("Match insert failed");

      // Init stats (deduplicated)
      const allPlayerIds = [
        data.pairAPlayer1Id,
        data.pairAPlayer2Id,
        data.pairBPlayer1Id,
        data.pairBPlayer2Id,
      ].filter((id): id is number => id != null);

      const uniquePlayerIds = [...new Set(allPlayerIds)];

      if (uniquePlayerIds.length > 0) {
        await tx.insert(matchStats).values(
          uniquePlayerIds.map((playerId) => ({
            matchId: match.id,
            playerId,
            pointsWon: 0,
            winners: 0,
            unforcedErrors: 0,
            smashWinners: 0,
          })),
        );
      }

      return match;
    });

    console.log(`[DB]    ++ SAVED         :: id: ${newMatch.id}`);

    try {
      await broadcastMatchCreated(newMatch);
    } catch (e) {
      console.error(`[ERR]   :: BCAST_FAIL    :: match: ${newMatch.id}`, e);
    }

    return newMatch;
  },
};
