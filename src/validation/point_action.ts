/**
 * █ [VALIDATION] :: POINT_ACTION
 * =====================================================================
 * DESC:   Define los esquemas para validar acciones de juego (puntos).
 *         Centraliza los tipos de golpes y resultados permitidos.
 * STATUS: STABLE
 * =====================================================================
 */
import { z } from "zod";

/**
 * ◼️ ENUM: PADEL_STROKES
 * ---------------------------------------------------------
 * Catálogo completo de golpes técnicos de pádel.
 * [INFO] -> Usado para métricas avanzadas (ej: % ganados con Bandeja).
 */
export const PadelStrokeSchema = z.enum([
  "forehand", // Drive (Golpe de derecha)
  "backhand", // Revés
  "smash", // Remate (Potencia)
  "bandeja", // Bandeja (Técnico defensivo/ofensivo)
  "vibora", // Víbora (Efecto lateral)
  "volley_forehand", // Volea de derecha
  "volley_backhand", // Volea de revés
  "lob", // Globo (Defensivo)
  "drop_shot", // Dejada (Sorpresa)
  "wall_boast", // Contrapared (Recurso)
]);

/**
 * ◼️ SCHEMA: POINT_ACTION
 * ---------------------------------------------------------
 * Payload principal para registrar un punto en tiempo real.
 */
export const pointActionSchema = z.object({
  // [ID] -> Identificador del jugador asociado a la acción (ganador o error)
  playerId: z.coerce.number().int().positive(),

  // [RESULTADO] -> Clasificación del punto.
  // winner/ace = mérito propio.
  // errors = demérito propio (punto para el rival).
  actionType: z.enum([
    "winner",
    "unforced_error",
    "forced_error",
    "service_ace",
    "double_fault",
  ]),

  // [DETALLE] -> Qué golpe técnico se usó (Opcional).
  stroke: PadelStrokeSchema.optional(),

  // [METADATA] -> Contexto táctico
  isNetPoint: z.boolean().default(false), // ¿Ganó el punto estando en la red?
});
