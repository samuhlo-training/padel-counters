/**
 * █ [API_ROUTE] :: COMMENTARY_HANDLER
 * =====================================================================
 * DESC:   Gestiona el minuto a minuto (Live Events) de los partidos.
 *         Permite crear eventos y listarlos en tiempo real.
 * STATUS: STABLE
 * =====================================================================
 */
import { Hono } from "hono";
import { db } from "../db/db.ts";
import { commentary, matches } from "../db/schema.ts";
import {
  createCommentarySchema,
  listCommentaryQuerySchema,
} from "../validation/commentary.ts";
import { matchIdParamSchema } from "../validation/matches.ts";
import { desc, eq } from "drizzle-orm";
import { broadcastCommentary } from "../ws/server.ts";

// =============================================================================
// █ CONFIG: ROUTER SETUP
// =============================================================================
// [INFO] -> Usamos Hono para este router por su simplicidad y speed.
export const commentaryApp = new Hono();

/**
 * ◼️ ENDPOINT: CHECK_STATUS
 * ---------------------------------------------------------
 * DESC: Verifica que el router de comentarios esté montado correctamente.
 * PATH: GET /commentary/
 */
commentaryApp.get("/", (c) => {
  return c.json({
    message: "Commentary API is operational 🚀",
  });
});

// =============================================================================
// █ ENDPOINT: GET /:id
// =============================================================================
// DESC: Obtiene el feed de comentarios de un partido específico.
commentaryApp.get("/:id/commentary", async (c) => {
  // 1. VALIDATION: PARAMS (URL)
  const paramsResult = matchIdParamSchema.safeParse(c.req.param());
  if (!paramsResult.success) {
    return c.json(
      { error: "Invalid Match ID", details: paramsResult.error },
      400,
    );
  }
  const matchId = paramsResult.data.id;

  // 2. VALIDATION: QUERY (FILTERS)
  const queryResult = listCommentaryQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json(
      { error: "Invalid Query Parameters", details: queryResult.error },
      400,
    );
  }

  // [LIMIT] -> Protección contra 'heavy queries'. Default 100.
  const limit = Math.min(queryResult.data.limit ?? 100, 100);

  try {
    // 3. DB QUERY
    // Buscamos comentarios por matchId, ordenados por fecha (más nuevos primero).
    const data = await db
      .select()
      .from(commentary)
      .where(eq(commentary.matchId, matchId))
      .orderBy(desc(commentary.createdAt))
      .limit(limit);

    return c.json({ data });
  } catch (error) {
    console.error(`[ERR]   :: GET_COMMENTARY_ERR :: ${error}`);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// =============================================================================
// █ ENDPOINT: POST /:id
// =============================================================================
// DESC: Agrega un nuevo evento (gol, tarjeta, etc.) al feed del partido.
//       Y lo retransmite vía WebSocket.
commentaryApp.post("/:id/commentary", async (c) => {
  // 1. VALIDATION: PARAMS
  const paramsResult = matchIdParamSchema.safeParse(c.req.param());
  if (!paramsResult.success) {
    return c.json(
      { error: "Invalid Match ID", details: paramsResult.error },
      400,
    );
  }
  const matchId = paramsResult.data.id;

  // 2. VALIDATION: BODY
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const bodyResult = createCommentarySchema.safeParse(body);
  if (!bodyResult.success) {
    return c.json(
      { error: "Validation failed", details: bodyResult.error },
      400,
    );
  }

  const commentaryData = bodyResult.data;

  try {
    // 3. AUTOMATIC CONTEXT (Contexto Automático)
    // [EXPLICACION] -> Si el comentario no trae set/juego explícito, lo tomamos del partido.
    // Esto es vital para mantener la coherencia cronológica en el feed.
    const [existingMatch] = await db
      .select({
        set: matches.currentSetIdx,
        pairAGames: matches.pairAGames,
        pairBGames: matches.pairBGames,
      })
      .from(matches)
      .where(eq(matches.id, matchId));

    if (!existingMatch) {
      return c.json({ error: "Match not found" }, 404);
    }

    // Calculamos el gameNumber actual (Suma de juegos + 1 para el actual)
    const currentGameNumber =
      (existingMatch.pairAGames ?? 0) + (existingMatch.pairBGames ?? 0) + 1;

    // 4. PERSISTENCE
    console.log(`[DB]    >> INSERTING COMMENTARY :: matchId: ${matchId}`);

    const [newCommentary] = await db
      .insert(commentary)
      .values({
        matchId,
        message: commentaryData.message,
        tags: commentaryData.tags,
        // Solo asignar si el usuario los proveyó explícitamente
        // Comentarios generales pueden no tener set/game específico
        setNumber: commentaryData.setNumber ?? null,
        gameNumber: commentaryData.gameNumber ?? null,
      })
      .returning();

    if (!newCommentary) {
      return c.json({ error: "Failed to create commentary" }, 500);
    }

    // [SUCCESS] -> Feedback en consola
    console.log(`[DB]    ++ SAVED COMMENTARY     :: id: ${newCommentary.id}`);

    // 5. REAL-TIME BROADCAST
    // [WS] -> Enviamos el comentario a todos los suscritos a este partido.
    // Usamos Promise.resolve().then(...).catch(...) para capturar tanto errores síncronos como asíncronos.
    Promise.resolve()
      .then(() => broadcastCommentary(String(matchId), newCommentary))
      .catch((wsError) => {
        console.warn(`[WARN]  :: BCAST_FAIL    :: match: ${matchId}`, wsError);
      });

    return c.json({ data: newCommentary }, 201);
  } catch (error) {
    console.error(`[ERR]   :: CREATE_COMMENTARY_ERR :: ${error}`);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});
