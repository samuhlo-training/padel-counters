/**
 * █ [TYPES] :: DOMAIN_DEFINITIONS
 * =====================================================================
 * DESC:   Tipos centrales de TypeScript inferidos de la BD y Zod.
 *         Evita duplicar definiciones manuales (Single Source of Truth).
 * STATUS: STABLE
 * =====================================================================
 */
import { type InferSelectModel, type InferInsertModel } from "drizzle-orm";
import { z } from "zod";
import { matches, commentary } from "../db/schema.ts";
import {
  createMatchSchema,
  listMatchesQuerySchema,
} from "../validation/matches.ts";
import { MATCH_STATUS } from "../validation/matches.ts";

// =============================================================================
// █ DATABASE_MODELS (DRIZZLE ORM)
// =============================================================================

/**
 * [MODEL] -> Representación exacta de una fila en la tabla 'matches'.
 * Inferido automáticamente del esquema SQL.
 */
export type Match = InferSelectModel<typeof matches>;

/**
 * [INSERT] -> Tipo requerido para insertar un nuevo partido.
 * Drizzle maneja los campos opcionales/default automáticamente.
 */
export type NewMatch = InferInsertModel<typeof matches>;

/**
 * [MODEL] -> Representación fila tabla 'commentary'.
 */
export type Commentary = InferSelectModel<typeof commentary>;

/**
 * [INSERT] -> Datos para insertar un comentario nuevo.
 */
export type NewCommentary = InferInsertModel<typeof commentary>;

// =============================================================================
// █ API_DTOs (ZOD INFERRED)
// =============================================================================

/**
 * [DTO] -> Input validado para crear un partido.
 */
export type CreateMatchInput = z.infer<typeof createMatchSchema>;

/**
 * [DTO] -> Query params validados para listados.
 */
export type ListMatchesQuery = z.infer<typeof listMatchesQuerySchema>;

// =============================================================================
// █ DOMAIN_TYPES
// =============================================================================

/**
 * [UNION TYPE] -> Valores permitidos: "scheduled" | "live" | "finished".
 * Derivado de la constante para evitar desincronización.
 */
export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];

/**
 * [INTERFACE] -> Extensión del modelo base para respuestas enriquecidas.
 * Útil para enviar datos al frontend con relaciones (ej. comentarios).
 */
export interface MatchDetails extends Match {
  // commentary?: Commentary[];
}
