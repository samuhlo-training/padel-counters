/**
 * █ [DOMAIN] :: PADEL_TYPES
 * =====================================================================
 * DESC:   Tipos de dominio para la lógica de Padel (Score, State, Entities).
 * STATUS: GOLD MASTER
 * =====================================================================
 */

// =============================================================================
// █ SCORING TYPES
// =============================================================================
// [CORE] -> La puntuación en pádel es no-lineal (15, 30, 40).
export type PadelPoint = "0" | "15" | "30" | "40" | "AD";
export type TieBreakPoint = number;

export type PadelStroke =
  | "forehand"
  | "backhand"
  | "smash"
  | "bandeja"
  | "vibora"
  | "volley_forehand"
  | "volley_backhand"
  | "lob"
  | "drop_shot"
  | "wall_boast";

export type PointMethod =
  | "winner"
  | "unforced_error"
  | "forced_error"
  | "service_ace"
  | "double_fault";

// =============================================================================
// █ STATE SNAPSHOT
// =============================================================================
// DESC: Representación completa del estado de un partido en un instante T.
// [DB] -> Coincide con la estructura de la tabla 'matches'.
export interface MatchSnapshot {
  id: number;
  pairAName: string;
  pairBName: string;

  // -- SCORE --
  pairAScore: string; // "0", "15", "40", "AD", o "7" (en tiebreak)
  pairBScore: string;
  pairAGames: number;
  pairBGames: number;
  pairASets: number;
  pairBSets: number;
  currentSetIdx: number; // 1, 2, 3

  // -- FLAGS --
  isTieBreak: boolean;
  hasGoldPoint: boolean; // ¿Se juega con Punto de Oro?

  // -- STATUS --
  winnerSide?: "pair_a" | "pair_b" | null; // null si sigue vivo
  servingPlayerId?: number | null;
  status: "scheduled" | "warmup" | "live" | "finished" | "canceled";
}

// =============================================================================
// █ RULE ENGINE OUTPUT
// =============================================================================
// DESC: Resultado atómico de procesar un punto.
// [RETURN] -> Retorna el Siguiente Estado, Historia y Eventos (Set ganado).
export interface PointOutcome {
  // [NEW STATE] -> Estado mutado para persistir en 'matches'
  nextSnapshot: MatchSnapshot;

  // [HISTORY] -> Datos para insertar en 'point_history'
  history: {
    setNumber: number;
    gameNumber: number;
    pointNumber: number; // Calculado por DB/Controller
    winnerSide: "pair_a" | "pair_b";
    method: PointMethod;
    stroke?: PadelStroke;
    isNetPoint?: boolean;
    scoreAfterPairA: string;
    scoreAfterPairB: string;

    // [DERIVED] -> Flags calculados pre/post punto
    isGamePoint: boolean;
    isSetPoint: boolean;
    isMatchPoint: boolean;
  };

  // [EVENT] -> Solo presente si este punto cerró un set
  setCompleted?: {
    setNumber: number;
    pairAGames: number;
    pairBGames: number;
    tieBreakPairAPoints?: number;
    tieBreakPairBPoints?: number;
  };
}

// =============================================================================
// █ ENTITIES
// =============================================================================
export interface Player {
  id: number;
  name: string;
}

// =============================================================================
// █ TELEMETRY (COMMENTARY BOT)
// =============================================================================

/**
 * [DTO] -> Datos de telemetría para generar comentarios automáticos.
 * Recibe datos de sensores IoT y genera narrativa.
 */
export interface TelemetryData {
  playerName: string;
  method?: PointMethod;
  stroke?: PadelStroke;
  speed?: number; // km/h
  isNetPoint?: boolean;
}
