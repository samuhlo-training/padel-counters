/**
 * █ [TEST] :: PADEL_FLOW_VERIFICATION
 * =====================================================================
 * DESC:   Tests integrales para flujos completos de partidos de Padel
 *         con sets, tie-breaks, golden points, y toda la lógica
 * =====================================================================
 */
// @ts-nocheck
import { describe, it, expect, beforeAll } from "bun:test";
import { db } from "../src/db/db";
import { matches, pointHistory, matchStats, matchSets } from "../src/db/schema";
import { processPointScored } from "../src/controllers/match";
import { eq, and } from "drizzle-orm";
import { createTestPlayers, createTestMatch } from "./helpers/data-factory";
import { delay } from "./helpers/test-setup";

describe("Padel Flow Verification (Comprehensive)", () => {
  let playerIds: [number, number, number, number];

  beforeAll(async () => {
    const testPlayers = await createTestPlayers(4, "PadelFlow");
    playerIds = [
      testPlayers[0].id,
      testPlayers[1].id,
      testPlayers[2].id,
      testPlayers[3].id,
    ];
    console.log("✅ Test players created:", playerIds);
  });

  // =============================================================================
  // █ BASIC POINT FLOW TESTS
  // =============================================================================

  it("should process points correctly and update match state (15-30-40-Game)", async () => {
    const match = await createTestMatch(playerIds, {
      pairAName: "Basic Flow A",
      pairBName: "Basic Flow B",
      status: "live",
    });

    // Point 1: Winner by P1 (15-0)
    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
    });

    let [updatedMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, match.id));

    expect(updatedMatch.pairAScore).toBe("15");
    expect(updatedMatch.pairBScore).toBe("0");

    // Point 2: Winner by P2 (30-0)
    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[1].toString(),
      actionType: "winner",
    });

    [updatedMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, match.id));

    expect(updatedMatch.pairAScore).toBe("30");

    // Point 3: Unforced Error by P3 -> Punto para A (40-0)
    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[2].toString(),
      actionType: "unforced_error",
    });

    [updatedMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, match.id));

    expect(updatedMatch.pairAScore).toBe("40");

    // Point 4: Winner by P1 -> Game A (resetting to 0-0, pairAGames = 1)
    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
    });

    [updatedMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, match.id));

    expect(updatedMatch.pairAGames).toBe(1);
    expect(updatedMatch.pairBGames).toBe(0);
    expect(updatedMatch.pairAScore).toBe("0");
    expect(updatedMatch.pairBScore).toBe("0");

    console.log("✅ Basic point flow verified");
  });

  // =============================================================================
  // █ POINT HISTORY TRACKING
  // =============================================================================

  it("should record point history correctly with all fields", async () => {
    const match = await createTestMatch(playerIds, { status: "live" });

    // Anotar varios puntos con diferentes métodos y strokes
    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
      stroke: "smash",
      isNetPoint: true,
    });

    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[1].toString(),
      actionType: "service_ace",
    });

    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[2].toString(),
      actionType: "unforced_error",
      stroke: "forehand",
    });

    const history = await db
      .select()
      .from(pointHistory)
      .where(eq(pointHistory.matchId, match.id))
      .orderBy(pointHistory.id);

    expect(history.length).toBe(3);

    // Verificar primer punto (smash winner)
    expect(history[0].method).toBe("winner");
    expect(history[0].stroke).toBe("smash");
    expect(history[0].isNetPoint).toBe(true);
    expect(history[0].winnerSide).toBe("pair_a");

    // Verificar segundo punto (service ace)
    expect(history[1].method).toBe("service_ace");
    expect(history[1].winnerSide).toBe("pair_a");

    // Verificar tercer punto (unforced error - punto para A)
    expect(history[2].method).toBe("unforced_error");
    expect(history[2].winnerSide).toBe("pair_a"); // Error de B, punto de A

    console.log("✅ Point history tracking verified");
  });

  // =============================================================================
  // █ PLAYER STATS TRACKING
  // =============================================================================

  it("should update player stats correctly by action type", async () => {
    const match = await createTestMatch(playerIds, { status: "live" });

    // P1: 2 winners, 1 smash winner
    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
    });

    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
      stroke: "smash",
    });

    // P3: 1 unforced error
    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[2].toString(),
      actionType: "unforced_error",
    });

    // Verificar stats de P1
    const [statsP1] = await db
      .select()
      .from(matchStats)
      .where(
        and(
          eq(matchStats.matchId, match.id),
          eq(matchStats.playerId, playerIds[0]),
        ),
      );

    expect(statsP1.pointsWon).toBe(2);
    expect(statsP1.winners).toBe(2);
    expect(statsP1.smashWinners).toBe(1);
    expect(statsP1.unforcedErrors).toBe(0);

    // Verificar stats de P3
    const [statsP3] = await db
      .select()
      .from(matchStats)
      .where(
        and(
          eq(matchStats.matchId, match.id),
          eq(matchStats.playerId, playerIds[2]),
        ),
      );

    expect(statsP3.unforcedErrors).toBe(1);
    expect(statsP3.pointsWon).toBe(0);

    console.log("✅ Player stats tracking verified");
  });

  // =============================================================================
  // █ MULTIPLE STROKE TYPES
  // =============================================================================

  it("should handle all stroke types correctly", async () => {
    const match = await createTestMatch(playerIds, { status: "live" });

    const strokeTypes = [
      "forehand",
      "backhand",
      "smash",
      "bandeja",
      "vibora",
      "volley_forehand",
      "volley_backhand",
      "lob",
      "drop_shot",
      "wall_boast",
    ] as const;

    for (const stroke of strokeTypes) {
      await processPointScored({
        matchId: match.id.toString(),
        playerId: playerIds[0].toString(),
        actionType: "winner",
        stroke,
      });
    }

    const history = await db
      .select()
      .from(pointHistory)
      .where(eq(pointHistory.matchId, match.id));

    expect(history.length).toBe(strokeTypes.length);

    // Verificar que todos los strokes fueron registrados
    const usedStrokes = history.map((h) => h.stroke);
    for (const stroke of strokeTypes) {
      expect(usedStrokes).toContain(stroke);
    }

    console.log("✅ All stroke types handled correctly");
  });

  // =============================================================================
  // █ ALL POINT METHODS
  // =============================================================================

  it("should handle all point methods correctly", async () => {
    const match = await createTestMatch(playerIds, { status: "live" });

    const methods = [
      "winner",
      "unforced_error",
      "forced_error",
      "service_ace",
      "double_fault",
    ] as const;

    for (const method of methods) {
      await processPointScored({
        matchId: match.id.toString(),
        playerId: playerIds[0].toString(),
        actionType: method,
      });
    }

    const history = await db
      .select()
      .from(pointHistory)
      .where(eq(pointHistory.matchId, match.id));

    expect(history.length).toBe(methods.length);

    const usedMethods = history.map((h) => h.method);
    for (const method of methods) {
      expect(usedMethods).toContain(method);
    }

    console.log("✅ All point methods handled correctly");
  });

  // =============================================================================
  // █ SET COMPLETION
  // =============================================================================

  it(
    "should complete a set and create matchSets record",
    async () => {
      const match = await createTestMatch(playerIds, { status: "live" });

      // Simular ganar 6 juegos (cada juego = 4 puntos)
      for (let game = 0; game < 6; game++) {
        for (let point = 0; point < 4; point++) {
          await processPointScored({
            matchId: match.id.toString(),
            playerId: playerIds[0].toString(),
            actionType: "winner",
          });
          // Pequeño delay para evitar race conditions
          await delay(10);
        }
      }

      // Delay adicional para asegurar procesamiento completo
      await delay(100);

      // Verificar que el set se completó
      const sets = await db
        .select()
        .from(matchSets)
        .where(eq(matchSets.matchId, match.id));

      expect(sets.length).toBe(1);
      expect(sets[0].setNumber).toBe(1);
      expect(sets[0].pairAGames).toBe(6);
      expect(sets[0].pairBGames).toBe(0);

      // Verificar match state
      const [updatedMatch] = await db
        .select()
        .from(matches)
        .where(eq(matches.id, match.id));

      expect(updatedMatch.pairASets).toBe(1);
      expect(updatedMatch.currentSetIdx).toBe(2);

      console.log("✅ Set completion verified");
    },
    { timeout: 15000 },
  );

  // =============================================================================
  // █ MATCH FINISH (2 SETS WIN)
  // =============================================================================

  it(
    "should finish match when a team wins 2 sets",
    async () => {
      const match = await createTestMatch(playerIds, { status: "live" });

      // Ganar Set 1 (6-0)
      for (let game = 0; game < 6; game++) {
        for (let point = 0; point < 4; point++) {
          await processPointScored({
            matchId: match.id.toString(),
            playerId: playerIds[0].toString(),
            actionType: "winner",
          });
          await delay(10);
        }
      }

      // Esperar entre sets
      await delay(100);

      // Ganar Set 2 (6-0)
      for (let game = 0; game < 6; game++) {
        for (let point = 0; point < 4; point++) {
          await processPointScored({
            matchId: match.id.toString(),
            playerId: playerIds[0].toString(),
            actionType: "winner",
          });
          await delay(10);
        }
      }

      // Delay final para asegurar procesamiento completo
      await delay(100);

      // Verificar match finished
      const [finishedMatch] = await db
        .select()
        .from(matches)
        .where(eq(matches.id, match.id));

      expect(finishedMatch.status).toBe("finished");
      expect(finishedMatch.winnerSide).toBe("pair_a");
      expect(finishedMatch.pairASets).toBe(2);

      // Verificar que se crearon 2 sets
      const sets = await db
        .select()
        .from(matchSets)
        .where(eq(matchSets.matchId, match.id));

      expect(sets.length).toBe(2);

      console.log("✅ Match finish after 2 sets verified");
    },
    { timeout: 30000 },
  );

  // =============================================================================
  // █ GOLDEN POINT SCENARIO
  // =============================================================================

  it("should handle golden point (40-40 deuce) correctly", async () => {
    // Crear partido con modo Punto de Oro activado
    const match = await createTestMatch(playerIds, {
      status: "live",
      hasGoldPoint: true, // Modo Punto de Oro: 40-40 → siguiente punto gana
    });

    // Llegar a 40-40 (3 puntos cada uno)
    for (let i = 0; i < 3; i++) {
      await processPointScored({
        matchId: match.id.toString(),
        playerId: playerIds[0].toString(),
        actionType: "winner",
      });
    }

    for (let i = 0; i < 3; i++) {
      await processPointScored({
        matchId: match.id.toString(),
        playerId: playerIds[2].toString(),
        actionType: "winner",
      });
    }

    let [updatedMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, match.id));

    expect(updatedMatch.pairAScore).toBe("40");
    expect(updatedMatch.pairBScore).toBe("40");
    expect(updatedMatch.hasGoldPoint).toBe(true);

    // Golden point: siguiente punto gana el juego
    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
    });

    [updatedMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, match.id));

    expect(updatedMatch.pairAGames).toBe(1);
    expect(updatedMatch.hasGoldPoint).toBe(true); // El flag permanece true (es configuración del partido)
    expect(updatedMatch.pairAScore).toBe("0");
    expect(updatedMatch.pairBScore).toBe("0");

    console.log("✅ Golden point scenario verified");
  });

  // =============================================================================
  // █ STATUS TRANSITION
  // =============================================================================

  it("should transition from scheduled to live on first point", async () => {
    const match = await createTestMatch(playerIds, { status: "scheduled" });

    expect(match.status).toBe("scheduled");

    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
    });

    const [updatedMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, match.id));

    expect(updatedMatch.status).toBe("live");

    console.log("✅ Status transition verified");
  });

  // =============================================================================
  // █ IGNORE POINTS IN FINISHED MATCH
  // =============================================================================

  it("should ignore points scored in finished matches", async () => {
    const match = await createTestMatch(playerIds, { status: "finished" });

    await processPointScored({
      matchId: match.id.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
    });

    const [unchangedMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, match.id));

    // El match no debería haber cambiado
    expect(unchangedMatch.pairAScore).toBe("0");
    expect(unchangedMatch.pairAGames).toBe(0);

    console.log("✅ Finished match ignores points correctly");
  });
});
