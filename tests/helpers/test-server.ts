/**
 * █ [TEST HELPER] :: TEST_SERVER
 * =====================================================================
 * DESC:   Utilidad para levantar servidor de tests con WebSocket
 * =====================================================================
 */
// @ts-nocheck
import { app } from "../../src/index";
import { websocketHandler } from "../../src/ws/server";
import { setServerRef } from "../../src/ws/server";
import type { Server } from "bun";

let testServer: Server | null = null;
let startTestServerPromise: Promise<Server> | null = null;
const TEST_PORT = 8000;

/**
 * Inicia servidor de test con un guardia de promesa para evitar condiciones de carrera
 */
export async function startTestServer(): Promise<Server> {
  // 1. Si ya existe el servidor, devolverlo
  if (testServer) return testServer;

  // 2. Si ya hay una inicialización en curso, esperarla
  if (startTestServerPromise) return startTestServerPromise;

  // 3. Iniciar secuencia de arranque
  startTestServerPromise = (async () => {
    try {
      testServer = Bun.serve({
        port: TEST_PORT,
        fetch: app.fetch,
        websocket: websocketHandler,
      });

      setServerRef(testServer);
      console.log(`✅ Test server started on http://localhost:${TEST_PORT}`);
      return testServer;
    } finally {
      // Limpiar la promesa tanto si tiene éxito como si falla
      startTestServerPromise = null;
    }
  })();

  return startTestServerPromise;
}

/**
 * Detiene servidor de test
 */
export async function stopTestServer(): Promise<void> {
  if (testServer) {
    testServer.stop();
    testServer = null;
    setServerRef(null);
    console.log(`🛑 Test server stopped`);
  }
}

/**
 * Obtiene puerto del servidor de test
 */
export function getTestServerPort(): number {
  return TEST_PORT;
}

/**
 * Obtiene URL base del servidor de test
 */
export function getTestServerUrl(): string {
  return `http://localhost:${TEST_PORT}`;
}

/**
 * Obtiene URL de WebSocket del servidor de test
 */
export function getTestServerWsUrl(): string {
  return `ws://localhost:${TEST_PORT}/ws`;
}
