/**
 * █ [UTILS] :: MATCH_STATUS_LOGIC
 * =====================================================================
 * DESC:   Lógica pura para determinar el estado de un partido basado
 *         en el tiempo. Centraliza esta regla de negocio crítica.
 * STATUS: STABLE
 * =====================================================================
 */
import { MATCH_STATUS } from "../validation/matches.ts";
import type { Match, MatchStatus } from "../types/matches.types.ts";

/**
 * ◼️ CALCULATE_STATUS
 * ---------------------------------------------------------
 * Compara fecha actual vs start/end para devolver el estado.
 * PURE_FUNCTION: No tiene efectos secundarios, solo calcula.
 */
export function getMatchStatus(
  startTime: Date | string,
  endTime: Date | string,
  now = new Date(),
): MatchStatus | null {
  const start = new Date(startTime);
  const end = new Date(endTime);

  // [SAFETY_CHECK] -> Validación preventiva de fechas inválidas
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  // REGLA: Si no empezó -> SCHEDULED
  if (now < start) {
    return MATCH_STATUS.SCHEDULED;
  }

  // REGLA: Si ya terminó -> FINISHED
  if (now >= end) {
    return MATCH_STATUS.FINISHED;
  }

  // REGLA: En cualquier otro caso -> LIVE
  return MATCH_STATUS.LIVE;
}

/**
 * ◼️ SYNC_STATUS (MUTABLE / ASYNC)
 * ---------------------------------------------------------
 * Actualiza el estado de un objeto Match si ha cambiado.
 * Útil para workers o crons que revisan partidos en vivo.
 */
export async function syncMatchStatus(
  match: Match,
  updateStatus: (status: MatchStatus) => Promise<void>,
): Promise<MatchStatus> {
  // [SAFETY_CHECK] -> Validación explícita antes de calcular
  if (!match.startTime || !match.endTime) {
    const isValid = Object.values(MATCH_STATUS).includes(match.status as any);

    // [PERSISTENCIA] -> Si el estado es inválido o falta, forzamos SCHEDULED y guardamos
    if (!isValid) {
      const fallbackStatus = MATCH_STATUS.SCHEDULED;
      const previousStatus = match.status;
      (match as any).status = fallbackStatus;
      try {
        await updateStatus(fallbackStatus);
      } catch (error) {
        (match as any).status = previousStatus; // rollback
        throw error;
      }
    }

    return match.status as MatchStatus;
  }

  const nextStatus = getMatchStatus(match.startTime, match.endTime);

  if (!nextStatus) {
    // [VALIDATION] -> Verificar que match.status sea un valor válido antes de devolverlo
    const isValidStatus = Object.values(MATCH_STATUS).includes(
      match.status as any,
    );

    // Si el estado actual es válido, lo mantenemos; de lo contrario, devolvemos un fallback seguro
    return isValidStatus
      ? (match.status as MatchStatus)
      : MATCH_STATUS.SCHEDULED;
  }

  // [OPTIMIZATION] -> Solo actualizamos si hubo cambio real
  if (match.status !== nextStatus) {
    const previousStatus = match.status;
    (match as any).status = nextStatus;
    try {
      await updateStatus(nextStatus);
    } catch (error) {
      (match as any).status = previousStatus; // rollback
      throw error;
    }
  }
  return match.status as MatchStatus;
}
