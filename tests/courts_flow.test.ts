// @ts-nocheck
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../src/index.ts";
import { setServerRef, websocketHandler } from "../src/ws/server.ts";
import { db } from "../src/db/db.ts";
import { courts, matches, players, matchStats } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";

const TEST_PORT = 3004;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const WS_URL = `ws://localhost:${TEST_PORT}/ws`;

describe("COURTS FLOW: Match Creation & Updates", () => {
  let server: any;
  let testCourtId: number;
  let playerIds: number[] = [];

  beforeAll(async () => {
    // Start Server
    server = Bun.serve({
      port: TEST_PORT,
      fetch: app.fetch,
      websocket: websocketHandler,
    });
    setServerRef(server);

    // Setup Data: 4 Players & 1 Court
    const newPlayers = await db
      .insert(players)
      .values([
        { name: "CourtTest P1" },
        { name: "CourtTest P2" },
        { name: "CourtTest P3" },
        { name: "CourtTest P4" },
      ])
      .returning();
    playerIds = newPlayers.map((p) => p.id);

    const [newCourt] = await db
      .insert(courts)
      .values({
        name: "Test Court 1",
        authToken: "test-auth-token-" + Date.now(),
      })
      .returning();
    testCourtId = newCourt.id;
  });

  let createdMatchId: number | null = null;

  afterAll(async () => {
    server.stop();
    // Cleanup
    if (testCourtId) {
      // Break circular dependency first
      await db
        .update(courts)
        .set({ activeMatchId: null })
        .where(eq(courts.id, testCourtId));
    }
    if (createdMatchId) {
      await db.delete(matchStats).where(eq(matchStats.matchId, createdMatchId));
      await db.delete(matches).where(eq(matches.id, createdMatchId));
    }
    if (testCourtId) {
      await db.delete(courts).where(eq(courts.id, testCourtId));
    }
  });

  test("1. Verify Court is initially FREE", async () => {
    const res = await fetch(`${BASE_URL}/courts`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const court = data.find((c: any) => c.id === testCourtId);
    expect(court).toBeDefined();
    expect(court.status).toBe("free");
    expect(court.activeMatchId).toBeNull();
  });

  test("2. Create Match assigned to Court -> Receive WS Update", async () => {
    // A. Connect WS Client
    const ws = new WebSocket(WS_URL);
    const wsPromise = new Promise<any>((resolve) => {
      ws.onmessage = (event) => {
        console.log("TEST_WS_CLIENT received:", event.data);
        const msg = JSON.parse(String(event.data));
        if (
          msg.type === "COURT_UPDATE" &&
          msg.payload.courtId === testCourtId &&
          msg.payload.startTime // Verify startTime is present
        ) {
          resolve(msg);
        }
      };
    });

    // Wait for connection
    await new Promise((r) => setTimeout(r, 500));

    // B. Create Match
    const matchPayload = {
      startTime: new Date().toISOString(),
      pairAPlayer1Id: playerIds[0],
      pairAPlayer2Id: playerIds[1],
      pairBPlayer1Id: playerIds[2],
      pairBPlayer2Id: playerIds[3],
      courtId: testCourtId,
    };

    const res = await fetch(`${BASE_URL}/matches`, {
      method: "POST",
      body: JSON.stringify(matchPayload),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    const matchId = body.data.id;
    createdMatchId = matchId;

    // C. Verify WS Message received
    const wsMsg = await wsPromise;
    expect(wsMsg).toBeDefined();
    expect(wsMsg.payload.status).toBe("busy");
    expect(wsMsg.payload.activeMatchId).toBe(matchId);

    ws.close();
  });

  test("3. Verify Court is now BUSY via API", async () => {
    const res = await fetch(`${BASE_URL}/courts`);
    const data = await res.json();
    const court = data.find((c: any) => c.id === testCourtId);
    expect(court.status).toBe("busy");
    expect(court.activeMatchId).not.toBeNull();
  });
});
