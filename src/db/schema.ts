/**
 * █ [CORE] :: DB_SCHEMA (PADEL PRO FINAL)
 * =====================================================================
 * DESC:   Esquema completo con Historial de Puntos y Comentarios.
 * STATUS: GOLD MASTER
 * =====================================================================
 */
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
  boolean,
  index,
  jsonb, // Necesario para metadatos extra si hacen falta
  unique,
  varchar, // Added for matchType
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// =============================================================================
// █ ENUMS
// =============================================================================
export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "warmup",
  "live",
  "finished",
  "canceled",
]);

// Enum para saber CÓMO se ganó el punto (¡Esto da estadísticas brutales!)
export const pointMethodEnum = pgEnum("point_method", [
  "winner",
  "unforced_error",
  "forced_error",
  "service_ace",
  "double_fault",
]);

export const padelStrokeEnum = pgEnum("padel_stroke", [
  "forehand",
  "backhand",
  "smash",
  "bandeja",
  "vibora",
  "volley_forehand",
  "volley_backhand",
  "lob",
  "drop_shot",
  "wall_boast",
]);

// =============================================================================
// █ TABLAS PRINCIPALES
// =============================================================================

// 1. PLAYERS (Sin cambios)
export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  country: text("country"),
  ranking: integer("ranking").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 2. MATCHES (El Marcador en Tiempo Real)
export const matches = pgTable(
  "matches",
  {
    id: serial("id").primaryKey(),
    matchType: varchar("match_type", { length: 50 })
      .default("friendly")
      .notNull(),
    pairAName: varchar("pair_a_name", { length: 255 }).default("Pair A"),
    pairBName: varchar("pair_b_name", { length: 255 }).default("Pair B"),

    // Parejas
    pairAPlayer1Id: integer("pair_a_player1_id")
      .references(() => players.id)
      .notNull(),
    pairAPlayer2Id: integer("pair_a_player2_id")
      .references(() => players.id)
      .notNull(),
    pairBPlayer1Id: integer("pair_b_player1_id")
      .references(() => players.id)
      .notNull(),
    pairBPlayer2Id: integer("pair_b_player2_id")
      .references(() => players.id)
      .notNull(),

    // Estado
    status: matchStatusEnum("status").default("scheduled").notNull(),

    // Relación con Pistas (Courts) - FK manejado en relations para evitar referencia circular
    courtId: integer("court_id").notNull(),

    // Marcador Actual (La foto del momento)
    currentSetIdx: integer("current_set_idx").default(1),
    pairAGames: integer("pair_a_games").default(0),
    pairBGames: integer("pair_b_games").default(0),
    pairASets: integer("pair_a_sets").default(0),
    pairBSets: integer("pair_b_sets").default(0),
    pairAScore: text("pair_a_score").default("0"),
    pairBScore: text("pair_b_score").default("0"),

    isTieBreak: boolean("is_tie_break").default(false),
    hasGoldPoint: boolean("has_gold_point").default(false),
    servingPlayerId: integer("serving_player_id").references(() => players.id),
    winnerSide: text("winner_side"), // 'pair_a' | 'pair_b'

    startTime: timestamp("start_time"),
    endTime: timestamp("end_time"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Índices...
  }),
);

