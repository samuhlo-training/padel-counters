/**
 * █ [CORE] :: WEBSOCKET_SERVER
 * =====================================================================
 * DESC:   "El Recepcionista" - Solo conecta y enruta mensajes.
 *         La lógica de negocio está delegada a handlers especializados.
 * STATUS: STABLE
 * =====================================================================
 */
import type { ServerWebSocket } from "bun";
import type {
  WebSocketData,
  ClientMessage,
  ServerMessage,
} from "../types/index.ts";
import { sendJson, setServerRef } from "./utils.ts";

// [HANDLERS] -> Los especialistas que hacen el trabajo real
import * as IoT from "./handlers/iot.ts";
import * as Stats from "./handlers/stats.ts";
import * as Subs from "./handlers/subscription.ts";

// Re-export tipos y utils para compatibilidad con código existente
export type { WebSocketData, ClientMessage, ServerMessage };
export { setServerRef };
export {
  broadcastToAll,
  broadcastToMatch,
  broadcastCommentary,
  broadcastCourtUpdate,
} from "./utils.ts";

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

    // [GLOBAL CHANNEL] -> Todos escuchan eventos globales (ej: nuevo partido creado)
    ws.subscribe("global");

    // [ACK] -> Saludo inicial para confirmar conexión
    sendJson(ws, {
      type: "WELCOME",
      payload: "Conectado a Padel Counters Real-Time API",
    });
  },

  /**
   * ◼️ EVENT: MESSAGE
   * ---------------------------------------------------------
   * Router principal - deriva a handlers especializados.
   */
  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    // [LOG] -> Preview del mensaje para debug
    const msgPreview =
      typeof message === "string"
        ? `${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`
        : `<Buffer ${message.byteLength} bytes>`;
    console.log(`[WS]    << MSG_RECV      :: preview: ${msgPreview}`);

    // [PARSE] -> JSON validation
    let data: ClientMessage;
    try {
      const text = typeof message === "string" ? message : message.toString();
      data = JSON.parse(text);
    } catch (err) {
      const text = typeof message === "string" ? message : message.toString();
      const preview = text.length > 100 ? text.slice(0, 100) + "..." : text;
      console.error(
        `[WS]    :: JSON_PARSE_ERR :: Invalid JSON received:`,
        preview,
      );
      sendJson(ws, {
        type: "ERROR",
        payload: `Invalid JSON format. Check syntax: ${preview}`,
      });
      return;
    }

    // 🚦 ROUTER -> Switch case para enrutar a handlers
    switch (data.type) {
      case "AUTH_DEVICE":
        IoT.handleDeviceAuth(ws, data);
        break;

      case "TELEMETRY_EVENT":
        IoT.handleTelemetryEvent(ws, data);
        break;

      case "REQUEST_STATS":
        Stats.processStatsRequest(ws, data);
        break;

      case "SUBSCRIBE":
        Subs.handleSubscribe(ws, data.matchId);
        break;

      case "UNSUBSCRIBE":
        Subs.handleUnsubscribe(ws, data.matchId);
        break;

      default:
        console.warn(
          `[WS]    :: UNKNOWN_TYPE  :: ${(data as { type: string }).type}`,
        );
        sendJson(ws, {
          type: "ERROR",
          payload: `Unknown message type: ${(data as { type: string }).type}`,
        });
    }
  },

  /**
   * ◼️ EVENT: CLOSE
   * ---------------------------------------------------------
   * Limpieza al cerrar conexión.
   */
  close(ws: ServerWebSocket<WebSocketData>) {
    console.log(`[WS]    :: DISCONNECTED  :: ip: ${ws.remoteAddress}`);
    ws.unsubscribe("global");
    Subs.handleDisconnect(ws);
  },
};
