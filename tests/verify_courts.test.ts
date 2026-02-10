// @ts-nocheck
/**
 * █ [TEST] :: VERIFY_COURTS
 * =====================================================================
 * DESC:   Integration tests para el endpoint de estado de pistas.
 * SCOPE:  Probamos que el estado cambie dinámicamente con las asignaciones.
 * =====================================================================
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../src/index.ts";
import { db } from "../src/db/db.ts";
import { courts, matches, players, matchStats } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { createTestPlayer, createTestMatch } from "./helpers/data-factory.ts";

describe("INTEGRATION :: Courts Status", () => {
  let testCourtId: number;
  let testMatchId: number;

  // ===========================================================================
  // █ SETUP & TEARDOWN
  // ===========================================================================
  beforeAll(async () => {
    // 1. CREATE -> Pista de prueba aislada
    const [court] = await db
      .insert(courts)
      .values({
        name: "Test Court Status",
        authToken: `status_test_${Date.now()}`,
      })
      .returning();
    testCourtId = court.id;
  });

  afterAll(async () => {
    // CLEANUP -> Eliminar datos de prueba en orden inverso (FK Constraints)
    if (testMatchId) {
      await db.delete(matchStats).where(eq(matchStats.matchId, testMatchId));
      await db.delete(matches).where(eq(matches.id, testMatchId));
    }
    if (testCourtId) {
      await db.delete(courts).where(eq(courts.id, testCourtId));
    }
  });

  // ===========================================================================
  // █ TESTS: GET /courts
  // ===========================================================================

  test("GET /courts should list court as 'free' initially", async () => {
    const res = await app.request("/courts");
    expect(res.status).toBe(200);

    const courtsData = await res.json();
    const myCourt = courtsData.find((c: any) => c.id === testCourtId);

    // VERIFY -> La pista debe existir y estar libre
    expect(myCourt).toBeDefined();
    expect(myCourt.status).toBe("free");
    expect(myCourt.activeMatchId).toBeNull();
  });

  test("GET /courts should list court as 'busy' when match is active", async () => {
    // 1. SETUP -> Crear jugadores y partido
    const p1 = await createTestPlayer();
    const p2 = await createTestPlayer();
    const p3 = await createTestPlayer();
    const p4 = await createTestPlayer();

    // 2. ACTION -> Crear partido con los 4 jugadores
    const match = await createTestMatch([p1.id, p2.id, p3.id, p4.id]);
    testMatchId = match.id;

    // 3. ASSIGN -> Vincular partido a la pista (simular ocupación)
    await db
      .update(courts)
      .set({ activeMatchId: match.id })
      .where(eq(courts.id, testCourtId));

    // 4. VERIFY -> La pista debe aparecer como 'busy'
    const res = await app.request("/courts");
    expect(res.status).toBe(200);
    const courtsData = await res.json();
    const myCourt = courtsData.find((c: any) => c.id === testCourtId);

    expect(myCourt).toBeDefined();
    expect(myCourt.status).toBe("busy");
    expect(myCourt.activeMatchId).toBe(match.id);
  });

  test("GET /courts should list court as 'free' after match ends/removed", async () => {
    // 1. ACTION -> Desvincular partido (simular fin de juego)
    await db
      .update(courts)
      .set({ activeMatchId: null })
      .where(eq(courts.id, testCourtId));

    // 2. VERIFY -> La pista vuelve a estar 'free'
    const res = await app.request("/courts");
    expect(res.status).toBe(200);
    const courtsData = await res.json();
    const myCourt = courtsData.find((c: any) => c.id === testCourtId);

    expect(myCourt).toBeDefined();
    expect(myCourt.status).toBe("free");
    expect(myCourt.activeMatchId).toBeNull();
  });
});
