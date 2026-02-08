/**
 * █ [HANDLER] :: IOT_DEVICES
 * =====================================================================
 * DESC:   Autenticación y telemetría de dispositivos IoT (cámaras/sensores).
 * STATUS: STABLE
 * =====================================================================
 */
import type { ServerWebSocket } from "bun";
import type { WebSocketData, ClientMessage } from "../../types/index.ts";
import { db } from "../../db/db.ts";
import { courts, players } from "../../db/schema.ts";
import { eq } from "drizzle-orm";
import { sendJson } from "../utils.ts";
import { MatchService } from "../../services/matchService.ts";
import { generateAutomatedComment } from "../../utils/commentaryBot.ts";
import { telemetryPayloadSchema } from "../../validation/telemetry.ts";

// =============================================================================
// █ HANDLER: DEVICE AUTHENTICATION
// =============================================================================

/**
 * ◼️ FUNCTION: HANDLE_DEVICE_AUTH
 * ---------------------------------------------------------
 * Autentica un dispositivo IoT (Cámara/Mini-PC) mediante token.
 */
export async function handleDeviceAuth(
  socket: ServerWebSocket<WebSocketData>,
  payload: ClientMessage & { type: "AUTH_DEVICE" },
): Promise<void> {
  const { token } = payload;
  if (!token || typeof token !== "string") {
    console.warn(`[IoT]   :: AUTH_FAIL     :: Missing or invalid token`);
    sendJson(socket, { type: "ERROR", payload: "Missing or invalid token" });
    return;
  }
  console.log(
    `[IoT]   :: AUTH_ATTEMPT  :: token_preview: ${token.slice(0, 6)}...`,
  );

  try {
    const [court] = await db
      .select()
      .from(courts)
      .where(eq(courts.authToken, token));

    if (!court) {
      console.warn(`[IoT]   :: AUTH_FAIL     :: Invalid Token`);
      sendJson(socket, { type: "ERROR", payload: "Invalid Auth Token" });
      return;
    }

    // [SUCCESS] -> Upgrade socket state
    socket.data.isDevice = true;
    socket.data.courtId = court.id;

    console.log(
      `[IoT]   :: AUTH_SUCCESS  :: Court: ${court.name} (${court.id})`,
    );
    sendJson(socket, { type: "AUTH_SUCCESS", courtName: court.name });
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[IoT]   :: AUTH_ERR      ::`, err);
    sendJson(socket, {
      type: "ERROR",
      payload: "Authentication process failed",
    });
  }
}

// =============================================================================
// █ HANDLER: TELEMETRY EVENTS
// =============================================================================

/**
 * ◼️ FUNCTION: HANDLE_TELEMETRY_EVENT
 * ---------------------------------------------------------
 * Procesa datos de sensores/cámaras, aplica reglas y genera comentarios.
 * [REFACTORED] -> Usa MatchService y validación Zod.
 */
export async function handleTelemetryEvent(
  socket: ServerWebSocket<WebSocketData>,
  payload: ClientMessage & { type: "TELEMETRY_EVENT" },
): Promise<void> {
  // 1. SECURITY CHECK
  if (!socket.data.isDevice || !socket.data.courtId) {
    console.warn(`[IoT]   :: UNAUTHORIZED  :: Telemetry rejected`);
    sendJson(socket, { type: "ERROR", payload: "Unauthorized Device" });
    return;
  }

  // 2. VALIDATE PAYLOAD (Strict Typing)
  const validation = telemetryPayloadSchema.safeParse(payload.payload);
  if (!validation.success) {
    console.error(`[IoT]   :: INVALID_DATA  ::`, validation.error.format());
    sendJson(socket, { type: "ERROR", payload: "Invalid telemetry payload" });
    return;
  }

  const { playerId, stroke, speed, method, isNetPoint } = validation.data;
  console.log(
    `[IoT]   :: TELEMETRY     :: Court ${socket.data.courtId} | Player ${playerId} | ${method ?? "unknown"}`,
  );

  try {
    // 3. FIND ACTIVE MATCH
    const [court] = await db
      .select()
      .from(courts)
      .where(eq(courts.id, socket.data.courtId));

    if (!court || !court.activeMatchId) {
      console.warn(
        `[IoT]   :: NO_ACTIVE_MATCH :: Court ${socket.data.courtId} idle`,
      );
      sendJson(socket, {
        type: "ERROR",
        payload: "No active match on this court",
      });
      return;
    }

    const matchId = String(court.activeMatchId);
    const matchIdInt = court.activeMatchId;

    // 4. PROCESS GAME RULES (Service Layer - NO type casting needed)
    if (method) {
      await MatchService.addPoint({
        matchId,
        playerId,
        actionType: method, // Ya es PointMethod gracias a Zod
        stroke,
        isNetPoint,
      });
    }

    // 5. AUTOMATED COMMENTARY
    const [player] = await db
      .select()
      .from(players)
      .where(eq(players.id, parseInt(playerId)));

    const playerName = player ? player.name : `Jugador ${playerId}`;

    const commentText = generateAutomatedComment({
      playerName,
      method,
      stroke,
      speed,
      isNetPoint,
    });

    // 6. SAVE & BROADCAST COMMENTARY (via Service)
    await MatchService.addCommentary(matchIdInt, commentText);
    console.log(`[BOT]   :: COMMENTARY    :: ${commentText}`);
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[IoT]   :: TELEMETRY_ERR ::`, err);
    sendJson(socket, {
      type: "ERROR",
      payload: `Telemetry Error: ${err.message}`,
    });
  }
}
