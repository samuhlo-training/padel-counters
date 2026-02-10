// @ts-nocheck
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../src/index.ts";
import { db } from "../src/db/db.ts";
import { courts, matches, players, matchStats } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { createTestPlayer, createTestMatch } from "./helpers/data-factory.ts";

describe("DIAGNOSTIC :: Courts Status", () => {
  let testCourtId: number;
  let testMatchId: number;

  beforeAll(async () => {
    const [court] = await db
      .insert(courts)
      .values({
        name: "Diagnostic Court",
        authToken: `diag_test_${Date.now()}`,
      })
      .returning();
    testCourtId = court.id;
    console.log(`Created test court with ID: ${testCourtId}`);
  });

  afterAll(async () => {
    if (testMatchId) {
      await db.delete(matchStats).where(eq(matchStats.matchId, testMatchId));
      await db.delete(matches).where(eq(matches.id, testMatchId));
    }
    if (testCourtId) {
      await db.delete(courts).where(eq(courts.id, testCourtId));
    }
  });

  test("Diagnostic sequence", async () => {
    // 1. Initial state
    let res = await app.request("/courts");
    let courtsData = await res.json();
    let myCourt = courtsData.find((c: any) => c.id === testCourtId);
    console.log("Initial state:", myCourt);
    expect(myCourt.status).toBe("free");

    // 2. Busy state
    const p1 = await createTestPlayer();
    const p2 = await createTestPlayer();
    const p3 = await createTestPlayer();
    const p4 = await createTestPlayer();
    const match = await createTestMatch([p1.id, p2.id, p3.id, p4.id]);
    testMatchId = match.id;

    await db
      .update(courts)
      .set({ activeMatchId: match.id })
      .where(eq(courts.id, testCourtId));

    // Check DB directly
    const dbCourt = await db
      .select()
      .from(courts)
      .where(eq(courts.id, testCourtId));
    console.log("DB Court after update:", dbCourt[0]);

    res = await app.request("/courts");
    courtsData = await res.json();
    myCourt = courtsData.find((c: any) => c.id === testCourtId);
    console.log("Busy state:", myCourt);
    expect(myCourt.status).toBe("busy");

    // 3. Back to free
    await db
      .update(courts)
      .set({ activeMatchId: null })
      .where(eq(courts.id, testCourtId));

    res = await app.request("/courts");
    courtsData = await res.json();
    myCourt = courtsData.find((c: any) => c.id === testCourtId);
    console.log("Back to free state:", myCourt);
    expect(myCourt.status).toBe("free");
  });
});
