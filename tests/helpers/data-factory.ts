/**
 * █ [TEST HELPERS] :: DATA_FACTORY
 * =====================================================================
 * DESC:   Factory para generar datos de prueba reutilizables
 * =====================================================================
 */
// @ts-nocheck
import { db } from "../../src/db/db";
import {
  players,
  matches,
  matchStats,
  pointHistory,
  commentary,
  matchSets,
  type pointMethodEnum,
  type padelStrokeEnum,
} from "../../src/db/schema";

// =============================================================================
// █ TYPES
// =============================================================================

export interface MatchOptions {
  matchType?: string;
  pairAName?: string;
  pairBName?: string;
  status?: "scheduled" | "warmup" | "live" | "finished" | "canceled";
  servingPlayerId?: number;
  hasGoldPoint?: boolean;
}

export interface PointScenario {
  winnerSide: "pair_a" | "pair_b";
  winnerPlayerId: number;
  method?:
    | "winner"
    | "unforced_error"
    | "forced_error"
    | "service_ace"
    | "double_fault";
  stroke?:
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
  isNetPoint?: boolean;
}

// =============================================================================
// █ PLAYER CREATION
// =============================================================================

/**
 * Crea jugadores de test con nombres únicos basados en timestamp
 */
export async function createTestPlayers(
  count: number = 4,
  prefix: string = "Player",
) {
  const timestamp = Date.now();
  const playerData = Array.from({ length: count }, (_, i) => ({
    name: `${prefix} ${timestamp}-${i + 1}`,
    country: ["ESP", "ARG", "BRA", "ITA"][i % 4],
    ranking: Math.floor(Math.random() * 100) + 1,
  }));

  return await db.insert(players).values(playerData).returning();
}

// =============================================================================
// █ MATCH CREATION
// =============================================================================

/**
 * Crea un match de test con jugadores específicos
 */
export async function createTestMatch(
  playerIds: [number, number, number, number],
  options: MatchOptions = {},
) {
  const [p1Id, p2Id, p3Id, p4Id] = playerIds;

  const matchData = {
    matchType: options.matchType || "friendly",
    pairAName: options.pairAName || "Test Pair A",
    pairBName: options.pairBName || "Test Pair B",
    pairAPlayer1Id: p1Id,
    pairAPlayer2Id: p2Id,
    pairBPlayer1Id: p3Id,
    pairBPlayer2Id: p4Id,
    status: options.status || "scheduled",
    servingPlayerId: options.servingPlayerId || p1Id,
    hasGoldPoint: options.hasGoldPoint ?? false, // Default: modo clásico con ventajas
    startTime: new Date(),
  };

  const [match] = await db.insert(matches).values(matchData).returning();

  // Inicializar stats para todos los jugadores
  await db.insert(matchStats).values([
    { matchId: match.id, playerId: p1Id },
    { matchId: match.id, playerId: p2Id },
    { matchId: match.id, playerId: p3Id },
    { matchId: match.id, playerId: p4Id },
  ]);

  return match;
}

// =============================================================================
// █ POINT HISTORY CREATION
// =============================================================================

/**
 * Crea historial de puntos basado en escenarios
 */
export async function createTestPointHistory(
  matchId: number,
  scenarios: PointScenario[],
) {
  const historyData = scenarios.map((scenario, index) => ({
    matchId,
    setNumber: 1,
    gameNumber: 1,
    pointNumber: index + 1,
    winnerSide: scenario.winnerSide,
    winnerPlayerId: scenario.winnerPlayerId,
    method: scenario.method || "winner",
    stroke: scenario.stroke || "forehand",
    isNetPoint: scenario.isNetPoint || false,
    scoreAfterPairA: "0",
    scoreAfterPairB: "0",
    isGamePoint: false,
    isSetPoint: false,
    isMatchPoint: false,
  }));

  return await db.insert(pointHistory).values(historyData).returning();
}

