/**
 * █ [SERVICE] :: MATCH_SERVICE
 * =====================================================================
 * DESC:   Capa de servicio que centraliza toda la lógica de negocio
 *         para partidos. Orquesta DB, Engine y Broadcasting.
 *
 *         Responsabilidades:
 *         - Crear partidos (validar pista, insertar match + stats)
 *         - Procesar puntos (engine → DB → broadcast)
 *         - Gestionar estado de pistas (busy/free)
 *         - Añadir comentarios (DB → broadcast)
 *
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
  courts,
} from "../db/schema.ts";
import { PadelEngine } from "../utils/padelScoring.ts";
import { eq, sql } from "drizzle-orm";
import type {
  MatchSnapshot,
  PointMethod,
  PadelStroke,
  PointOutcome,
} from "../types/padel.types.ts";
import { broadcastToAll, broadcastCourtUpdate } from "../ws/utils.ts";

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
 * courtId es obligatorio: toda partida se juega en una pista.
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
  courtId: number;
}

// =============================================================================
// █ HELPERS (MODULE-PRIVATE)
// =============================================================================

/**
 * Construye un MatchSnapshot a partir de una fila de la tabla `matches`.
 * Centraliza el mapeo para evitar duplicación entre getSnapshot / addPoint.
 */
function toSnapshot(row: typeof matches.$inferSelect): MatchSnapshot {
  return {
    id: row.id,
    pairAName: row.pairAName || "Unknown",
    pairBName: row.pairBName || "Unknown",
    pairAScore: row.pairAScore || "0",
    pairBScore: row.pairBScore || "0",
    pairAGames: row.pairAGames || 0,
    pairBGames: row.pairBGames || 0,
    pairASets: row.pairASets || 0,
    pairBSets: row.pairBSets || 0,
    currentSetIdx: row.currentSetIdx || 1,
    isTieBreak: row.isTieBreak || false,
    hasGoldPoint: row.hasGoldPoint || false,
    winnerSide: row.winnerSide as "pair_a" | "pair_b" | null,
    servingPlayerId: row.servingPlayerId,
    status: row.status,
  };
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

    return toSnapshot(matchData);
  },

  // ===========================================================================
  // █ WRITE OPERATIONS
  // ===========================================================================

  /**
   * ◼️ FUNCTION: ADD_POINT
   * ---------------------------------------------------------
   * [CORE] -> Procesa un punto y orquesta todo el ciclo:
   *   1. Fetch estado actual del partido
   *   2. Calcular siguiente estado (PadelEngine — puro, sin IO)
   *   3. Transacción atómica (point_history + stats + sets + match update)
   *   4. Liberar pista si el partido ha terminado
   *   5. Broadcast a clientes (MATCH_UPDATE + COURT_UPDATE si aplica)
   */
  async addPoint(payload: AddPointPayload): Promise<PointOutcome> {
    const { matchId, playerId, actionType, stroke, isNetPoint } = payload;
    const matchIdInt = parseInt(matchId);
    const playerIdInt = parseInt(playerId);

    if (Number.isNaN(matchIdInt) || Number.isNaN(playerIdInt)) {
      throw new Error(`Invalid matchId or playerId: ${matchId}, ${playerId}`);
    }

    // ── 1. FETCH MATCH ────────────────────────────────────────────────────
    const [matchData] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, matchIdInt));

    if (!matchData) throw new Error(`Match ${matchId} not found`);

    // Si el partido ya terminó, devolver snapshot actual sin procesar
    if (matchData.status === "finished") {
      console.warn(`[LOGIC] :: IGNORED :: Match ${matchId} is finished`);
      return {
        nextSnapshot: toSnapshot(matchData),
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

    // ── 2. DETERMINE SIDES ────────────────────────────────────────────────
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

    // Acciones positivas suman al jugador; negativas suman al contrario
    const isPositiveAction = ["winner", "service_ace"].includes(actionType);
    const scorerSide = isPositiveAction
      ? playerSide
      : playerSide === "pair_a"
        ? "pair_b"
        : "pair_a";

    // ── 3. ENGINE (Pure, sin IO) ──────────────────────────────────────────
    const currentSnapshot = toSnapshot(matchData);
    const outcome = PadelEngine.processPoint(
      currentSnapshot,
      scorerSide,
      actionType,
      stroke,
      isNetPoint,
    );
    const { nextSnapshot, history, setCompleted } = outcome;

    // ── 4. TRANSACTION (Atómica) ──────────────────────────────────────────
    await db.transaction(async (tx) => {
      // A. Historial de puntos
      await tx.insert(pointHistory).values({
        matchId: matchIdInt,
        ...history,
        winnerPlayerId: isPositiveAction ? playerIdInt : null,
      });

      // B. Estadísticas del jugador
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

      // C. Finalización de set
      let finalStatus = nextSnapshot.status;
      let finalWinner = nextSnapshot.winnerSide;

      if (setCompleted) {
        const setWinner =
          setCompleted.pairAGames > setCompleted.pairBGames
            ? "pair_a"
            : "pair_b";

        if (setWinner === "pair_a") nextSnapshot.pairASets++;
        else nextSnapshot.pairBSets++;

        // Victoria por 2 sets (2-0 o 2-1)
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

        await tx.insert(matchSets).values({
          matchId: matchIdInt,
          ...setCompleted,
        });
      }

      // D. Actualizar match (scheduled → live en primer punto)
      if (matchData.status === "scheduled" && finalStatus !== "finished") {
        finalStatus = "live";
      }

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

      // E. Liberar pista si el partido ha terminado
      if (finalStatus === "finished") {
        await tx
          .update(courts)
          .set({ activeMatchId: null })
          .where(eq(courts.id, matchData.courtId));
      }
    });

    // ── 5. BROADCASTS (fuera de la transacción) ───────────────────────────

    // 5a. Notificar pista libre si el partido terminó
    if (nextSnapshot.status === "finished") {
      try {
        await broadcastCourtUpdate(matchData.courtId, "free", null, null);
      } catch (e) {
        console.error(`[ERR]   :: COURT_FREE_BCAST_FAIL`, e);
      }
    }

    // 5b. Notificar actualización de marcador a suscriptores
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
   * Guarda un comentario y lo difunde a los suscriptores del partido.
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
   * Crea un partido con estadísticas iniciales para 4 jugadores.
   *
   * Flujo:
   *   1. Verificar que la pista existe y está libre
   *   2. Transacción: insert match + set court busy + init stats
   *   3. Broadcast COURT_UPDATE (busy) a todos los clientes
   *
   * @throws Error "Court X not found" si la pista no existe
   * @throws Error "Court X is already occupied" si tiene un match activo
   * @throws Error "Match requires 4 distinct players" si hay IDs duplicados
   */
  async createMatch(
    data: CreateMatchInput,
  ): Promise<{ id: number; [key: string]: unknown }> {
    // ── 1. VALIDAR DISPONIBILIDAD DE PISTA ──────────────────────────────
    const [existingCourt] = await db
      .select()
      .from(courts)
      .where(eq(courts.id, data.courtId));

    if (!existingCourt) {
      throw new Error(`Court ${data.courtId} not found`);
    }

    if (existingCourt.activeMatchId) {
      throw new Error(
        `Court ${data.courtId} is already occupied by match ${existingCourt.activeMatchId}`,
      );
    }

    // ── 2. TRANSACCIÓN: MATCH + COURT + STATS ───────────────────────────
    const newMatch = await db.transaction(async (tx) => {
      // A. Insertar partido
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
          courtId: data.courtId,
        })
        .returning();

      if (!match) throw new Error("Match insert failed");

      // B. Marcar pista como ocupada
      await tx
        .update(courts)
        .set({ activeMatchId: match.id })
        .where(eq(courts.id, data.courtId));

      // C. Inicializar stats (4 jugadores únicos obligatorios)
      const allPlayerIds = [
        data.pairAPlayer1Id,
        data.pairAPlayer2Id,
        data.pairBPlayer1Id,
        data.pairBPlayer2Id,
      ].filter((id): id is number => id != null);

      const uniquePlayerIds = [...new Set(allPlayerIds)];

      if (uniquePlayerIds.length !== 4) {
        throw new Error("Match requires 4 distinct players");
      }

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

      return match;
    });

    console.log(`[DB]    ++ SAVED         :: id: ${newMatch.id}`);

    // ── 3. BROADCAST COURT_UPDATE (BUSY) ────────────────────────────────
    try {
      await broadcastCourtUpdate(
        data.courtId,
        "busy",
        newMatch.id,
        newMatch.startTime,
      );
    } catch (e) {
      console.error(`[ERR]   :: COURT_BCAST_FAIL`, e);
    }

    return newMatch;
  },
};
