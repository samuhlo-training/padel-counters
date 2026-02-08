/**
 * █ [CORE] :: WEBSOCKET_SERVER
 * =====================================================================
 * DESC:   Gestiona conexiones en tiempo real, eventos y broadcasting.
 *         Soporta flujo Bi-Direccional (Push & Request/Response).
 * STATUS: STABLE
 * =====================================================================
 */
import type { ServerWebSocket, Server } from "bun";
import { processPointScored, getMatchSnapshot } from "../controllers/match.ts";
import { db } from "../db/db.ts";
import {
  matches,
  matchStats,
  players,
  courts,
  commentary,
} from "../db/schema.ts";
import { eq, and } from "drizzle-orm";
import { generateAutomatedComment } from "../utils/commentaryBot.ts";
import type {
  WebSocketData,
  ClientMessage,
  ServerMessage,
} from "../types/index.ts";

// Re-export para compatibilidad con código existente
export type { WebSocketData, ClientMessage, ServerMessage };

// =============================================================================
// █ HANDLERS: SOCKET EVENTS
// =============================================================================
export const websocketHandler = {
  /**
   * ◼️ EVENT: OPEN
   * ---------------------------------------------------------
   * Se dispara al establecer conexión TCP/WS.
   */
  open(ws: ServerWebSocket<WebSocketData>) {
    console.log(`[WS]    :: CONNECTED     :: ip: ${ws.remoteAddress}`);

    // [GLOBAL CHANNEL] -> Todos escuchan eventos globales (ej: nuevo partido crado)
    ws.subscribe("global");

    // [ACK] -> Saludo inicial para confirmar conexión
    sendJson(ws, {
      type: "WELCOME",
      payload: "Conectado a Padel Counters Real-Time API",
    });
  },

  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    // [LOG] -> Preview del mensaje para debug
    const msgPreview =
      typeof message === "string"
        ? `${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`
        : `<Buffer ${message.byteLength} bytes>`;
    console.log(`[WS]    << MSG_RECV      :: preview: ${msgPreview}`);
    handleMatchMessage(ws, message);
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    console.log(`[WS]    :: DISCONNECTED  :: ip: ${ws.remoteAddress}`);
    ws.unsubscribe("global");
    cleanUpMatchSubscriptions(ws);
  },
};

// =============================================================================
// █ GLOBAL STATE: SERVER REFERENCE
// =============================================================================
// [SINGLETON] -> Guardamos referencia al servidor Bun para poder hacer broadcast
// desde fuera de los handlers del socket (ej: desde un Controller REST).
let serverRef: Server<WebSocketData> | null = null;

export function setServerRef(server: Server<WebSocketData>) {
  console.log(`[SYS]   ++ REF_LINKED    :: WebSocket Server instance stored`);
  serverRef = server;
}

// Mapa local de suscriptores para gestión fina (además de los topics de Bun)
const matchSubscribers = new Map<string, Set<ServerWebSocket<WebSocketData>>>();

function subscribeToMatch(
  matchId: string,
  socket: ServerWebSocket<WebSocketData>,
) {
  if (!matchSubscribers.has(matchId)) {
    matchSubscribers.set(matchId, new Set());
  }
  matchSubscribers.get(matchId)!.add(socket);
}

function unsubscribeFromMatch(
  matchId: string,
  socket: ServerWebSocket<WebSocketData>,
) {
  const subscribers = matchSubscribers.get(matchId);
  if (subscribers) {
    subscribers.delete(socket);
    if (subscribers.size === 0) {
      matchSubscribers.delete(matchId);
    }
  }
}

function cleanUpMatchSubscriptions(socket: ServerWebSocket<WebSocketData>) {
  for (const [matchId, sockets] of matchSubscribers.entries()) {
    if (sockets.has(socket)) {
      unsubscribeFromMatch(matchId, socket);
    }
  }
}

// =============================================================================
// █ HANDLER: MATCH MESSAGES & LOGIC
// =============================================================================

/**
 * ◼️ FUNCTION: PROCESS_STATS_REQUEST
 * ---------------------------------------------------------
 * Maneja peticiones bajo demanda (Request/Response pattern over WS).
 * Consulta la DB y responde solo al socket solicitante.
 */