// =============================================================================
// █ COMMENTARY CREATION
// =============================================================================

/**
 * Crea comentarios de test para un match
 */
export async function createTestCommentary(
  matchId: number,
  count: number = 10,
) {
  const commentaryMessages = [
    "¡Gran punto!",
    "Ace de saque",
    "Error no forzado",
    "Remate espectacular",
    "Defensa increíble",
    "Volea ganadora",
    "Globo perfecto",
    "Dejada magistral",
    "Break point",
    "Game, set, match!",
  ];

  const commentaryData = Array.from({ length: count }, (_, i) => ({
    matchId,
    setNumber: 1,
    gameNumber: Math.floor(i / 3) + 1,
    message: commentaryMessages[i % commentaryMessages.length] + ` [${i + 1}]`,
    tags: i % 2 === 0 ? ["highlight"] : ["standard"],
  }));

  return await db.insert(commentary).values(commentaryData).returning();
}

// =============================================================================
// █ MATCH SETS CREATION
// =============================================================================

/**
 * Crea sets finalizados para un match
 */
export async function createTestMatchSets(
  matchId: number,
  setResults: Array<{
    setNumber: number;
    pairAGames: number;
    pairBGames: number;
    tieBreak?: { pairA: number; pairB: number };
  }>,
) {
  const setsData = setResults.map((result) => ({
    matchId,
    setNumber: result.setNumber,
    pairAGames: result.pairAGames,
    pairBGames: result.pairBGames,
    tieBreakPairAPoints: result.tieBreak?.pairA ?? null,
    tieBreakPairBPoints: result.tieBreak?.pairB ?? null,
  }));

  return await db.insert(matchSets).values(setsData).returning();
}

// =============================================================================
// █ COMPLETE MATCH SCENARIO
// =============================================================================

/**
 * Crea un escenario completo de match con sets, puntos, stats, comentarios
 */
export async function createCompleteMatchScenario() {
  // 1. Crear jugadores
  const testPlayers = await createTestPlayers(4, "Pro");
  const playerIds: [number, number, number, number] = [
    testPlayers[0].id,
    testPlayers[1].id,
    testPlayers[2].id,
    testPlayers[3].id,
  ];

  // 2. Crear match
  const match = await createTestMatch(playerIds, {
    matchType: "competitive",
    pairAName: `${testPlayers[0].name}/${testPlayers[1].name}`,
    pairBName: `${testPlayers[2].name}/${testPlayers[3].name}`,
    status: "finished",
  });

  // 3. Crear sets (simular un partido 2-1)
  await createTestMatchSets(match.id, [
    { setNumber: 1, pairAGames: 6, pairBGames: 4 },
    {
      setNumber: 2,
      pairAGames: 6,
      pairBGames: 7,
      tieBreak: { pairA: 5, pairB: 7 },
    },
    { setNumber: 3, pairAGames: 6, pairBGames: 3 },
  ]);

  // 4. Crear historial de puntos variados
  const pointScenarios: PointScenario[] = [
    {
      winnerSide: "pair_a",
      winnerPlayerId: playerIds[0],
      method: "winner",
      stroke: "smash",
    },
    {
      winnerSide: "pair_a",
      winnerPlayerId: playerIds[1],
      method: "service_ace",
    },
    {
      winnerSide: "pair_b",
      winnerPlayerId: playerIds[2],
      method: "winner",
      stroke: "volley_forehand",
    },
    {
      winnerSide: "pair_b",
      winnerPlayerId: playerIds[3],
      method: "forced_error",
    },
    {
      winnerSide: "pair_a",
      winnerPlayerId: playerIds[0],
      method: "winner",
      stroke: "bandeja",
      isNetPoint: true,
    },
  ];
  await createTestPointHistory(match.id, pointScenarios);

  // 5. Crear comentarios
  await createTestCommentary(match.id, 20);

  return {
    match,
    players: testPlayers,
    playerIds,
  };
}
