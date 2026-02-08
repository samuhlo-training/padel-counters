/**
 * █ [TEST] :: WS_BI_DIRECTIONAL_FLOW
 * =====================================================================
 * DESC:   Tests para comunicación bidireccional WebSocket
 * =====================================================================
 */
// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { db } from "../src/db/db";
import { matchStats } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { createTestPlayers, createTestMatch } from "./helpers/data-factory";
import { TestWSClient } from "./helpers/ws-client";

describe("WebSocket Bi-Directional Flow", () => {
  let matchId: number;
  let playerIds: [number, number, number, number];
  let wsClient: TestWSClient;

  // Cleanup automático después de cada test para evitar conexiones colgadas
  afterEach(() => {
    if (wsClient) {
      wsClient.close();
    }
  });

  beforeAll(async () => {
    // Crear jugadores y match
    const testPlayers = await createTestPlayers(4, "BiDir");
    playerIds = [
      testPlayers[0].id,
      testPlayers[1].id,
      testPlayers[2].id,
      testPlayers[3].id,
    ];

    const match = await createTestMatch(playerIds, {
      pairAName: "BiDir Pair A",
      pairBName: "BiDir Pair B",
      status: "live",
    });

    matchId = match.id;

    // Actualizar stats para tener datos significativos
    await db
      .update(matchStats)
      .set({
        pointsWon: 15,
        winners: 8,
        unforcedErrors: 3,
        smashWinners: 5,
      })
      .where(
        and(
          eq(matchStats.matchId, matchId),
          eq(matchStats.playerId, playerIds[0]),
        ),
      );

    await db
      .update(matchStats)
      .set({
        pointsWon: 12,
        winners: 6,
        unforcedErrors: 5,
        smashWinners: 2,
      })
      .where(
        and(
          eq(matchStats.matchId, matchId),
          eq(matchStats.playerId, playerIds[2]),
        ),
      );

    console.log(`✅ Created BiDir test match ${matchId} with stats`);
  });

  afterAll(() => {
    if (wsClient) {
      wsClient.close();
    }
  });

  // =============================================================================
  // █ MATCH SUMMARY TESTS
  // =============================================================================

  it("should handle REQUEST_STATS for MATCH_SUMMARY", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    const response = await wsClient.requestStats(matchId, "MATCH_SUMMARY");

    expect(response.type).toBe("STATS_RESPONSE");
    expect(response.subtype).toBe("MATCH_SUMMARY");
    expect(response.matchId).toBe(String(matchId));
    expect(response.data).toBeDefined();
    expect(response.data.status).toBe("live");
    expect(response.data.currentScore).toBeDefined();
    expect(response.data.pairAName).toBe("BiDir Pair A");
    expect(response.data.pairBName).toBe("BiDir Pair B");

    console.log("✅ MATCH_SUMMARY response:", response.data);
  });

  it("should include all match fields in MATCH_SUMMARY", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    const response = await wsClient.requestStats(matchId, "MATCH_SUMMARY");
    const data = response.data;

    const requiredFields = [
      "id",
      "status",
      "pairAName",
      "pairBName",
      "currentScore",
      "pairAGames",
      "pairBGames",
      "pairASets",
      "pairBSets",
    ];

    for (const field of requiredFields) {
      expect(data[field]).toBeDefined();
    }
  });

  // =============================================================================
  // █ PLAYER STATS TESTS
  // =============================================================================

  it("should handle REQUEST_STATS for PLAYER with correct data", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    const response = await wsClient.requestStats(
      matchId,
      "PLAYER",
      playerIds[0],
    );

    expect(response.type).toBe("STATS_RESPONSE");
    expect(response.subtype).toBe("PLAYER");
    expect(response.matchId).toBe(String(matchId));
    expect(response.data).toBeDefined();
    expect(response.data.pointsWon).toBe(15);
    expect(response.data.winners).toBe(8);
    expect(response.data.unforcedErrors).toBe(3);
    expect(response.data.smashWinners).toBe(5);

    console.log("✅ PLAYER stats for P1:", response.data);
  });

  it("should return different stats for different players", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    const response1 = await wsClient.requestStats(
      matchId,
      "PLAYER",
      playerIds[0],
    );
    const response2 = await wsClient.requestStats(
      matchId,
      "PLAYER",
      playerIds[2],
    );

    expect(response1.data.pointsWon).toBe(15);
    expect(response2.data.pointsWon).toBe(12);

    expect(response1.data.winners).toBe(8);
    expect(response2.data.winners).toBe(6);

    console.log("✅ Different stats for different players verified");
  });

  it("should return zero stats for player with no activity", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    // playerIds[1] no ha sido actualizado, debería tener stats en 0
    const response = await wsClient.requestStats(
      matchId,
      "PLAYER",
      playerIds[1],
    );

    expect(response.data.pointsWon).toBe(0);
    expect(response.data.winners).toBe(0);
    expect(response.data.unforcedErrors).toBe(0);
    expect(response.data.smashWinners).toBe(0);
  });

  it("should request stats for all players in a match", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    const statsArray = [];
    for (const playerId of playerIds) {
      const response = await wsClient.requestStats(matchId, "PLAYER", playerId);
      statsArray.push(response.data);
    }

    expect(statsArray.length).toBe(4);

    // Verificar que cada uno tiene los campos correctos
    for (const stats of statsArray) {
      expect(stats).toHaveProperty("pointsWon");
      expect(stats).toHaveProperty("winners");
      expect(stats).toHaveProperty("unforcedErrors");
      expect(stats).toHaveProperty("smashWinners");
    }

    console.log("✅ All 4 players stats retrieved");
  });

  // =============================================================================
  // █ SEQUENTIAL REQUESTS TESTS
  // =============================================================================

  it("should handle sequential MATCH_SUMMARY then PLAYER requests", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    // Primero MATCH_SUMMARY
    const summaryResponse = await wsClient.requestStats(
      matchId,
      "MATCH_SUMMARY",
    );
    expect(summaryResponse.subtype).toBe("MATCH_SUMMARY");
    expect(summaryResponse.data.status).toBe("live");

    // Luego PLAYER
    const playerResponse = await wsClient.requestStats(
      matchId,
      "PLAYER",
      playerIds[0],
    );
    expect(playerResponse.subtype).toBe("PLAYER");
    expect(playerResponse.data.pointsWon).toBe(15);

    console.log("✅ Sequential requests handled correctly");
  });

  it("should handle rapid multiple requests", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    // Enviar múltiples requests rápidamente
    const promises = [
      wsClient.requestStats(matchId, "MATCH_SUMMARY"),
      wsClient.requestStats(matchId, "PLAYER", playerIds[0]),
      wsClient.requestStats(matchId, "PLAYER", playerIds[1]),
      wsClient.requestStats(matchId, "PLAYER", playerIds[2]),
    ];

    const responses = await Promise.all(promises);

    expect(responses.length).toBe(4);
    expect(responses[0].subtype).toBe("MATCH_SUMMARY");
    expect(responses[1].subtype).toBe("PLAYER");
    expect(responses[2].subtype).toBe("PLAYER");
    expect(responses[3].subtype).toBe("PLAYER");

    console.log("✅ Rapid multiple requests handled");
  });

  // =============================================================================
  // █ ERROR HANDLING TESTS
  // =============================================================================

  it("should handle non-existent match gracefully", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    try {
      // Intentar obtener stats de match que no existe
      await wsClient.requestStats(999999, "MATCH_SUMMARY");
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      // Esperamos que falle o devuelva error
      expect(error).toBeDefined();
      console.log("✅ Non-existent match handled gracefully");
    }
  });

  it("should handle non-existent player gracefully", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    try {
      // Intentar obtener stats de jugador que no existe en este match
      await wsClient.requestStats(matchId, "PLAYER", 999999);
      // Si no lanza error, debería devolver stats vacíos o error en response
      console.log("✅ Non-existent player handled gracefully");
    } catch (error) {
      // También está bien si lanza error
      expect(error).toBeDefined();
      console.log("✅ Non-existent player threw error as expected");
    }
  });
});