async function processStatsRequest(
  socket: ServerWebSocket<WebSocketData>,
  payload: ClientMessage & { type: "REQUEST_STATS" },
) {
  const { matchId, subtype, playerId } = payload;
  const matchIdInt = parseInt(matchId);

  try {
    if (subtype === "PLAYER") {
      if (!playerId) throw new Error("Missing playerId for PLAYER stats");
      const playerIdInt = parseInt(playerId);

      const [stats] = await db
        .select()
        .from(matchStats)
        .where(
          and(
            eq(matchStats.matchId, matchIdInt),
            eq(matchStats.playerId, playerIdInt),
          ),
        );

      sendJson(socket, {
        type: "STATS_RESPONSE",
        subtype: "PLAYER",
        matchId,
        data: stats || {
          pointsWon: 0,
          winners: 0,
          unforcedErrors: 0,
          smashWinners: 0,
        },
      });
    } else if (subtype === "MATCH_SUMMARY") {
      const [matchData] = await db
        .select()
        .from(matches)
        .where(eq(matches.id, matchIdInt));

      if (!matchData) throw new Error("Match not found");

      // Calcular duración aproximada
      let durationSeconds = 0;
      if (matchData.startTime) {
        const end = matchData.endTime || new Date();
        durationSeconds = Math.floor(
          (end.getTime() - matchData.startTime.getTime()) / 1000,
        );
      }

      sendJson(socket, {
        type: "STATS_RESPONSE",
        subtype: "MATCH_SUMMARY",
        matchId,
        data: {
          id: matchData.id,
          pairAName: matchData.pairAName,
          pairBName: matchData.pairBName,
          pairAGames: matchData.pairAGames,
          pairBGames: matchData.pairBGames,
          pairASets: matchData.pairASets,
          pairBSets: matchData.pairBSets,
          pairAScore: matchData.pairAScore,
          pairBScore: matchData.pairBScore,
          currentSetIdx: matchData.currentSetIdx,
          isTieBreak: matchData.isTieBreak,
          hasGoldPoint: matchData.hasGoldPoint,
          currentScore: {
            sets: `${matchData.pairAGames}-${matchData.pairBGames} (Set ${matchData.currentSetIdx})`,
            points: `${matchData.pairAScore}-${matchData.pairBScore}`,
          },
          durationSeconds,
          status: matchData.status,
          servingPlayerId: matchData.servingPlayerId,
        },
      });
    }
  } catch (error: any) {
    console.error(`[WS]    :: STATS_ERR     ::`, error);
    sendJson(socket, {
      type: "ERROR",
      payload: `Stats Request Failed: ${error.message}`,
    });
  }
}

/**
 * ◼️ FUNCTION: HANDLE_DEVICE_AUTH
 * ---------------------------------------------------------
 * Autentica un dispositivo IoT (Cámara/Mini-PC) mediante token.
 */
async function handleDeviceAuth(
  socket: ServerWebSocket<WebSocketData>,
  payload: ClientMessage & { type: "AUTH_DEVICE" },
) {
  const { token } = payload;
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
  } catch (error: any) {
    console.error(`[IoT]   :: AUTH_ERR      ::`, error);
    sendJson(socket, {
      type: "ERROR",
      payload: "Authentication process failed",
    });
  }
}

/**
 * ◼️ FUNCTION: HANDLE_TELEMETRY_EVENT
 * ---------------------------------------------------------
 * Procesa datos de sensores/cámaras, aplica reglas y genera comentarios.
 */
async function handleTelemetryEvent(
  socket: ServerWebSocket<WebSocketData>,
  payload: ClientMessage & { type: "TELEMETRY_EVENT" },
) {
  // 1. SECURITY CHECK
  if (!socket.data.isDevice || !socket.data.courtId) {
    console.warn(`[IoT]   :: UNAUTHORIZED  :: Telemetry rejected`);
    sendJson(socket, { type: "ERROR", payload: "Unauthorized Device" });
    return;
  }

  const { playerId, stroke, speed, method, isNetPoint } = payload.payload;
  console.log(
    `[IoT]   :: TELEMETRY     :: Court ${socket.data.courtId} | Player ${playerId} | ${method}`,
  );

  try {
    // 2. FIND ACTIVE MATCH
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

    // 3. PROCESS GAME RULES (Controller)
    // Se asume que payload.method mapea a PointMethod (winner, unforced_error...)
    await processPointScored({
      matchId,
      playerId,
      actionType: method as any, // Type casting simple para MVP
      stroke: stroke as any,
      isNetPoint,
    });

    // 4. AUTOMATED COMMENTARY
    // Resolver nombre de jugador para el comentario
    const [player] = await db
      .select()
      .from(players)
      .where(eq(players.id, parseInt(playerId)));

    const playerName = player ? player.name : `Jugador ${playerId}`;

    const commentText = generateAutomatedComment({
      playerName,
      method: method as any,
      stroke: stroke as any,
      speed,
      isNetPoint,
    });

    // 5. SAVE & BROADCAST COMMENTARY
    const [savedComment] = await db
      .insert(commentary)
      .values({
        matchId: parseInt(matchId),
        message: commentText,
        // tags: ["automated", "iot", method || "info"]
      })
      .returning();

    await broadcastCommentary(matchId, savedComment);
    console.log(`[BOT]   :: COMMENTARY    :: ${commentText}`);
  } catch (error: any) {
    console.error(`[IoT]   :: TELEMETRY_ERR ::`, error);
    sendJson(socket, {
      type: "ERROR",
      payload: `Telemetry Error: ${error.message}`,
    });
  }
}

