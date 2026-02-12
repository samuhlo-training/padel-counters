/**
 * █ [CORE] :: WEBSOCKET_UTILS
 * =====================================================================
 * DESC:   Herramientas compartidas para handlers de WebSocket.
 *         Incluye envío de mensajes, broadcast y referencia al servidor.
 * STATUS: STABLE
 * =====================================================================
 */
import type { ServerWebSocket, Server } from "bun";
import type { WebSocketData, ServerMessage } from "../types/index.ts";

// =============================================================================
// █ GLOBAL STATE: SERVER REFERENCE
// =============================================================================

/**
 * [SINGLETON] -> Referencia al servidor Bun para broadcast externo.
 * Permite publicar eventos desde cualquier parte (ej: Controllers REST).
 */
let serverRef: Server<WebSocketData> | null = null;

export function setServerRef(server: Server<WebSocketData>) {
  console.log(`[SYS]   ++ REF_LINKED    :: WebSocket Server instance stored`);
  serverRef = server;
}

export function getServerRef(): Server<WebSocketData> | null {
  return serverRef;
}

// =============================================================================
// █ UTILITIES: SEND & BROADCAST
// =============================================================================

/**
 * ◼️ FUNCTION: SEND_JSON
 * ---------------------------------------------------------
 * Envía un mensaje tipado a un socket individual.
 */
export function sendJson(
  ws: ServerWebSocket<WebSocketData>,
  payload: ServerMessage,
): number {
  try {
    const data = JSON.stringify(payload);
    return ws.send(data);
  } catch (error) {
    console.error(`[ERR]   :: JSON_SEND_ERR :: Serialization failed`, {
      payloadType: typeof payload,
      error,
    });
    return 0;
  }
}

/**
 * ◼️ FUNCTION: BROADCAST_TO_ALL
 * ---------------------------------------------------------
 * Publica un mensaje a todos los suscriptores de un topic.
 */
export async function broadcastToAll(
  topic: string,
  payload: unknown,
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

/**
 * ◼️ FUNCTION: BROADCAST_TO_MATCH
 * ---------------------------------------------------------
 * Alias para broadcast a un partido específico.
 */
export async function broadcastToMatch(
  matchId: string,
  payload: unknown,
): Promise<void> {
  await broadcastToAll(matchId, payload);
}

// =============================================================================
// █ UTILITIES: BUSINESS LOGIC (HIGH LEVEL)
// =============================================================================

// DEPRECATED: broadcastMatchCreated removed. Use broadcastCourtUpdate.

/**
 * ◼️ FUNCTION: BROADCAST_COMMENTARY
 * ---------------------------------------------------------
 * Envía un comentario a todos los espectadores de un partido.
 */
export async function broadcastCommentary(
  matchId: string,
  comment: unknown,
): Promise<void> {
  await broadcastToMatch(matchId, {
    type: "COMMENTARY",
    data: comment,
  });
}

/**
 * ◼️ FUNCTION: BROADCAST_COURT_UPDATE
 * ---------------------------------------------------------
 * Notifica que una pista ha cambiado de estado (busy/free).
 */
export async function broadcastCourtUpdate(
  courtId: number | string,
  status: "busy" | "free",
  activeMatchId: number | null,
  startTime?: Date | string | null, // Added startTime
): Promise<void> {
  console.log(
    `[WS]    -> BCAST_EVENT   :: type: COURT_UPDATE | court: ${courtId} | status: ${status}`,
  );
  await broadcastToAll("global", {
    type: "COURT_UPDATE",
    payload: {
      courtId,
      status,
      activeMatchId,
      startTime,
    },
  });
}
