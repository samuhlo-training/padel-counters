/**
 * █ [TEST] :: WS_SNAPSHOT_VERIFICATION
 * =====================================================================
 * DESC:   Tests para verificar snapshots de WebSocket al suscribirse
 * =====================================================================
 */
// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestPlayers, createTestMatch } from "./helpers/data-factory";
import { TestWSClient } from "./helpers/ws-client";
import { processPointScored } from "../src/controllers/match";
import { delay } from "./helpers/test-setup";

describe("WebSocket Snapshot Verification", () => {
  let matchId: number;
  let playerIds: [number, number, number, number];
  let wsClient: TestWSClient;

  beforeAll(async () => {
    // Crear players y match de test
    const testPlayers = await createTestPlayers(4, "WS_Snapshot");
    playerIds = [
      testPlayers[0].id,
      testPlayers[1].id,
      testPlayers[2].id,
      testPlayers[3].id,
    ];

    const match = await createTestMatch(playerIds, {
      matchType: "friendly",
      pairAName: "WS Test A",
      pairBName: "WS Test B",
      status: "live",
    });

    matchId = match.id;
    console.log(`✅ Created Match ${matchId} for WS Snapshot test`);
  });

  afterAll(() => {
    if (wsClient) {
      wsClient.close();
    }
  });

  // =============================================================================
  // █ INITIAL SNAPSHOT TESTS
  // =============================================================================

  it("should receive MATCH_UPDATE snapshot on SUBSCRIBE with initial state", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    // Suscribirse al match
    await wsClient.subscribe(matchId);

    // Esperar snapshot
    const msg = await wsClient.waitForMessage("MATCH_UPDATE");

    expect(msg.type).toBe("MATCH_UPDATE");
    expect(msg.matchId).toBe(String(matchId));
    expect(msg.snapshot).toBeDefined();

    // Verificar estructura del snapshot
    const snapshot = msg.snapshot;
    expect(snapshot.pairAScore).toBe("0");
    expect(snapshot.pairBScore).toBe("0");
    expect(snapshot.pairAGames).toBe(0);
    expect(snapshot.pairBGames).toBe(0);
    expect(snapshot.pairASets).toBe(0);
    expect(snapshot.pairBSets).toBe(0);
    expect(snapshot.isTieBreak).toBe(false);
    expect(snapshot.hasGoldPoint).toBe(false);
    expect(snapshot.status).toBe("live");

    console.log("✅ Snapshot verification passed:", snapshot);
  });

  it("should include all required fields in snapshot", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();
    await wsClient.subscribe(matchId);

    const msg = await wsClient.waitForMessage("MATCH_UPDATE");
    const snapshot = msg.snapshot;

    // Campos requeridos
    const requiredFields = [
      "id",
      "status",
      "pairAName",
      "pairBName",
      "pairAScore",
      "pairBScore",
      "pairAGames",
      "pairBGames",
      "pairASets",
      "pairBSets",
      "currentSetIdx",
      "isTieBreak",
      "hasGoldPoint",
    ];

    for (const field of requiredFields) {
      expect(snapshot[field]).toBeDefined();
    }
  });

  // =============================================================================
  // █ UPDATED SNAPSHOT TESTS
  // =============================================================================

  it("should receive updated snapshot after point is scored", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();
    await wsClient.subscribe(matchId);

    // Esperar snapshot inicial
    const initialMsg = await wsClient.waitForMessage("MATCH_UPDATE");
    expect(initialMsg.snapshot.pairAScore).toBe("0");

    // Anotar un punto
    await processPointScored({
      matchId: matchId.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
    });

    // Esperar actualización
    await delay(100); // Pequeño delay para asegurar procesamiento
    const updateMsg = await wsClient.waitForMessage(
      "MATCH_UPDATE",
      2000,
      (m) => m.snapshot.pairAScore === "15",
    );

    expect(updateMsg.snapshot.pairAScore).toBe("15");
    expect(updateMsg.snapshot.pairBScore).toBe("0");

    console.log("✅ Updated snapshot after point:", updateMsg.snapshot);
  });

  it("should reflect game wins in snapshot", async () => {
    // Crear un nuevo match para este test
    const newMatch = await createTestMatch(playerIds, {
      status: "live",
      pairAName: "Game Test A",
      pairBName: "Game Test B",
    });

    wsClient = new TestWSClient();
    await wsClient.connect();
    await wsClient.subscribe(newMatch.id);

    // Esperar snapshot inicial
    await wsClient.waitForMessage("MATCH_UPDATE");

    // Anotar 4 puntos para ganar el primer juego
    for (let i = 0; i < 4; i++) {
      await processPointScored({
        matchId: newMatch.id.toString(),
        playerId: playerIds[0].toString(),
        actionType: "winner",
      });
      await delay(50);
    }

    // Esperar última actualización
    await delay(200);
    const msg = await wsClient.waitForMessage(
      "MATCH_UPDATE",
      5000,
      (m) => m.snapshot.pairAGames === 1,
    );

    expect(msg.snapshot.pairAGames).toBe(1);
    expect(msg.snapshot.pairBGames).toBe(0);
    expect(msg.snapshot.pairAScore).toBe("0"); // Reset después del juego

    console.log("✅ Game win reflected in snapshot");
  });

  // =============================================================================
  // █ MULTIPLE SUBSCRIBERS TESTS
  // =============================================================================

  it("should send same snapshot to multiple subscribers", async () => {
    const client1 = new TestWSClient();
    const client2 = new TestWSClient();

    await client1.connect();
    await client2.connect();

    await client1.subscribe(matchId);
    await client2.subscribe(matchId);

    const msg1 = await client1.waitForMessage("MATCH_UPDATE");
    const msg2 = await client2.waitForMessage("MATCH_UPDATE");

    // Verificar que ambos reciben el mismo snapshot
    expect(msg1.snapshot.id).toBe(msg2.snapshot.id);
    expect(msg1.snapshot.pairAScore).toBe(msg2.snapshot.pairAScore);
    expect(msg1.snapshot.pairBScore).toBe(msg2.snapshot.pairBScore);

    client1.close();
    client2.close();

    console.log("✅ Multiple subscribers receive same snapshot");
  });

  it("should broadcast updates to all subscribers", async () => {
    // Crear nuevo match para aislamiento
    const broadcastMatch = await createTestMatch(playerIds, {
      status: "live",
    });

    const client1 = new TestWSClient();
    const client2 = new TestWSClient();

    await client1.connect();
    await client2.connect();

    await client1.subscribe(broadcastMatch.id);
    await client2.subscribe(broadcastMatch.id);

    // Consumir snapshots iniciales
    await client1.waitForMessage("MATCH_UPDATE");
    await client2.waitForMessage("MATCH_UPDATE");

    // Anotar un punto
    await processPointScored({
      matchId: broadcastMatch.id.toString(),
      playerId: playerIds[0].toString(),
      actionType: "winner",
    });

    // Ambos clientes deben recibir la actualización
    await delay(100);

    const update1 = await client1.waitForMessage(
      "MATCH_UPDATE",
      5000,
      (m) => m.snapshot.pairAScore === "15",
    );
    const update2 = await client2.waitForMessage(
      "MATCH_UPDATE",
      5000,
      (m) => m.snapshot.pairAScore === "15",
    );

    expect(update1.snapshot.pairAScore).toBe("15");
    expect(update2.snapshot.pairAScore).toBe("15");

    client1.close();
    client2.close();

    console.log("✅ Broadcast to all subscribers working");
  });
});
