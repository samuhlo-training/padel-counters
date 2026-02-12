/**
 * █ [DOMAIN] :: PADEL_TYPES
 * =====================================================================
 * DESC:   Tipos de dominio para la lógica de Padel (Score, State).
 *         Los tipos base (Player, Match, Enums) vienen de db.types.ts.
 * STATUS: GOLD MASTER
 * =====================================================================
 */
import type { PointMethod, PadelStroke, MatchStatus } from "./db.types.ts";

// Re-export para conveniencia
export type { PointMethod, PadelStroke };

// =============================================================================
// █ SCORING TYPES
// =============================================================================

/** Puntuación estándar de pádel (no-lineal: 0, 15, 30, 40, AD) */
export type PadelPoint = "0" | "15" | "30" | "40" | "AD";

/** Puntuación en tie-break (numérica: 0, 1, 2...) */
export type TieBreakPoint = number;

// =============================================================================
// █ STATE SNAPSHOT
// =============================================================================

/**
 * [SNAPSHOT] -> Representación completa del estado de un partido en un instante T.
 * Usado para broadcasting WebSocket y lógica de scoring.
 */
export interface MatchSnapshot {
  id: number;
  matchType: string;
  pairAName: string;
  pairBName: string;

  // -- PLAYER IDs --
  pairAPlayer1Id: number;
  pairAPlayer2Id: number;
  pairBPlayer1Id: number;
  pairBPlayer2Id: number;

  // -- PLAYER NAMES (resolved via JOIN) --
  pairAPlayer1Name: string;
  pairAPlayer2Name: string;
  pairBPlayer1Name: string;
  pairBPlayer2Name: string;

  // -- SCORE --
  pairAScore: string;
  pairBScore: string;
  pairAGames: number;
  pairBGames: number;
  pairASets: number;
  pairBSets: number;
  currentSetIdx: number;

  // -- FLAGS --
  isTieBreak: boolean;
  hasGoldPoint: boolean;

  // -- TIMING --
  startTime: string | null;
  endTime: string | null;
  courtId: number;
  courtName: string; // [NEW] Enhanced history detail

  // -- STATUS --
  winnerSide?: "pair_a" | "pair_b" | null;
  servingPlayerId?: number | null;
  servingPlayerName?: string | null;
  status: MatchStatus;

  // -- SET HISTORY --
  sets: Array<{ setNumber: number; pairAGames: number; pairBGames: number }>;

  // -- PLAYER STATS --
  stats: Array<{
    playerId: number;
    pointsWon: number;
    winners: number;
    unforcedErrors: number;
    smashWinners: number;
  }>;
}

// =============================================================================
// █ RULE ENGINE OUTPUT
// =============================================================================

/**
 * [OUTPUT] -> Resultado atómico de procesar un punto.
 * Retorna: Siguiente Estado + Historia + Eventos (Set ganado).
 */
export interface PointOutcome {
  nextSnapshot: MatchSnapshot;

  history: {
    setNumber: number;
    gameNumber: number;
    pointNumber: number;
    winnerSide: "pair_a" | "pair_b";
    method: PointMethod;
    stroke?: PadelStroke;
    isNetPoint?: boolean;
    scoreAfterPairA: string;
    scoreAfterPairB: string;
    isGamePoint: boolean;
    isSetPoint: boolean;
    isMatchPoint: boolean;
  };

  setCompleted?: {
    setNumber: number;
    pairAGames: number;
    pairBGames: number;
    tieBreakPairAPoints?: number;
    tieBreakPairBPoints?: number;
  };
}

// =============================================================================
// █ TELEMETRY (COMMENTARY BOT)
// =============================================================================

/**
 * [DTO] -> Datos de telemetría para generar comentarios automáticos.
 */
export interface TelemetryData {
  playerName: string;
  method?: PointMethod;
  stroke?: PadelStroke;
  speed?: number;
  isNetPoint?: boolean;
}
