/**
 * █ [CORE] :: HTTP_ENTRY_POINT
 * =====================================================================
 * DESC:   Punto de entrada principal para el Backend de Padel Counters.
 *         Orquesta Hono (Router), Bun (Server) y Upstash (Redis).
 * STATUS: STABLE
 * =====================================================================
 */
import { Hono } from "hono";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { matchesApp } from "./routes/matches.ts";
import {
  websocketHandler,
  type WebSocketData,
  setServerRef,
} from "./ws/server.ts";
import { commentaryApp } from "./routes/commentary.ts";

// =============================================================================
// █ CONFIG: ENTORNO
// =============================================================================
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || "0.0.0.0";

// =============================================================================
// █ INFRA: UPSTASH REDIS (RATE LIMITING)
// =============================================================================
// 1. CLIENTE DE CONEXIÓN
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
  throw new Error("Missing Upstash Redis credentials");
}

// 1. CLIENT CONNECTION
const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

// 2. LIMITER STRATEGY (SLIDING WINDOW)
// POLICY: 5 requests every 10 seconds per IP.
// MOTIVO: Prevenir el abuso de conexiones WebSocket.
const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, "10 s"),
});

// =============================================================================
// █ APP: HONO ROUTER
// =============================================================================
export const app = new Hono();

// [MIDDLEWARE] -> Global Request Logger
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  console.log(
    `[HTTP]  :: INCOMING_REQ  :: method: ${c.req.method} | path: ${url.pathname}`,
  );
  await next();
});

/**
 * ◼️ MIDDLEWARE: RATE LIMITER PROTECTOR
 * ---------------------------------------------------------
 * Intercepta peticiones /ws para aplicar límites antes del handshake.
 * Estrategia: Verificar IP contra Redis.
 */
app.use("/ws", async (c, next) => {
  // A. IDENTIFICAR -> Obtener IP del cliente
  // [TEST_ENV] -> Skip rate limiting in test environment
  if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
    await next();
    return;
  }

  let ip =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim();

  if (!ip) {
    const server = c.env as unknown as import("bun").Server<WebSocketData>;
    const socketIp = server?.requestIP(c.req.raw)?.address;

    if (!socketIp) {
      console.error(
        `[ERR]   :: IP_UNKNOWN    :: Cannot identify client IP. Rejecting request.`,
      );
      return c.text("Unable to identify client", 400);
    }

    ip = socketIp;

    console.warn(
      `[WARN]  :: IP_FALLBACK   :: Missing proxy headers. Using socket IP: ${socketIp}`,
    );
  }

  // [SECURITY] -> Limit length (IPv6 max 45 chars)
  ip = (ip || "127.0.0.1").slice(0, 45);

  // B. VERIFICAR -> Pedir permiso a Redis
  let limitResult;
  try {
    limitResult = await ratelimit.limit(ip);
  } catch (error) {
    console.error(
      `[ERR]   :: RATELIMIT_ERR :: ip: ${ip} | Fail-open applied`,
      error,
    );
    // Fail-open: allow the request if rate limiting service is down
    // [RESILIENCE] -> Si Redis falla, no bloqueamos el servicio (Fail-open)
    limitResult = { success: true, remaining: Infinity };
  }

  const { success, remaining } = limitResult;

  if (!success) {
    console.log(`[SEC]   :: RATE_LIMITED  :: ip: ${ip} | ACTION: BLOCKED`);
    return c.text("ERROR: Rate limit exceeded. Relax.", 429);
  }

  // D. PERMITIR -> Continue handshake
  await next();
});

// [RUTAS] -> Montar Sub-Aplicaciones
app.route("/matches", matchesApp);
app.route("/matches", commentaryApp);
// [EXPLICACIÓN] -> ¿Por qué "/matches" y no "/commentary"?
// Esto monta las rutas de comentarios bajo "/matches".
// Resultado final: "/matches/:id/commentary" (Jerarquía RESTful lógica).

// [VITALIDAD] (HEALTH CHECK)
app.get("/", (c) => {
  return c.json({
    status: "online",
    system: "Hono + Bun + TypeScript",
    message: "Padel Counters API is operational 🚀",
  });
});

/**
 * ◼️ ENDPOINT: WEBSOCKET HANDSHAKE
 * ---------------------------------------------------------
 * Destino final para las peticiones /ws.
 * 1. El Middleware ya validó el Rate Limit.
 * 2. Se procede al upgrade de HTTP a WebSocket.
 */
app.get("/ws", (c) => {
  // Bun.serve pasa la instancia 'server' como 'env' a Hono.
  const server = c.env as unknown as import("bun").Server<WebSocketData>;

  // [DEFENSIVO] -> Validar que 'server' y 'upgrade' existan (Evita crash si no es Bun)
  if (!server || typeof server.upgrade !== "function") {
    console.error(
      "[ERR]   :: WS_UPGRADE    :: server or upgrade method missing in environment",
    );
    return c.text("WebSocket upgrade failed", 500);
  }

  if (server.upgrade(c.req.raw, { data: { createdAt: Date.now() } })) {
    // Return empty Response. Bun handles the native socket upgrade.
    return new Response(null);
  }

  return c.text("WebSocket upgrade failed", 500);
});

/**
 * █ [CRITICAL] :: AUTO_START
 * ---------------------------------------------------------
 * Solo iniciamos el servidor automáticamente si NO estamos en entorno de tests.
 * En tests, el orquestador (test-server.ts) se encarga de levantarlo.
 */
if (process.env.NODE_ENV !== "test" && process.env.BUN_ENV !== "test") {
  const server = Bun.serve<WebSocketData>({
    port: PORT,
    hostname: HOST,
    fetch: app.fetch,
    websocket: websocketHandler,
  });

  setServerRef(server);

  const baseUrl =
    HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;

  console.log(`[SYS]   ++ HTTP_READY    :: ${baseUrl}`);
  console.log(
    `[SYS]   ++ WS_READY      :: ${baseUrl.replace("http", "ws")}/ws`,
  );
}
