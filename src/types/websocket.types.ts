/**
 * █ [TYPES] :: WEBSOCKET_PROTOCOL
 * =====================================================================
 * DESC:   Tipos para el protocolo de mensajería WebSocket.
 *         Define contratos Client→Server y Server→Client.
 * STATUS: STABLE
 * =====================================================================
 */

// =============================================================================
// █ SOCKET METADATA
// =============================================================================

/**
 * [DATA] -> Metadata adjunta a cada conexión WebSocket.
 * Identifica dispositivos IoT autenticados y sus pistas asociadas.
 */
export type WebSocketData = {
  createdAt?: number;
  channelId?: string;
  courtId?: number; // ID de la pista si es un dispositivo autenticado
  isDevice?: boolean; // Flag para identificar si es una cámara/IoT
};

// =============================================================================
// █ CLIENT -> SERVER MESSAGES
// =============================================================================

/**
 * [PROTOCOL] -> Mensajes que aceptamos del frontend y dispositivos IoT.
 * Cada tipo tiene su payload específico.
 */
export type ClientMessage =
  | { type: "SUBSCRIBE"; matchId: string }
  | { type: "UNSUBSCRIBE"; matchId: string }
  | {
      type: "REQUEST_STATS";
      matchId: string;
      subtype: "PLAYER" | "MATCH_SUMMARY";
      playerId?: string;
    }
  // [IoT / CAMERA SPECIFIC]
  | { type: "AUTH_DEVICE"; token: string }
  | {
      type: "TELEMETRY_EVENT";
      payload: {
        playerId: string;
        stroke?: string;
        speed?: number;
        method?: string; // "winner", "error", etc.
        isNetPoint?: boolean;
      };
    };

// =============================================================================
// █ SERVER -> CLIENT MESSAGES
// =============================================================================

/**
 * [PROTOCOL] -> Respuestas y eventos que emitimos a los clientes.
 */
export type ServerMessage =
  | { type: "WELCOME"; payload: string }
  | { type: "ERROR"; payload: string }
  | { type: "SUBSCRIBED"; payload: string }
  | { type: "UNSUBSCRIBED"; payload: string }
  | { type: "AUTH_SUCCESS"; courtName: string }
  | {
      type: "MATCH_UPDATE";
      matchId: string;
      timestamp: number;
      snapshot: unknown;
      lastPoint: unknown;
    }
  | { type: "COMMENTARY"; data: unknown }
  | { type: "MATCH_CREATED"; data: unknown }
  | {
      type: "STATS_RESPONSE";
      subtype: "PLAYER" | "MATCH_SUMMARY";
      matchId: string;
      data: unknown;
    };
