/**
 * █ [CONTROLLER] :: MATCH_LOGIC
 * =====================================================================
 * DESC:   Orquestador de la lógica de negocio de los partidos.
 *         Coordina DB, Motor de Puntuación (PadelEngine) y WebSockets.
 * STATUS: STABLE
 * =====================================================================
 */
import { db } from "../db/db.ts";
import { matches, matchStats, pointHistory, matchSets } from "../db/schema.ts";
import { PadelEngine } from "../utils/padelScoring.ts"; // [USE] -> Motor puro
import { eq, and, sql } from "drizzle-orm";
import type {
  MatchSnapshot,
  PointMethod,
  PadelStroke,
} from "../types/padel.types.ts";
import { broadcastToAll } from "../ws/server.ts";

// Mock alias para cumplir con la firma requerida (aunque broadcastToAll es la fn real)
const broadcastToMatch = broadcastToAll;

/**
 * ◼️ FUNCTION: GET_MATCH_SNAPSHOT
 * ---------------------------------------------------------
 * Recupera el estado completo de un partido por ID.
 * Útil para hidratar el cliente al conectarse (Handshake).
 */
export async function getMatchSnapshot(
  matchId: number,
): Promise<MatchSnapshot> {
  const [matchData] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId));

  if (!matchData) {
    throw new Error(`Match ${matchId} not found`);
  }

  // Mapeo DB -> Domain Type
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
}

/**
 * ◼️ FUNCTION: PROCESS_POINT_SCORED
 * ---------------------------------------------------------
 * [CORE] -> Maneja todo el ciclo de vida de un punto:
 * 1. Recupera estado actual de la DB.
 * 2. Invoca al Motor de Reglas (PadelEngine).
 * 3. Ejecuta una Transacción Atómica (ACID) para guardar todo.
 * 4. Difunde el nuevo estado vía WebSocket.
 */
export async function processPointScored(payload: {
  matchId: string;
  playerId: string;
  actionType: PointMethod;
  stroke?: PadelStroke;
  isNetPoint?: boolean;
}) {
  const { matchId, playerId, actionType, stroke, isNetPoint } = payload;
  const matchIdInt = parseInt(matchId);
  const playerIdInt = parseInt(playerId);

  // 1. FETCH MATCH
  const matchResult = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchIdInt));

  const matchData = matchResult[0];
  if (!matchData) throw new Error(`Match ${matchId} not found`);

  // [CHECK] -> Ignorar puntos si el partido ya acabó
  if (matchData.status === "finished") {
    console.warn(`[LOGIC] :: IGNORED :: Match ${matchId} is finished`);
    return;
  }

  // 2. DETERMINE SIDES
  // Averiguamos a qué pareja pertenece el jugador que activó la acción.
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

  // [LOGIC] -> Un "winner" suma a mi lado. Un "Unforced Error" suma al RIVAL.
  // Por tanto, definimos quién es el "scorerSide" (quien recibe el punto).
  const isPositiveAction = ["winner", "service_ace"].includes(actionType);

  const scorerSide = isPositiveAction
    ? playerSide
    : playerSide === "pair_a"
      ? "pair_b" // Si soy A y fallo, punto para B
      : "pair_a";

  // 3. ENGINE PROCESS (Pure Calculation)
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

  // 4. TRANSACTION (Atomic Update)
  // [CRITICAL] -> Todo o nada. Si falla algo, no guardamos estados corruptos.
  await db.transaction(async (tx) => {
    // A. Point History -> Registro de auditoría
    await tx.insert(pointHistory).values({
      matchId: matchIdInt,
      ...history,
      winnerPlayerId: isPositiveAction ? playerIdInt : null, // Solo asignamos mérito directo si fue positivo
    });

    // B. Player Stats -> Actualización incremental
    if (isPositiveAction) {
      // Uso de SQL raw para updates atómicos eficientes
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

    // C. Handle Set Completion & Match Win Check
    let finalStatus = nextSnapshot.status;
    let finalWinner = nextSnapshot.winnerSide;

    if (setCompleted) {
      // Registrar el Set finalizado
      await tx.insert(matchSets).values({
        matchId: matchIdInt,
        ...setCompleted,
      });

      // [INCREMENT] -> Actualizar contador de sets en nextSnapshot
      const setWinner =
        setCompleted.pairAGames > setCompleted.pairBGames ? "pair_a" : "pair_b";

      if (setWinner === "pair_a") {
        nextSnapshot.pairASets++;
      } else {
        nextSnapshot.pairBSets++;
      }

      // CHECK MATCH WIN (Best of 3)
      // Usamos los contadores actualizados del snapshot
      const setsA = nextSnapshot.pairASets;
      const setsB = nextSnapshot.pairBSets;

      if (setsA >= 2) {
        finalWinner = "pair_a";
        finalStatus = "finished";
      } else if (setsB >= 2) {
        finalWinner = "pair_b";
        finalStatus = "finished";
      }
    }

    // D. Update Match State
    // Si pasó de 'scheduled' a 'live' por la primera acción
    if (matchData.status === "scheduled") finalStatus = "live";
    if (finalStatus === "finished") finalStatus = "finished"; // Prioridad

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
        status: finalStatus as any,
      })
      .where(eq(matches.id, matchIdInt));

    // Update local snapshot para el broadcast
    nextSnapshot.status = finalStatus;
    nextSnapshot.winnerSide = finalWinner;
  });

  // 5. BROADCAST
  // [REAL-TIME] -> Notificar a todos los clientes la nueva situación
  broadcastToMatch(matchId, {
    type: "MATCH_UPDATE",
    matchId,
    timestamp: Date.now(),
    snapshot: nextSnapshot,
    lastPoint: history,
  });

  console.log(
    `[GAME]  :: POINT :: ${matchId} | ${actionType} by ${playerId} | State: ${nextSnapshot.pairAGames}-${nextSnapshot.pairBGames} (${nextSnapshot.pairAScore}-${nextSnapshot.pairBScore})`,
  );
}
