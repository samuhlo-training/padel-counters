/**
 * █ [TEST HELPERS] :: TEST_SETUP
 * =====================================================================
 * DESC:   Utilidades compartidas para setup/cleanup de tests
 * =====================================================================
 */
import { startTestServer } from "./test-server";

// [AUTO_START] :: Ensure server is running for tests
await startTestServer();

// =============================================================================
// █ WAIT UTILITIES
// =============================================================================

/**
 * Espera hasta que una condición se cumpla o timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  checkInterval: number = 100,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  return false;
}

/**
 * Ejecuta una aserción eventualmente (útil para tests asíncronos)
 */
export async function expectEventually<T>(
  fn: () => T | Promise<T>,
  timeout: number = 5000,
): Promise<T> {
  const startTime = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startTime < timeout) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError || new Error("expectEventually timed out");
}

// =============================================================================
// █ TEST CONSTANTS
// =============================================================================

export const TEST_CONSTANTS = {
  BASE_URL: "http://localhost:8000",
  WS_URL: "ws://localhost:8000/ws",
  DEFAULT_TIMEOUT: 5000,
  WS_CONNECT_TIMEOUT: 5000,
  WS_MESSAGE_TIMEOUT: 3000,
};

// =============================================================================
// █ DELAY HELPER
// =============================================================================

/**
 * Simple delay helper
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