// 3. COURTS (Pistas Físicas / Dispositivos)
export const courts = pgTable("courts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // Ej: "Pista Central"
  authToken: text("auth_token").notNull().unique(), // Token para la cámara/mini-pc
  activeMatchId: integer("active_match_id"), // FK a matches.id - circular, manejado en relations
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// █ TABLAS DE DETALLE (LÓGICA Y COMENTARIOS)
// =============================================================================

// 3. POINT HISTORY (¡La Lógica de los Puntos!)
// Cada vez que alguien pulse un botón, se guarda una fila aquí.
export const pointHistory = pgTable("point_history", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id")
    .references(() => matches.id)
    .notNull(),

  // ¿Cuándo ocurrió esto?
  setNumber: integer("set_number").notNull(), // Ej: 1
  gameNumber: integer("game_number").notNull(), // Ej: 4 (Juego 4 del set 1)
  pointNumber: integer("point_number").notNull(), // Ej: 5 (El quinto punto del juego)

  // ¿Quién ganó el punto?
  winnerSide: text("winner_side").notNull(), // 'pair_a' | 'pair_b'
  winnerPlayerId: integer("winner_player_id").references(() => players.id), // Opcional, si sabemos quién fue

  // ¿Cómo fue? (Estadísticas)
  method: pointMethodEnum("method").default("winner"),
  stroke: padelStrokeEnum("stroke"), // Nuevo: Tipo de golpe
  isNetPoint: boolean("is_net_point").default(false), // Nuevo: ¿Fue en la red?

  // SNAPSHOT: ¿Cómo quedó el marcador JUSTO DESPUÉS de este punto?
  // Esto permite "rebobinar" el partido si hay un error.
  scoreAfterPairA: text("score_after_pair_a").notNull(), // Ej: "30"
  scoreAfterPairB: text("score_after_pair_b").notNull(), // Ej: "15"

  isGamePoint: boolean("is_game_point").default(false), // ¿Fue punto de juego?
  isSetPoint: boolean("is_set_point").default(false), // ¿Fue punto de set?
  isMatchPoint: boolean("is_match_point").default(false), // ¿Fue punto de partido?

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 4. COMMENTARY (Comentarios y Sucesos)
export const commentary = pgTable("commentary", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id")
    .references(() => matches.id)
    .notNull(),

  // Contexto temporal (Opcional, puede ser un comentario general)
  setNumber: integer("set_number"),
  gameNumber: integer("game_number"),

  // El texto
  message: text("message").notNull(), // Ej: "¡Vaya salida de pista de Tapia!"

  // Etiquetas para filtrar (Ej: ["highlight", "error"])
  tags: text("tags").array(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 5. MATCH SETS (Resultados finales de cada set)
export const matchSets = pgTable(
  "match_sets",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .references(() => matches.id)
      .notNull(),
    setNumber: integer("set_number").notNull(),
    pairAGames: integer("pair_a_games").notNull(),
    pairBGames: integer("pair_b_games").notNull(),
    tieBreakPairAPoints: integer("tie_break_pair_a_points"),
    tieBreakPairBPoints: integer("tie_break_pair_b_points"),
  },
  (table) => ({
    match_sets_match_id_set_number_unique: unique(
      "match_sets_match_id_set_number_unique",
    ).on(table.matchId, table.setNumber),
  }),
);

// 6. MATCH STATS (Estadísticas por jugador y partido)
export const matchStats = pgTable(
  "match_stats",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .references(() => matches.id)
      .notNull(),
    playerId: integer("player_id")
      .references(() => players.id)
      .notNull(),
    pointsWon: integer("points_won").default(0),
    winners: integer("winners").default(0),
    unforcedErrors: integer("unforced_errors").default(0),
    smashWinners: integer("smash_winners").default(0),
  },
  (table) => ({
    match_stats_match_player_unique: unique(
      "match_stats_match_player_unique",
    ).on(table.matchId, table.playerId),
  }),
);

// =============================================================================
// █ RELATIONS
// =============================================================================

export const matchesRelations = relations(matches, ({ one, many }) => ({
  sets: many(matchSets),
  stats: many(matchStats),
  pointHistory: many(pointHistory),
  commentary: many(commentary),
  court: one(courts, {
    fields: [matches.courtId],
    references: [courts.id],
  }),
}));

export const pointHistoryRelations = relations(pointHistory, ({ one }) => ({
  match: one(matches, {
    fields: [pointHistory.matchId],
    references: [matches.id],
  }),
  player: one(players, {
    fields: [pointHistory.winnerPlayerId],
    references: [players.id],
  }),
}));

export const commentaryRelations = relations(commentary, ({ one }) => ({
  match: one(matches, {
    fields: [commentary.matchId],
    references: [matches.id],
  }),
}));

// Relaciones para romper la referencia circular matches <-> courts
export const courtsRelations = relations(courts, ({ one }) => ({
  activeMatch: one(matches, {
    fields: [courts.activeMatchId],
    references: [matches.id],
  }),
}));
