/**
 * █ [TEST] :: IOT_FLOW_VERIFICATION
 * =====================================================================
 * DESC:   Verifies the end-to-end flow for IoT devices:
 *         1. Device Authentication (AUTH_DEVICE)
 *         2. Telemetry Event processing (TELEMETRY_EVENT)
 *         3. Automated Commentary generation
 *         4. Match Score updates
 * =====================================================================
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { db } from "../src/db/db";
import { matches, courts, players } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { TestWSClient } from "./helpers/ws-client";
import { createTestPlayers, createTestMatch } from "./helpers/data-factory";

describe("IoT Integration Flow", () => {
  let matchId: number;
  let courtId: number;
  let authToken = "ct_test_token_" + Date.now();
  let wsClient: TestWSClient;
  let playerIds: number[];

  afterEach(() => {
    if (wsClient) wsClient.close();
  });

  beforeAll(async () => {
    // 1. Setup Data
    const testPlayers = await createTestPlayers(4, "IoT");
    playerIds = testPlayers.map((p) => p.id);

    // 2. Create Match
    const match = await createTestMatch(
      [playerIds[0]!, playerIds[1]!, playerIds[2]!, playerIds[3]!],
      {
        pairAName: "Robot Pair A",
        pairBName: "Robot Pair B",
        status: "live",
      },
    );
    if (!match) throw new Error("Failed to create test match");
    matchId = match.id;

    // 3. Create Court and link to Match
    const [court] = await db
      .insert(courts)
      .values({
        name: "Test Court IoT",
        authToken: authToken,
        activeMatchId: matchId,
      })
      .returning();
    if (!court) throw new Error("Failed to create test court");
    courtId = court.id;

    console.log(
      `✅ Setup complete: Match ${matchId} on Court ${courtId} (Token: ${authToken})`,
    );
  });

  afterAll(async () => {
    // Cleanup if needed
    if (wsClient) wsClient.close();
  });

  it("should authenticate a device with valid token", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    const response = await wsClient.sendAndAwait({
      type: "AUTH_DEVICE",
      token: authToken,
    });

    expect(response.type).toBe("AUTH_SUCCESS");
    expect(response.courtName).toBe("Test Court IoT");
  });

  it("should reject a device with invalid token", async () => {
    wsClient = new TestWSClient();
    await wsClient.connect();

    const response = await wsClient.sendAndAwait({
      type: "AUTH_DEVICE",
      token: "INVALID_TOKEN_123",
    });

    expect(response.type).toBe("ERROR");
    expect(response.payload).toContain("Invalid Auth Token");
  });

  it("should process telemetry event and update score", async () => {
    // Client 1: Spectator (receives updates)
    const spectatorClient = new TestWSClient();
    await spectatorClient.connect();

    // 1. Wait for WELCOME
    console.log("Waiting for WELCOME...");
    await spectatorClient.waitForMessages(1);

    // 2. Subscribe and wait for confirmation + snapshot
    console.log("Subscribing...");
    spectatorClient.send({ type: "SUBSCRIBE", matchId: String(matchId) });

    console.log("Waiting for SUBSCRIBED and SNAPSHOT...");
    // We expect 2 messages: SUBSCRIBED and MATCH_UPDATE (snapshot)
    // We wait up to 3 seconds to be safe
    const handshake = await spectatorClient.waitForMessages(2, 3000);
    console.log("Handshake received:", JSON.stringify(handshake, null, 2));

    const isSubscribed = handshake.some((m) => m.type === "SUBSCRIBED");
    const hasSnapshot = handshake.some(
      (m) => m.type === "MATCH_UPDATE" && m.snapshot,
    );

    if (!isSubscribed || !hasSnapshot) {
      throw new Error(
        "Handshake failed: Missing SUBSCRIBED or MATCH_UPDATE snapshot",
      );
    }

    // Client 2: IoT Device (sends telemetry)
    const deviceClient = new TestWSClient();
    await deviceClient.connect();
    await deviceClient.sendAndAwait({ type: "AUTH_DEVICE", token: authToken });

    // 3. Send Telemetry from Device
    await deviceClient.send({
      type: "TELEMETRY_EVENT",
      payload: {
        playerId: String(playerIds[0]),
        method: "winner",
        stroke: "smash",
        speed: 150,
      },
    });

    // 4. Spectator should receive updates (Commentary + Match Update)
    // Now we wait for the NEW messages
    console.log("Waiting for updates...");
    const messages = await spectatorClient.waitForMessages(2, 2000); // Increase timeout
    console.log("Received messages:", JSON.stringify(messages, null, 2));

    const commentaryMsg = messages.find((m) => m.type === "COMMENTARY");
    const updateMsg = messages.find((m) => m.type === "MATCH_UPDATE");

    expect(commentaryMsg).toBeDefined();
    expect(updateMsg).toBeDefined();

    if (commentaryMsg) {
      console.log("🗣️ Generated Commentary:", commentaryMsg.data.message);
    }

    if (updateMsg) {
      expect(updateMsg.snapshot.pairAScore).toBe("15");
      expect(updateMsg.snapshot.pairBScore).toBe("0");
    }

    spectatorClient.close();
    deviceClient.close();
  });

  it("should handle unforced errors correctly via telemetry", async () => {
    // Client 1: Spectator
    const spectatorClient = new TestWSClient();
    await spectatorClient.connect();

    // Wait for WELCOME
    await spectatorClient.waitForMessages(1);

    // Subscribe and wait for SUBSCRIBED + SNAPSHOT
    spectatorClient.send({ type: "SUBSCRIBE", matchId: String(matchId) });
    await spectatorClient.waitForMessages(2, 2000); // Consume SUBSCRIBED + initial SNAPSHOT

    // Client 2: IoT Device
    const deviceClient = new TestWSClient();
    await deviceClient.connect();
    await deviceClient.sendAndAwait({ type: "AUTH_DEVICE", token: authToken });

    // Send Unforced Error by Player 2 (Pair B)
    // This gives a point to Pair A (opponent)
    await deviceClient.send({
      type: "TELEMETRY_EVENT",
      payload: {
        playerId: String(playerIds[2]), // Pair B player
        method: "unforced_error",
        stroke: "volley_forehand",
      },
    });

    // Wait for update from telemetry
    const messages = await spectatorClient.waitForMessages(1, 2000);
    const updateMsg = messages.find((m) => m.type === "MATCH_UPDATE");

    expect(updateMsg).toBeDefined();
    if (updateMsg) {
      // Previous test scored "15-0", this unforced error adds another point = "30-0"
      expect(updateMsg.snapshot.pairAScore).toBe("30");
      expect(updateMsg.snapshot.pairBScore).toBe("0");
    }

    spectatorClient.close();
    deviceClient.close();
  });
});
