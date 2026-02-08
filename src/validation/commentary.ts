/**
 * █ [VALIDATION] :: COMMENTARY_SCHEMAS
 * =====================================================================
 * DESC:   Define las reglas de validación para la gestión de comentarios.
 *         Evita inyección de datos basura en el feed en vivo.
 * STATUS: STABLE
 * =====================================================================
 */
import { z } from "zod";

/**
 * ◼️ SCHEMA: CREATE_COMMENTARY
 * ---------------------------------------------------------
 * Reglas para validar el payload de un nuevo comentario (POST).
 * [CONTEXTO] -> Se puede enviar set/game manual, o dejar que el backend lo infiera.
 */
export const createCommentarySchema = z.object({
  // override opcional del momento del partido (Set/Juego)
  setNumber: z.coerce.number().int().min(1).optional(),
  gameNumber: z.coerce.number().int().min(1).optional(),

  // [CONTENT] -> El mensaje visible. Mínimo 1 caracter.
  message: z.string().trim().min(1).max(5000),

  // [TAGS] -> Etiquetas para filtrado (ej: "GOLAZO", "POLEMICA")
  tags: z.array(z.string()).optional(),

  // [EXTRA] -> Datos crudos adicionales (JSON libre)
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * ◼️ SCHEMA: QUERY_PARAMS
 * ---------------------------------------------------------
 * Valida los parámetros de búsqueda para listar comentarios (GET).
 */
export const listCommentaryQuerySchema = z.object({
  // [PROTECCION] -> Limitamos a 100 para evitar saturar el cliente/red.
  limit: z.coerce.number().int().positive().max(100).optional(),
});
