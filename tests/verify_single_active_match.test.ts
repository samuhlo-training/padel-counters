import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { MatchService } from "../src/services/matchService";
import { db } from "../src/db/db";
import { matches, courts } from "../src/db/schema";
import { eq } from "drizzle-orm";
import {
  createTestMatch,
  createTestCourt,
  createTestPlayer,
} from "./helpers/data-factory";

/**
 * █ TEST: SINGLE ACTIVE MATCH VERIFICATION
 * =====================================================================
 * DESC:   Verify that a court cannot have two active matches.
 * =====================================================================
 */
describe("Single Active Match Enforcement", () => {
  let courtId: number;
  let playerIds: [number, number, number, number];

  beforeAll(async () => {
    // 1. Create a test court
    const court = await createTestCourt();
    courtId = court.id;

    // 2. Create 4 test players
    const p1 = await createTestPlayer();
    const p2 = await createTestPlayer();
    const p3 = await createTestPlayer();
    const p4 = await createTestPlayer();
    playerIds = [p1.id, p2.id, p3.id, p4.id];
  });

  test("should allow creating a match on a free court", async () => {
    const match = await MatchService.createMatch({
      pairAPlayer1Id: playerIds[0],
      pairAPlayer2Id: playerIds[1],
      pairBPlayer1Id: playerIds[2],
      pairBPlayer2Id: playerIds[3],
      courtId: courtId,
      startTime: new Date(),
      status: "live",
    });

    expect(match).toBeDefined();
    expect(match.id).toBeDefined();

    // Verify court status
    const [updatedCourt] = await db
      .select()
      .from(courts)
      .where(eq(courts.id, courtId));

    expect(updatedCourt.activeMatchId).toBe(match.id);
  });

  test("should FAIL when creating a match on an occupied court", async () => {
    // Attempt to create another match on the same court
    try {
      await MatchService.createMatch({
        pairAPlayer1Id: playerIds[0],
        pairAPlayer2Id: playerIds[1],
        pairBPlayer1Id: playerIds[2],
        pairBPlayer2Id: playerIds[3],
        courtId: courtId,
        startTime: new Date(),
        status: "live",
      });
      // Should fail
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.message).toContain("already occupied");
    }
  });

  test("should release court when match finishes", async () => {
    // 1. Get current active match
    const [courtBefore] = await db
      .select()
      .from(courts)
      .where(eq(courts.id, courtId));

    expect(courtBefore.activeMatchId).not.toBeNull();
    const matchId = courtBefore.activeMatchId!;

    // 2. Force finish the match via addPoint (simulating last point)
    // Actually, simpler to just update status via DB validation?
    // No, let's use a simulated "finish" logic or just manually update if needed.
    // But we want to test that addPoint triggers the release.
    // Since simulating a whole match is long, let's artificially set the score to match point.

    // Hack: Manually update match to be at match point
    await db
      .update(matches)
      .set({
        pairASets: 1,
        pairBSets: 0,
        pairAGames: 5,
        pairBGames: 0,
        pairAScore: "40",
        pairBScore: "0",
        status: "live",
      })
      .where(eq(matches.id, matchId));

    // 3. Score the winning point
    const snapshot = await MatchService.getSnapshot(matchId);
    // Serving player logic might restrict who wins, but let's try p1 (pair A)
    // We need strict player IDs.
    const matchData = await db.query.matches.findFirst({
      where: eq(matches.id, matchId),
    });
    if (!matchData) throw new Error("Match not found");

    await MatchService.addPoint({
      matchId: String(matchId),
      playerId: String(matchData.pairAPlayer1Id),
      actionType: "winner",
      stroke: "smash",
    });

    // 4. Verify court is now free
    const [courtAfter] = await db
      .select()
      .from(courts)
      .where(eq(courts.id, courtId));

    expect(courtAfter.activeMatchId).toBeNull();
  });
});
