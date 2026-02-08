/**
 * █ [TYPES] :: DATABASE_MODELS
 * =====================================================================
 * DESC:   Tipos inferidos automáticamente del schema de Drizzle.
 *         Single Source of Truth - NO definir tipos manuales aquí.
 * STATUS: GOLD MASTER
 * =====================================================================
 */
import { type InferSelectModel, type InferInsertModel } from "drizzle-orm";
import {
  players,
  matches,
  courts,
  pointHistory,
  commentary,
  matchSets,
  matchStats,
  matchStatusEnum,
  pointMethodEnum,
  padelStrokeEnum,
} from "../db/schema.ts";

// =============================================================================
// █ MODELOS DE LECTURA (SELECT)
// Tipos con TODAS las columnas. Usar al recuperar datos de la DB.
// =============================================================================

export type Player = InferSelectModel<typeof players>;
export type Match = InferSelectModel<typeof matches>;
export type Court = InferSelectModel<typeof courts>;
export type PointHistory = InferSelectModel<typeof pointHistory>;
export type Commentary = InferSelectModel<typeof commentary>;
export type MatchSet = InferSelectModel<typeof matchSets>;
export type MatchStats = InferSelectModel<typeof matchStats>;

// =============================================================================
// █ MODELOS DE ESCRITURA (INSERT)
// 'id' y 'createdAt' son opcionales (generados por DB).
// =============================================================================

export type NewPlayer = InferInsertModel<typeof players>;
export type NewMatch = InferInsertModel<typeof matches>;
export type NewCourt = InferInsertModel<typeof courts>;
export type NewPointHistory = InferInsertModel<typeof pointHistory>;
export type NewCommentary = InferInsertModel<typeof commentary>;
export type NewMatchSet = InferInsertModel<typeof matchSets>;
export type NewMatchStats = InferInsertModel<typeof matchStats>;

// =============================================================================
// █ ENUMS INFERIDOS
// Derivados directamente del schema para sincronización automática.
// =============================================================================

/** "scheduled" | "warmup" | "live" | "finished" | "canceled" */
export type MatchStatus = (typeof matchStatusEnum.enumValues)[number];

/** "winner" | "unforced_error" | "forced_error" | "service_ace" | "double_fault" */
export type PointMethod = (typeof pointMethodEnum.enumValues)[number];

/** "forehand" | "backhand" | "smash" | "bandeja" | "vibora" | ... */
export type PadelStroke = (typeof padelStrokeEnum.enumValues)[number];
