// @ts-nocheck
import { describe, expect, test, beforeAll } from "bun:test";
import { app } from "../src/index";
import {
  createTestMatch,
  createTestCourt,
  createTestPlayer,
} from "./helpers/data-factory";

/**
 * █ TEST: COURT LAST MATCH VERIFICATION
 * =====================================================================
 * DESC:   Verify that GET /courts returns the correct lastMatchId.
 * =====================================================================
 */
describe("Court Last Match Verification", () => {
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

  test("should return null lastMatchId when no matches exist", async () => {
    const res = await app.request("/courts");
    expect(res.status).toBe(200);
    const courts = await res.json();
    const targetCourt = courts.find((c: any) => c.id === courtId);

    expect(targetCourt).toBeDefined();
    expect(targetCourt.lastMatchId).toBeNull();
  });

  test("should return lastMatchId after creating a match", async () => {
    // Create Match A
    const matchA = await createTestMatch(playerIds, {
      // Fixed: Pass playerIds first
      courtId: courtId,
      startTime: new Date(),
      status: "finished", // Simulated finished match
    });

    const res = await app.request("/courts");
    expect(res.status).toBe(200);
    const courts = await res.json();
    const targetCourt = courts.find((c: any) => c.id === courtId);

    expect(targetCourt.lastMatchId).toBe(matchA.id);
  });

  test("should update lastMatchId when a newer match is created", async () => {
    // Sleep briefly to ensure createdAt difference if needed,
    // though DB usually handles ms precision.
    await new Promise((r) => setTimeout(r, 10));

    // Create Match B
    const matchB = await createTestMatch(playerIds, {
      // Fixed: Pass playerIds first
      courtId: courtId,
      startTime: new Date(),
      status: "live",
    });

    const res = await app.request("/courts");
    expect(res.status).toBe(200);
    const courts = await res.json();
    const targetCourt = courts.find((c: any) => c.id === courtId);

    expect(targetCourt.lastMatchId).toBe(matchB.id);
  });
});
