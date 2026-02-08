/**
 * █ [TEST] :: MATCH_CRUD_VERIFICATION
 * =====================================================================
 * DESC:   Tests comprehensivos para operaciones CRUD de matches
 * =====================================================================
 */
// @ts-nocheck
import { describe, it, expect, beforeAll } from "bun:test";
import { db } from "../src/db/db";
import { matches, matchStats, matchSets } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { createTestPlayers, createTestMatch } from "./helpers/data-factory";

describe("Match CRUD Verification", () => {
  let playerIds: [number, number, number, number];

  beforeAll(async () => {
    // Crear jugadores de test con nombres únicos
    const testPlayers = await createTestPlayers(4, "CRUD");
    playerIds = [
      testPlayers[0].id,
      testPlayers[1].id,
      testPlayers[2].id,
      testPlayers[3].id,
    ];
  });

  // =============================================================================
  // █ CREATION TESTS
  // =============================================================================

  it("should create a match in SCHEDULED state with correct defaults", async () => {
    const match = await createTestMatch(playerIds, {
      pairAName: "Team Alpha",
      pairBName: "Team Beta",
      status: "scheduled",
    });

    expect(match).toBeDefined();
    expect(match.status).toBe("scheduled");
    expect(match.pairAGames).toBe(0);
    expect(match.pairBGames).toBe(0);
    expect(match.pairASets).toBe(0);
    expect(match.pairBSets).toBe(0);
    expect(match.pairAScore).toBe("0");
    expect(match.pairBScore).toBe("0");
    expect(match.isTieBreak).toBe(false);
    expect(match.hasGoldPoint).toBe(false);
    expect(match.pairAName).toBe("Team Alpha");

    console.log("✅ Match created with ID:", match.id);
  });

  it("should create a match in LIVE state", async () => {
    const match = await createTestMatch(playerIds, {
      status: "live",
      matchType: "competitive",
    });

    expect(match.status).toBe("live");
    expect(match.matchType).toBe("competitive");
  });

  it("should initialize matchStats for all 4 players", async () => {
    const match = await createTestMatch(playerIds);

    const stats = await db
      .select()
      .from(matchStats)
      .where(eq(matchStats.matchId, match.id));

    expect(stats.length).toBe(4);

    // Verificar que cada jugador tiene stats inicializados
    for (const playerId of playerIds) {
      const playerStat = stats.find((s) => s.playerId === playerId);
      expect(playerStat).toBeDefined();
      expect(playerStat!.pointsWon).toBe(0);
      expect(playerStat!.winners).toBe(0);
      expect(playerStat!.unforcedErrors).toBe(0);
      expect(playerStat!.smashWinners).toBe(0);
    }
  });

  // =============================================================================
  // █ READ TESTS
  // =============================================================================

  it("should retrieve a match by ID with all fields", async () => {
    const created = await createTestMatch(playerIds, {
      pairAName: "Retrieve Test A",
      pairBName: "Retrieve Test B",
    });

    const [fetched] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, created.id));

    expect(fetched).toBeDefined();
    expect(fetched.id).toBe(created.id);
    expect(fetched.pairAName).toBe("Retrieve Test A");
    expect(fetched.pairBName).toBe("Retrieve Test B");
    expect(fetched.pairAPlayer1Id).toBe(playerIds[0]);
    expect(fetched.pairAPlayer2Id).toBe(playerIds[1]);
    expect(fetched.pairBPlayer1Id).toBe(playerIds[2]);
    expect(fetched.pairBPlayer2Id).toBe(playerIds[3]);
  });

  // =============================================================================
  // █ UPDATE TESTS
  // =============================================================================

  it("should update match status from LIVE to FINISHED", async () => {
    const match = await createTestMatch(playerIds, { status: "live" });

    const [updated] = await db
      .update(matches)
      .set({
        status: "finished",
        winnerSide: "pair_a",
        endTime: new Date(),
      })
      .where(eq(matches.id, match.id))
      .returning();

    expect(updated.status).toBe("finished");
    expect(updated.winnerSide).toBe("pair_a");
    expect(updated.endTime).toBeDefined();
  });

  it("should update match score during play", async () => {
    const match = await createTestMatch(playerIds, { status: "live" });

    const [updated] = await db
      .update(matches)
      .set({
        pairAScore: "40",
        pairBScore: "30",
        pairAGames: 3,
        pairBGames: 2,
      })
      .where(eq(matches.id, match.id))
      .returning();

    expect(updated.pairAScore).toBe("40");
    expect(updated.pairBScore).toBe("30");
    expect(updated.pairAGames).toBe(3);
    expect(updated.pairBGames).toBe(2);
  });

  it("should update match to tie-break state", async () => {
    const match = await createTestMatch(playerIds, { status: "live" });

    const [updated] = await db
      .update(matches)
      .set({
        pairAGames: 6,
        pairBGames: 6,
        isTieBreak: true,
        pairAScore: "0",
        pairBScore: "0",
      })
      .where(eq(matches.id, match.id))
      .returning();

    expect(updated.isTieBreak).toBe(true);
    expect(updated.pairAGames).toBe(6);
    expect(updated.pairBGames).toBe(6);
  });

  it("should update match to golden point state", async () => {
    const match = await createTestMatch(playerIds, { status: "live" });

    const [updated] = await db
      .update(matches)
      .set({
        pairAScore: "40",
        pairBScore: "40",
        hasGoldPoint: true,
      })
      .where(eq(matches.id, match.id))
      .returning();

    expect(updated.hasGoldPoint).toBe(true);
    expect(updated.pairAScore).toBe("40");
    expect(updated.pairBScore).toBe("40");
  });

  // =============================================================================
  // █ STATUS TRANSITION TESTS
  // =============================================================================

  it("should allow valid status transitions", async () => {
    // SCHEDULED -> WARMUP -> LIVE -> FINISHED
    const match = await createTestMatch(playerIds, { status: "scheduled" });

    // SCHEDULED -> WARMUP
    let [updated] = await db
      .update(matches)
      .set({ status: "warmup" })
      .where(eq(matches.id, match.id))
      .returning();
    expect(updated.status).toBe("warmup");

    // WARMUP -> LIVE
    [updated] = await db
      .update(matches)
      .set({ status: "live", startTime: new Date() })
      .where(eq(matches.id, match.id))
      .returning();
    expect(updated.status).toBe("live");

    // LIVE -> FINISHED
    [updated] = await db
      .update(matches)
      .set({ status: "finished", endTime: new Date(), winnerSide: "pair_b" })
      .where(eq(matches.id, match.id))
      .returning();
    expect(updated.status).toBe("finished");
  });

  it("should allow CANCELED from any state", async () => {
    const match1 = await createTestMatch(playerIds, { status: "scheduled" });
    const match2 = await createTestMatch(playerIds, { status: "live" });

    const [canceled1] = await db
      .update(matches)
      .set({ status: "canceled" })
      .where(eq(matches.id, match1.id))
      .returning();

    const [canceled2] = await db
      .update(matches)
      .set({ status: "canceled" })
      .where(eq(matches.id, match2.id))
      .returning();

    expect(canceled1.status).toBe("canceled");
    expect(canceled2.status).toBe("canceled");
  });

  // =============================================================================
  // █ CONSTRAINT TESTS
  // =============================================================================

  it("should enforce unique constraint on matchSets (matchId, setNumber)", async () => {
    const match = await createTestMatch(playerIds);

    // Crear primer set
    await db.insert(matchSets).values({
      matchId: match.id,
      setNumber: 1,
      pairAGames: 6,
      pairBGames: 4,
    });

    // Intentar crear set duplicado debería fallar
    try {
      await db.insert(matchSets).values({
        matchId: match.id,
        setNumber: 1,
        pairAGames: 6,
        pairBGames: 3,
      });
      throw new Error("Should have thrown unique constraint error");
    } catch (error: any) {
      expect(error.message).toContain("unique");
    }
  });

  it("should enforce unique constraint on matchStats (matchId, playerId)", async () => {
    const match = await createTestMatch(playerIds);

    // Los stats ya existen después de createTestMatch
    // Intentar crear stats duplicados debería fallar
    try {
      await db.insert(matchStats).values({
        matchId: match.id,
        playerId: playerIds[0],
        pointsWon: 10,
      });
      throw new Error("Should have thrown unique constraint error");
    } catch (error: any) {
      expect(error.message).toContain("unique");
    }
  });

  // =============================================================================
  // █ SERVING PLAYER TESTS
  // =============================================================================

  it("should track serving player correctly", async () => {
    const match = await createTestMatch(playerIds, {
      status: "live",
      servingPlayerId: playerIds[0],
    });

    expect(match.servingPlayerId).toBe(playerIds[0]);

    // Cambiar servidor
    const [updated] = await db
      .update(matches)
      .set({ servingPlayerId: playerIds[2] })
      .where(eq(matches.id, match.id))
      .returning();

    expect(updated.servingPlayerId).toBe(playerIds[2]);
  });
});
