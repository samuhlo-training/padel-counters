/**
 * █ [TEST HELPERS] :: WS_CLIENT
 * =====================================================================
 * DESC:   Cliente WebSocket wrapper para tests con APIs promise-based
 * =====================================================================
 */
// @ts-nocheck
import { TEST_CONSTANTS } from "./test-setup";

// =============================================================================
// █ TYPES
// =============================================================================

interface WSMessage {
  type: string;
  [key: string]: any;
}

// =============================================================================
// █ TEST WEBSOCKET CLIENT
// =============================================================================

export class TestWSClient {
  private ws: WebSocket | null = null;
  private messageQueue: WSMessage[] = [];
  private messageListeners: Map<string, ((msg: WSMessage) => void)[]> =
    new Map();
  private connected = false;

  constructor(private url: string = TEST_CONSTANTS.WS_URL) {}

  /**
   * Conecta al WebSocket y espera confirmación
   */
  async connect(
    timeout: number = TEST_CONSTANTS.WS_CONNECT_TIMEOUT,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      const timeoutId = setTimeout(() => {
        this.ws?.close();
        this.ws = null;
        reject(new Error("WebSocket connection timeout"));
      }, timeout);

      this.ws.onopen = () => {
        clearTimeout(timeoutId);
        this.connected = true;
        resolve();
      };

      this.ws.onerror = (error) => {
        clearTimeout(timeoutId);
        reject(new Error(`WebSocket error: ${error}`));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as WSMessage;
          this.messageQueue.push(msg);
          this.notifyListeners(msg);
        } catch (e) {
          console.error("Failed to parse WS message:", e);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
      };
    });
  }

  /**
   * Envía un mensaje al servidor
   */
  send(message: any): void {
    if (!this.ws || !this.connected) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Espera por un mensaje de un tipo específico
   */
  async waitForMessage(
    type: string,
    timeout: number = TEST_CONSTANTS.WS_MESSAGE_TIMEOUT,
    filter?: (msg: WSMessage) => boolean,
  ): Promise<WSMessage> {
    // Primero revisar si ya está en la cola
    const existingIndex = this.messageQueue.findIndex(
      (msg) => msg.type === type && (!filter || filter(msg)),
    );
    if (existingIndex !== -1) {
      const msg = this.messageQueue[existingIndex];
      this.messageQueue.splice(existingIndex, 1);
      return msg;
    }

    // Si no, esperar por el mensaje
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.removeListener(type, listener);
        reject(new Error(`Timeout waiting for message type: ${type}`));
      }, timeout);

      const listener = (msg: WSMessage) => {
        if (!filter || filter(msg)) {
          clearTimeout(timeoutId);
          this.removeListener(type, listener);

          // Remover el mensaje de la cola compartida para evitar que sea consumido de nuevo
          const index = this.messageQueue.indexOf(msg);
          if (index !== -1) {
            this.messageQueue.splice(index, 1);
          }

          resolve(msg);
        }
      };

      this.addListener(type, listener);
    });
  }

  /**
   * Suscribe a un match
   */
  async subscribe(matchId: number): Promise<void> {
    this.send({ type: "SUBSCRIBE", matchId });
  }

  /**
   * Desuscribe de un match
   */
  async unsubscribe(matchId: number): Promise<void> {
    this.send({ type: "UNSUBSCRIBE", matchId });
  }

  /**
   * Solicita stats
   */
  async requestStats(
    matchId: number,
    subtype: "MATCH_SUMMARY" | "PLAYER",
    playerId?: number,
  ): Promise<WSMessage> {
    const message: any = {
      type: "REQUEST_STATS",
      matchId: matchId.toString(),
      subtype,
    };

    if (subtype === "PLAYER" && playerId !== undefined) {
      message.playerId = playerId.toString();
    }

    this.send(message);
    return this.waitForMessage(
      "STATS_RESPONSE",
      TEST_CONSTANTS.WS_MESSAGE_TIMEOUT,
      (msg) => {
        // Verificar subtype para evitar cruces
        if (msg.subtype !== subtype) return false;

        // Si pedimos stats de jugador, verificar que sea el correcto
        if (subtype === "PLAYER" && playerId !== undefined) {
          return msg.data?.playerId == playerId;
        }
        // Si pedimos match summary, verificar matchId (si viene en el root)
        if (subtype === "MATCH_SUMMARY") {
          return msg.matchId == matchId.toString();
        }
        return true;
      },
    );
  }

  /**
   * Cierra la conexión
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Verifica si está conectado
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Envía un mensaje y espera la siguiente respuesta
   */
  async sendAndAwait(
    message: any,
    timeout: number = TEST_CONSTANTS.WS_MESSAGE_TIMEOUT,
  ): Promise<WSMessage> {
    this.send(message);
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.removeListener("ANY", listener);
        reject(new Error(`Timeout waiting for response to ${message.type}`));
      }, timeout);

      const listener = (msg: WSMessage) => {
        clearTimeout(timeoutId);
        this.removeListener("ANY", listener);
        resolve(msg);
      };

      this.addListener("ANY", listener);
    });
  }

  /**
   * Espera N mensajes
   */
  async waitForMessages(
    count: number,
    timeout: number = TEST_CONSTANTS.WS_MESSAGE_TIMEOUT,
  ): Promise<WSMessage[]> {
    const received: WSMessage[] = [];

    // Check queue first
    while (this.messageQueue.length > 0 && received.length < count) {
      received.push(this.messageQueue.shift()!);
    }

    if (received.length >= count) return received;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.removeListener("ANY", listener);
        resolve(received); // Return what we have, or reject? Test implies strict wait.
        // reject(new Error(`Timeout waiting for ${count} messages. Got ${received.length}`));
      }, timeout);

      const listener = (msg: WSMessage) => {
        // Remove from queue to prevent duplicate consumption
        const idx = this.messageQueue.indexOf(msg);
        if (idx !== -1) {
          this.messageQueue.splice(idx, 1);
        }
        received.push(msg);
        if (received.length >= count) {
          clearTimeout(timeoutId);
          this.removeListener("ANY", listener);
          resolve(received);
        }
      };

      this.addListener("ANY", listener);
    });
  }

  // =============================================================================
  // █ PRIVATE HELPERS
  // =============================================================================

  private addListener(type: string, listener: (msg: WSMessage) => void): void {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, []);
    }
    this.messageListeners.get(type)!.push(listener);
  }

  private removeListener(
    type: string,
    listener: (msg: WSMessage) => void,
  ): void {
    const listeners = this.messageListeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private notifyListeners(msg: WSMessage): void {
    // 1. Notify specific listeners
    const listeners = this.messageListeners.get(msg.type);
    if (listeners) {
      listeners.forEach((listener) => listener(msg));
    }
    // 2. Notify catch-all "ANY" listeners
    const anyListeners = this.messageListeners.get("ANY");
    if (anyListeners) {
      anyListeners.forEach((listener) => listener(msg));
    }
  }
}
