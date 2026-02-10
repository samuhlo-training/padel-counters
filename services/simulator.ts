import { db } from "../src/db/db";
import { matches, players, courts } from "../src/db/schema";
import { MatchService } from "../src/services/matchService";
import { eq } from "drizzle-orm";

import { generateAutomatedComment } from "../src/utils/commentaryBot";
import type { PadelStroke, PointMethod } from "../src/types/padel.types";

/**
 * █ [SERVICE] :: SIMULATOR
 * =====================================================================
 * DESC:   Script/Servicio para simular partidos en tiempo real.
 *         Genera eventos automáticos para probar el frontend y websockets.
 * STATUS: DEVELOPMENT
 * =====================================================================
 */

const ACTIVE_SIMULATIONS = new Set<number>();

// Configuración de la simulación
const SIM_CONFIG = {
  INTERVAL_MS: 3000,
  PROBABILITY_ERROR: 0.3,
  PROBABILITY_WINNER: 0.45,
  // Weights for strokes (simple logic below)
};

export const Simulator = {
  /**
   * 1. INICIAR SIMULACIÓN COMPLETA
   * Crea un partido en una pista y empieza a jugar solo.
   */
  async createAndSimulate(courtId: number) {
    console.log(`[SIM] 🚀 Iniciando simulación en pista ${courtId}...`);

    try {
      // A. Buscar o crear jugadores Bot
      const bots = await this.getOrCreateBots();

      if (bots.length < 4) {
        throw new Error("Failed to generate 4 bots");
      }

      const bot1 = bots[0];
      const bot2 = bots[1];
      const bot3 = bots[2];
      const bot4 = bots[3];

      if (!bot1 || !bot2 || !bot3 || !bot4) {
        throw new Error("Bots authentication failed");
      }

      // B. Crear Partido
      const match = await MatchService.createMatch({
        pairAPlayer1Id: bot1.id,
        pairAPlayer2Id: bot2.id,
        pairBPlayer1Id: bot3.id,
        pairBPlayer2Id: bot4.id,
        pairAName: "Simulador A",
        pairBName: "Simulador B",
        courtId: courtId,
        startTime: new Date(),
        status: "live", // Empezamos directo en live
        hasGoldPoint: true,
      });

      console.log(`[SIM] ✅ Partido creado: ${match.id}`);

      // C. Update Court (Simular que la pista está ocupada)
      // Nota: Esto debería hacerlo createMatch idealmente, pero aseguramos
      await db
        .update(courts)
        .set({ activeMatchId: match.id })
        .where(eq(courts.id, courtId));

      // D. Broadcast Court Update
      const { broadcastCourtUpdate } = await import("../src/ws/utils");
      await broadcastCourtUpdate(
        courtId,
        "busy",
        match.id,
        match.startTime as Date | null,
      );

      // E. Arrancar Loop
      this.startLoop(match.id, bots);

      return { status: "started", matchId: match.id };
    } catch (err) {
      console.error(`[SIM] ❌ Error iniciando simulación:`, err);
      throw err;
    }
  },

  /**
   * 2. LOOP DE JUEGO
   */
  async startLoop(matchId: number, players: { id: number; name: string }[]) {
    if (ACTIVE_SIMULATIONS.has(matchId)) return;
    ACTIVE_SIMULATIONS.add(matchId);

    console.log(`[SIM] 🔄 Loop iniciado para Match ${matchId}`);

    const runStep = async () => {
      if (!ACTIVE_SIMULATIONS.has(matchId)) return;

      try {
        // 1. Verificar estado
        const snapshot = await MatchService.getSnapshot(matchId);
        if (snapshot.status === "finished" || snapshot.status === "canceled") {
          console.log(`[SIM] 🏁 Partido ${matchId} terminado.`);
          ACTIVE_SIMULATIONS.delete(matchId);
          return;
        }

        // 2. Elegir quién gana el punto (Random)
        // 0-1 Pair A, 2-3 Pair B
        const winnerIdx = Math.floor(Math.random() * 4);
        const player = players[winnerIdx];

        if (!player) {
          console.warn(`[SIM] ⚠️ Player index ${winnerIdx} not found`);
          return;
        }
        // 3. Determinar tipo de punto y golpe (Más detallado)
        const rand = Math.random();
        let method: PointMethod = "winner";
        let stroke: PadelStroke = "forehand";
        let speed = 0;
        let isNetPoint = Math.random() > 0.6; // 40% en red

        if (rand < SIM_CONFIG.PROBABILITY_ERROR) {
          method = "unforced_error";
          stroke = this.getRandomStroke([
            "forehand",
            "backhand",
            "volley_forehand",
            "volley_backhand",
            "lob",
          ]);
        } else if (
          rand <
          SIM_CONFIG.PROBABILITY_ERROR + SIM_CONFIG.PROBABILITY_WINNER
        ) {
          method = "winner";
          // Winners espectaculares
          stroke = this.getRandomStroke([
            "smash",
            "bandeja",
            "vibora",
            "volley_forehand",
            "volley_backhand",
            "drop_shot",
          ]);

          if (stroke === "smash") {
            speed = Math.floor(Math.random() * (160 - 90) + 90); // 90-160 km/h
            isNetPoint = true;
          }
          if (stroke === "bandeja" || stroke === "vibora") {
            isNetPoint = true;
          }
        } else {
          method = "forced_error";
          stroke = this.getRandomStroke([
            "forehand",
            "backhand",
            "lob",
            "wall_boast",
          ]);
        }

        // 4. Enviar Punto
        await MatchService.addPoint({
          matchId: String(matchId),
          playerId: String(player.id),
          actionType: method,
          stroke: stroke,
          isNetPoint: isNetPoint,
        });

        // 5. Generar y Enviar Comentario (Feedback Visual)
        const commentText = generateAutomatedComment({
          playerName: player.name,
          method,
          stroke,
          speed: speed > 0 ? speed : undefined,
          isNetPoint,
        });

        await MatchService.addCommentary(matchId, commentText, {
          setNumber: snapshot.currentSetIdx, // Aproximado, idealmente del 'outcome' de addPoint
          gameNumber: snapshot.pairAGames + snapshot.pairBGames + 1, // Aproximado
        });

        // 6. Agendar siguiente
        setTimeout(runStep, SIM_CONFIG.INTERVAL_MS);
      } catch (err) {
        console.error(`[SIM] ⚠️ Error en loop ${matchId}:`, err);
        ACTIVE_SIMULATIONS.delete(matchId);
      }
    };

    runStep();
  },

  /**
   * Stop simulation manually
   */
  stop(matchId: number) {
    if (ACTIVE_SIMULATIONS.has(matchId)) {
      ACTIVE_SIMULATIONS.delete(matchId);
      console.log(`[SIM] 🛑 Simulación detenida para Match ${matchId}`);
      return true;
    }
    return false;
  },

  /**
   * Helper: Get Bots
   */
  async getOrCreateBots() {
    // Intentamos buscar jugadores que se llamen "Bot X"
    // O simplemente creamos 4 nuevos siempre para no ensuciar?
    // Mejor buscamos por nombre fijo para reusar IDs
    const botNames = ["Bot Alpha", "Bot Beta", "Bot Gamma", "Bot Delta"];
    const botIds: { id: number; name: string }[] = [];

    for (const name of botNames) {
      // Find existing bot
      const found = await db
        .select()
        .from(players)
        .where(eq(players.name, name));
      let existing = found[0];

      if (!existing) {
        const created = await db
          .insert(players)
          .values({
            name,
            country: "AI",
            ranking: 9999,
          })
          .returning();

        existing = created[0]; // Asignar el nuevo valor a la variable
      }

      if (existing) {
        botIds.push({ id: existing.id, name: existing.name });
      }
    }
    return botIds;
  },

  /**
   * Helper: Random Stroke Picker
   */
  getRandomStroke(options: PadelStroke[]): PadelStroke {
    const idx = Math.floor(Math.random() * options.length);
    return options[idx] || "forehand";
  },
};
