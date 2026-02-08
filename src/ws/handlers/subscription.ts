/**
 * █ [HANDLER] :: SUBSCRIPTIONS
 * =====================================================================
 * DESC:   Gestión de suscripciones a partidos en tiempo real.
 * STATUS: STABLE
 * =====================================================================
 */
import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "../../types/index.ts";
import { sendJson } from "../utils.ts";
import { getMatchSnapshot } from "../../controllers/match.ts";

// =============================================================================
// █ INTERNAL STATE: SUBSCRIBERS MAP
// =============================================================================

/**
 * [MAP] -> Tracking fino de suscriptores por partido.
 * Complementa el pub/sub nativo de Bun para operaciones granulares.
 */
const matchSubscribers = new Map<string, Set<ServerWebSocket<WebSocketData>>>();

// =============================================================================
// █ HANDLER: SUBSCRIBE
// =============================================================================

/**
 * ◼️ FUNCTION: HANDLE_SUBSCRIBE
 * ---------------------------------------------------------
 * Suscribe un socket a un partido y envía snapshot inicial.
 */
export async function handleSubscribe(
  socket: ServerWebSocket<WebSocketData>,
  matchId: string,
): Promise<void> {
  const matchIdStr = String(matchId);

  // 1. VALIDACIÓN: Verificar que matchIdStr sea un número válido antes de cualquier operación
  const matchIdInt = Number.parseInt(matchIdStr, 10);
  if (!Number.isInteger(matchIdInt) || Number.isNaN(matchIdInt)) {
    console.error(
      `[WS]    :: SUBSCRIBE_ERR :: Invalid matchId: "${matchIdStr}"`,
    );
    sendJson(socket, {
      type: "ERROR",
      payload: `Invalid matchId: "${matchIdStr}". Must be a valid integer.`,
    });
    return;
  }

  // 2. Add to local map (ONLY IF VALID)
  if (!matchSubscribers.has(matchIdStr)) {
    matchSubscribers.set(matchIdStr, new Set());
  }
  matchSubscribers.get(matchIdStr)!.add(socket);

  // 3. Subscribe to Bun pub/sub topic (ONLY IF VALID)
  socket.subscribe(matchIdStr);

  // 4. Send initial snapshot (Warmup)
  try {
    const snapshot = await getMatchSnapshot(matchIdInt);
    sendJson(socket, {
      type: "MATCH_UPDATE",
      matchId: matchIdStr,
      timestamp: Date.now(),
      snapshot,
      lastPoint: null,
    });
  } catch (err) {
    console.error(`[WS]    :: STATE_FETCH_ERR ::`, err);
    sendJson(socket, {
      type: "ERROR",
      payload: "Failed to fetch match state",
    });
    // Si falla el fetch, tal vez queramos desuscribirnos para no quedar en estado inconsistente
    // pero el matchId es válido, así que la suscripción pub/sub es técnicamente correcta para futuros updates.
  }

  // 5. Confirm subscription
  sendJson(socket, {
    type: "SUBSCRIBED",
    payload: `Subscribed to match ${matchIdStr}`,
  });
}

// =============================================================================
// █ HANDLER: UNSUBSCRIBE
// =============================================================================

/**
 * ◼️ FUNCTION: HANDLE_UNSUBSCRIBE
 * ---------------------------------------------------------
 * Desuscribe un socket de un partido.
 */
export function handleUnsubscribe(
  socket: ServerWebSocket<WebSocketData>,
  matchId: string,
): void {
  const matchIdStr = String(matchId);

  // Remove from local map
  const subscribers = matchSubscribers.get(matchIdStr);
  if (subscribers) {
    subscribers.delete(socket);
    if (subscribers.size === 0) {
      matchSubscribers.delete(matchIdStr);
    }
  }

  // Unsubscribe from Bun pub/sub
  socket.unsubscribe(matchIdStr);

  sendJson(socket, {
    type: "UNSUBSCRIBED",
    payload: `Unsubscribed from match ${matchIdStr}`,
  });
}

// =============================================================================
// █ HANDLER: DISCONNECT
// =============================================================================

/**
 * ◼️ FUNCTION: HANDLE_DISCONNECT
 * ---------------------------------------------------------
 * Limpia todas las suscripciones al cerrar conexión.
 */
export function handleDisconnect(socket: ServerWebSocket<WebSocketData>): void {
  for (const [matchId, sockets] of matchSubscribers.entries()) {
    if (sockets.has(socket)) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        matchSubscribers.delete(matchId);
      }
    }
  }
}
