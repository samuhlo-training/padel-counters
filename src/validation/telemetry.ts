/**
 * █ [VALIDATION] :: TELEMETRY
 * =====================================================================
 * DESC:   Schema de validación para payloads de telemetría IoT.
 *         Rechaza datos mal formados antes de procesar.
 * STATUS: STABLE
 * =====================================================================
 */
import { z } from "zod";
import { PadelStrokeSchema } from "./point_action.ts";

/**
 * ◼️ SCHEMA: POINT_METHOD
 * ---------------------------------------------------------
 * Tipos de resultados posibles de un punto.
 */
export const PointMethodSchema = z.enum([
  "winner",
  "unforced_error",
  "forced_error",
  "service_ace",
  "double_fault",
]);

/**
 * ◼️ SCHEMA: TELEMETRY_PAYLOAD
 * ---------------------------------------------------------
 * Valida los datos que envía un dispositivo IoT (cámara/sensor).
 */
export const telemetryPayloadSchema = z.object({
  playerId: z.string().min(1, "playerId is required"),
  stroke: PadelStrokeSchema.optional(),
  speed: z.number().positive().optional(),
  method: PointMethodSchema.optional(),
  isNetPoint: z.boolean().optional(),
});

export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;
