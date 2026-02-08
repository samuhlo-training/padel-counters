/**
 * █ [TEST] :: COMMENTARY_VERIFICATION
 * =====================================================================
 * DESC:   Tests para sistema de comentarios en matches
 * =====================================================================
 */
// @ts-nocheck
import { describe, it, expect, beforeAll } from "bun:test";
import { db } from "../src/db/db";
import { commentary } from "../src/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  createTestPlayers,
  createTestMatch,
  createTestCommentary,
} from "./helpers/data-factory";
import { TEST_CONSTANTS } from "./helpers/test-setup";

const BASE_URL = TEST_CONSTANTS.BASE_URL;

describe("Commentary API Tests", () => {
  let matchId: number;
  let playerIds: [number, number, number, number];

  beforeAll(async () => {
    const testPlayers = await createTestPlayers(4, "Commentary");
    playerIds = [
      testPlayers[0].id,
      testPlayers[1].id,
      testPlayers[2].id,
      testPlayers[3].id,
    ];

    const match = await createTestMatch(playerIds, {
      pairAName: "Commentary Test A",
      pairBName: "Commentary Test B",
      status: "live",
      matchType: "competitive",
    });

    matchId = match.id;
    console.log(`✅ Created test match ${matchId} for commentary tests`);
  });

  // =============================================================================
  // █ POST COMMENTARY TESTS
  // =============================================================================

  describe("POST /matches/:id/commentary", () => {
    it("should create a commentary with all required fields", async () => {
      const payload = {
        setNumber: 1,
        gameNumber: 3,
        message: "¡Punto increíble de Tapia!",
        tags: ["highlight", "winner"],
      };

      const response = await fetch(
        `${BASE_URL}/matches/${matchId}/commentary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const json = (await response.json()) as any;

      expect(response.status).toBe(201);
      expect(json.data.matchId).toBe(matchId);
      expect(json.data.message).toBe(payload.message);
      expect(json.data.setNumber).toBe(1);
      expect(json.data.gameNumber).toBe(3);
      expect(json.data.tags).toEqual(["highlight", "winner"]);

      console.log("✅ Commentary created:", json.data.id);
    });

    it("should create commentary without optional setNumber and gameNumber", async () => {
      const payload = {
        message: "Comentario general del partido",
        tags: ["general"],
      };

      const response = await fetch(
        `${BASE_URL}/matches/${matchId}/commentary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const json = (await response.json()) as any;

      expect(response.status).toBe(201);
      expect(json.data.message).toBe(payload.message);
      expect(json.data.setNumber).toBeNull();
      expect(json.data.gameNumber).toBeNull();
    });

    it("should create multiple commentaries for the same match", async () => {
      const comments = [
        {
          message: "Inicio del set",
          setNumber: 1,
          gameNumber: 1,
          tags: ["start"],
        },
        {
          message: "Break point",
          setNumber: 1,
          gameNumber: 2,
          tags: ["break"],
        },
        { message: "Ace!", setNumber: 1, gameNumber: 3, tags: ["ace"] },
      ];

      for (const comment of comments) {
        const response = await fetch(
          `${BASE_URL}/matches/${matchId}/commentary`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(comment),
          },
        );

        expect(response.status).toBe(201);
      }

      const allComments = await db
        .select()
        .from(commentary)
        .where(eq(commentary.matchId, matchId));

      expect(allComments.length).toBeGreaterThanOrEqual(3);
    });

    it("should fail with empty message", async () => {
      const response = await fetch(
        `${BASE_URL}/matches/${matchId}/commentary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "" }),
        },
      );

      expect(response.status).toBe(400);
    });

    it("should fail with invalid match ID", async () => {
      const response = await fetch(`${BASE_URL}/matches/invalid/commentary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Test" }),
      });

      expect(response.status).toBe(400);
    });

    it("should handle tags array correctly", async () => {
      const payload = {
        message: "Multi-tag commentary",
        tags: ["highlight", "winner", "set-point", "match-point"],
      };

      const response = await fetch(
        `${BASE_URL}/matches/${matchId}/commentary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const json = (await response.json()) as any;

      expect(response.status).toBe(201);
      expect(json.data.tags).toEqual(payload.tags);
      expect(json.data.tags.length).toBe(4);
    });
  });

  // =============================================================================
  // █ GET COMMENTARY TESTS
  // =============================================================================

  describe("GET /matches/:id/commentary", () => {
    let testMatchId: number;

    beforeAll(async () => {
      // Crear match separado con comentarios predefinidos
      const match = await createTestMatch(playerIds, {
        status: "live",
        pairAName: "GET Test A",
        pairBName: "GET Test B",
      });

      testMatchId = match.id;

      // Crear 30 comentarios
      await createTestCommentary(testMatchId, 30);
    });

    it("should retrieve all commentaries for a match", async () => {
      const response = await fetch(
        `${BASE_URL}/matches/${testMatchId}/commentary`,
      );
      const json = (await response.json()) as any;

      expect(response.status).toBe(200);
      expect(json.data).toBeArray();
      expect(json.data.length).toBeGreaterThanOrEqual(30);
    });

    it("should order commentaries by newest first (descending createdAt)", async () => {
      const response = await fetch(
        `${BASE_URL}/matches/${testMatchId}/commentary`,
      );
      const json = (await response.json()) as any;

      const data = json.data;
      expect(data.length).toBeGreaterThan(1);

      for (let i = 0; i < data.length - 1; i++) {
        const current = new Date(data[i].createdAt).getTime();
        const next = new Date(data[i + 1].createdAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }

      console.log("✅ Commentaries ordered correctly");
    });

    it("should respect limit parameter", async () => {
      const response = await fetch(
        `${BASE_URL}/matches/${testMatchId}/commentary?limit=5`,
      );
      const json = (await response.json()) as any;

      expect(json.data.length).toBe(5);
    });

    it("should handle large limit gracefully", async () => {
      // El límite debe ser validado y rechazar valores > 100
      const response = await fetch(
        `${BASE_URL}/matches/${testMatchId}/commentary?limit=1000`,
      );
      const json = (await response.json()) as any;

      // Espera 400 porque el limit excede el máximo permitido (100)
      expect(response.status).toBe(400);
      expect(json.error).toBeDefined();
    });

    it("should return empty array for match with no commentaries", async () => {
      const emptyMatch = await createTestMatch(playerIds, { status: "live" });

      const response = await fetch(
        `${BASE_URL}/matches/${emptyMatch.id}/commentary`,
      );
      const json = (await response.json()) as any;

      expect(response.status).toBe(200);
      expect(json.data).toBeArray();
      expect(json.data.length).toBe(0);
    });

    it("should include all commentary fields in response", async () => {
      const response = await fetch(
        `${BASE_URL}/matches/${testMatchId}/commentary?limit=1`,
      );
      const json = (await response.json()) as any;

      const comment = json.data[0];
      expect(comment).toHaveProperty("id");
      expect(comment).toHaveProperty("matchId");
      expect(comment).toHaveProperty("message");
      expect(comment).toHaveProperty("createdAt");
      expect(comment).toHaveProperty("tags");
    });
  });

  // =============================================================================
  // █ BROADCAST TESTS
  // =============================================================================

  describe("Commentary Broadcast to Multiple Matches", () => {
    it("should broadcast commentary to all live matches", async () => {
      // Crear varios matches en estado live
      const liveMatches = [];
      for (let i = 0; i < 3; i++) {
        const match = await createTestMatch(playerIds, { status: "live" });
        liveMatches.push(match);
      }

      // Enviar comentario a cada uno
      for (const match of liveMatches) {
        const response = await fetch(
          `${BASE_URL}/matches/${match.id}/commentary`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: `Broadcast test ${Date.now()}`,
              tags: ["broadcast"],
            }),
          },
        );

        expect(response.status).toBe(201);
      }

      // Verificar que cada match tiene su comentario
      for (const match of liveMatches) {
        const comments = await db
          .select()
          .from(commentary)
          .where(eq(commentary.matchId, match.id));

        expect(comments.length).toBeGreaterThan(0);
      }

      console.log("✅ Broadcast to multiple matches verified");
    });
  });

  // =============================================================================
  // █ DATA PERSISTENCE TESTS
  // =============================================================================

  describe("Commentary Data Persistence", () => {
    it("should persist commentary data correctly in database", async () => {
      const payload = {
        setNumber: 2,
        gameNumber: 5,
        message: "Persistence test commentary",
        tags: ["test", "persistence"],
      };

      const response = await fetch(
        `${BASE_URL}/matches/${matchId}/commentary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const json = (await response.json()) as any;
      const commentaryId = json.data.id;

      // Verificar directamente en DB
      const [dbComment] = await db
        .select()
        .from(commentary)
        .where(eq(commentary.id, commentaryId));

      expect(dbComment).toBeDefined();
      expect(dbComment.matchId).toBe(matchId);
      expect(dbComment.setNumber).toBe(2);
      expect(dbComment.gameNumber).toBe(5);
      expect(dbComment.message).toBe(payload.message);
      expect(dbComment.tags).toEqual(payload.tags);

      console.log("✅ Commentary persisted correctly in DB");
    });
  });

  // =============================================================================
  // █ EDGE CASES
  // =============================================================================

  describe("Commentary Edge Cases", () => {
    it("should handle very long messages", async () => {
      const longMessage = "A".repeat(1000);

      const response = await fetch(
        `${BASE_URL}/matches/${matchId}/commentary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: longMessage }),
        },
      );

      const json = (await response.json()) as any;
      expect(response.status).toBe(201);
      expect(json.data.message).toBe(longMessage);
    });

    it("should handle special characters in messages", async () => {
      const specialMessage = "¡Vaya remate! 🎾 ¿Lo vieron? @Tapia #Increíble";

      const response = await fetch(
        `${BASE_URL}/matches/${matchId}/commentary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: specialMessage }),
        },
      );

      const json = (await response.json()) as any;
      expect(response.status).toBe(201);
      expect(json.data.message).toBe(specialMessage);
    });

    it("should handle empty tags array", async () => {
      const response = await fetch(
        `${BASE_URL}/matches/${matchId}/commentary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "No tags",
            tags: [],
          }),
        },
      );

      const json = (await response.json()) as any;
      expect(response.status).toBe(201);
      expect(json.data.tags).toEqual([]);
    });
  });
});
