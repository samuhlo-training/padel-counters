/**
 * █ [CONTROLLER] :: MATCH_LOGIC
 * =====================================================================
 * DESC:   Wrapper delgado que delega a MatchService.
 *         Mantiene compatibilidad con imports existentes.
 * STATUS: STABLE
 * =====================================================================
 */
import { MatchService } from "../services/matchService.ts";
import type { MatchSnapshot } from "../types/padel.types.ts";

/**
 * ◼️ FUNCTION: GET_MATCH_SNAPSHOT
 * ---------------------------------------------------------
 * Recupera el estado completo de un partido por ID.
 */
export async function getMatchSnapshot(
  matchId: number,
): Promise<MatchSnapshot> {
  return MatchService.getSnapshot(matchId);
}

/**
 * ◼️ FUNCTION: PROCESS_POINT_SCORED
 * ---------------------------------------------------------
 * Procesa un punto marcado y delega a MatchService.
 */
export async function processPointScored(payload: {
  matchId: string;
  playerId: string;
  actionType: import("../types/padel.types.ts").PointMethod;
  stroke?: import("../types/padel.types.ts").PadelStroke;
  isNetPoint?: boolean;
}) {
  return MatchService.addPoint(payload);
}
