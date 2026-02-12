/**
 * █ [UTILS] :: COMMENTARY_BOT
 * =====================================================================
 * DESC:   Genera comentarios automáticos basados en eventos de telemetría.
 *         Convierte datos fríos (velocidad, golpe) en narrativa emocionante.
 * STATUS: BETA
 * =====================================================================
 */
import type { TelemetryData } from "../types/index.ts";

/**
 * ◼️ FUNCTION: GENERATE_AUTOMATED_COMMENT
 * ---------------------------------------------------------
 * Construye una frase basada en templates aleatorios.
 */
export function generateAutomatedComment(data: TelemetryData): string {
  const { playerName, method, stroke, speed } = data;

  // 1. CASO: VELOCIDAD EXTREMA (> 130 km/h)
  if (speed && speed > 130 && stroke === "smash" && method === "winner") {
    const templates = [
      `¡MISIL DE ${playerName}! 🚀 Smash a ${speed}km/h.`,
      `¡${speed}km/h! ${playerName} acaba de romper la barrera del sonido.`,
      `¡Indefendible! Tremendo cañonazo de ${playerName} a ${speed}km/h.`,
    ];
    return getRandom(templates);
  }

  // 2. CASO: SMASH (REMATE)
  if (stroke === "smash" && method === "winner") {
    const templates = [
      `¡Por 4! ${playerName} la saca de la pista con un remate espectacular.`,
      `¡Traetela! ${playerName} define con potencia.`,
      `Salto, potencia y punto. Gran smash de ${playerName}.`,
    ];
    return getRandom(templates);
  }

  // 3. CASO: BANDEJA / VIBORA (Técnica)
  if ((stroke === "bandeja" || stroke === "vibora") && method === "winner") {
    const templates = [
      `¡Qué muñeca! ${playerName} define con una ${stroke} venenosa. 🐍`,
      `Profundidad y efecto. Clase magistral de ${playerName}.`,
      `La ${stroke} de ${playerName} es un guante. Punto de oro.`,
    ];
    return getRandom(templates);
  }

  // 4. CASO: ERROR NO FORZADO
  if (method === "unforced_error") {
    const templates = [
      `¡Ay! Error no forzado de ${playerName}. La red no perdona.`,
      `${playerName} busca demasiado y se le va al cristal.`,
      `Oportunidad perdida para ${playerName}. Bola fuera.`,
    ];
    return getRandom(templates);
  }

  // 5. CASO: ACE
  if (method === "service_ace") {
    return `¡ACE! Saque directo de ${playerName}.`;
  }

  // 6. DEFAULT / GENÉRICO
  if (method === "winner") {
    return `¡Puntazo de ${playerName}! Define con autoridad.`;
  }

  return `Punto para ${playerName}.`;
}

function getRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)] || "";
}