/**
 * ◼️ ROUTER: HANDLE_MATCH_MESSAGE
 * ---------------------------------------------------------
 * Enruta los mensajes entrantes según su 'type'.
 */
function handleMatchMessage(
  socket: ServerWebSocket<WebSocketData>,
  data: string | Buffer,
) {
  let message: ClientMessage;
  try {
    const text = typeof data === "string" ? data : data.toString();
    message = JSON.parse(text);
  } catch (err) {
    const text = typeof data === "string" ? data : data.toString();
    const preview = text.length > 100 ? text.slice(0, 100) + "..." : text;
    console.error(
      `[WS]    :: JSON_PARSE_ERR :: Invalid JSON received:`,
      preview,
    );
    console.error(
      `[WS]    :: HINT          :: Check for semicolons (;) instead of commas (,)`,
    );
    sendJson(socket, {
      type: "ERROR",
      payload: `Invalid JSON format. Check syntax (use commas, not semicolons): ${preview}`,
    });
    return;
  }

  // 1. STATS REQUEST (REQUEST_STATS)
  if (message.type === "REQUEST_STATS") {
    processStatsRequest(socket, message);
    return;
  }

  // 2. SUBSCRIBE
  if (message.type === "SUBSCRIBE") {
    const matchId = String(message.matchId);
    subscribeToMatch(matchId, socket);
    socket.subscribe(matchId); // Bun pub/sub nativo

    // [INIT] -> Enviar snapshot inicial al suscribirse (Warmup)
    getMatchSnapshot(Number(matchId))
      .then((snapshot) => {
        sendJson(socket, {
          type: "MATCH_UPDATE",
          matchId,
          timestamp: Date.now(),
          snapshot,
          lastPoint: null,
        });
      })
      .catch((err) => {
        console.error(`[WS]    :: STATE_FETCH_ERR ::`, err);
        sendJson(socket, {
          type: "ERROR",
          payload: "Failed to fetch match state",
        });
      });

    sendJson(socket, {
      type: "SUBSCRIBED",
      payload: `Subscribed to match ${matchId}`,
    });
    return;
  }

  // 3. UNSUBSCRIBE
  if (message.type === "UNSUBSCRIBE") {
    const matchId = String(message.matchId);
    unsubscribeFromMatch(matchId, socket);
    socket.unsubscribe(matchId);
    sendJson(socket, {
      type: "UNSUBSCRIBED",
      payload: `Unsubscribed from match ${matchId}`,
    });
    return;
  }

  // 4. DEVICE AUTH
  if (message.type === "AUTH_DEVICE") {
    handleDeviceAuth(socket, message);
    return;
  }

  // 5. TELEMETRY EVENT
  if (message.type === "TELEMETRY_EVENT") {
    handleTelemetryEvent(socket, message);
    return;
  }
}

// =============================================================================
// █ UTILITIES: BROADCAST (LOW LEVEL)
// =============================================================================
export async function broadcastToAll(
  topic: string,
  payload: any,
): Promise<void> {
  try {
    const server = serverRef;
    if (!server) {
      // Server not initialized (test environment), skip broadcast
      return;
    }
    server.publish(topic, JSON.stringify(payload));
  } catch (err) {
    console.error(`[WS]    :: BROADCAST_ERR :: topic: ${topic}`, err);
  }
}

export async function broadcastToMatch(
  matchId: string,
  payload: any,
): Promise<void> {
  await broadcastToAll(matchId, payload);
}

// =============================================================================
// █ UTILITIES: BUSINESS LOGIC (HIGH LEVEL)
// =============================================================================

export function sendJson(
  ws: ServerWebSocket<WebSocketData>,
  payload: ServerMessage,
) {
  try {
    const data = JSON.stringify(payload);
    return ws.send(data);
  } catch (error) {
    console.error(`[ERR]   :: JSON_SEND_ERR :: Serialization failed`, {
      payloadType: typeof payload,
      error,
    });
    return 0; // 0 types sent
  }
}

export async function broadcastMatchCreated(match: any): Promise<void> {
  if (!match?.id) {
    throw new Error("[ERR]   :: MATCH_MISSING :: Match not initialized");
  }
  console.log(
    `[WS]    -> BCAST_EVENT   :: type: MATCH_CREATED | id: ${match.id}`,
  );
  await broadcastToAll("global", {
    type: "MATCH_CREATED",
    data: match,
  });
}

export async function broadcastCommentary(
  matchId: string,
  comment: any,
): Promise<void> {
  await broadcastToMatch(matchId, {
    type: "COMMENTARY",
    data: comment,
  });
}
