import { db } from "../src/db/db";
import {
  courts,
  players,
  matches,
  matchStats,
  matchSets,
  pointHistory,
} from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";
import { PadelEngine } from "../src/utils/padelScoring";
import type {
  MatchSnapshot,
  PointMethod,
  PadelStroke,
} from "../src/types/padel.types";

/**
 * █ SCRIPT: SEED_ENHANCED_COURTS
 * =====================================================================
 * DESC:   Popula la DB con:
 *         1. 8 Pistas con nombres de sponsors.
 *         2. ~20 Jugadores PRO (Coello, Tapia, etc.).
 *         3. 3 Partidos TERMINADOS por pista con historial punto a punto.
 * USO:    bun scripts/seed_enhanced_courts.ts
 * STATUS: ONEOFF
 * =====================================================================
 */

// --- CONFIG ---
const COURTS_COUNT = 8;
const MATCHES_PER_COURT = 3;

const PLAYER_NAMES = [
  "Arturo Coello",
  "Agustín Tapia",
  "Alejandro Galán",
  "Juan Lebrón",
  "Martín Di Nenno",
  "Franco Stupaczuk",
  "Paquito Navarro",
  "Fede Chingotto",
  "Momo González",
  "Sanyo Gutiérrez",
  "Fernando Belasteguín",
  "Mike Yanguas",
  "Javi Garrido",
  "Coki Nieto",
  "Jon Sanz",
  "Alex Ruiz",
  "Lucas Campagnolo",
  "Lucho Capra",
  "Maxi Sánchez",
  "Ramiro Moyano",
];

const COURT_NAMES = [
  "Pista Central Vodafone",
  "Pista Automóviles Arias",
  "Pista Estrella Damm",
  "Pista Coca-Cola",
  "Pista Bullpadel",
  "Pista Babolat",
  "Pista Movistar",
  "Pista Red Bull",
];

const COUNTRIES = ["ESP", "ARG", "BRA", "ITA"];

// --- HELPERS ---

function getRandomItem<T>(arr: T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  if (!item) throw new Error("Empty array in getRandomItem");
  return item;
}

function getRandomItems<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// --- MAIN ---

async function seed() {
  console.log("🌱 SEED :: Iniciando proceso mejorado...");

  try {
    // 1. PLAYERS
    console.log("👤 SEED :: Verificando jugadores...");
    const existingPlayers = await db.select().from(players);
    const existingNames = new Set(existingPlayers.map((p) => p.name));

    const newPlayersData = PLAYER_NAMES.filter(
      (name) => !existingNames.has(name),
    ).map((name) => ({
      name,
      country: getRandomItem(COUNTRIES),
      ranking: randomInt(1, 100),
      imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
    }));

    if (newPlayersData.length > 0) {
      console.log(`   -> Creando ${newPlayersData.length} jugadores nuevos...`);
      await db.insert(players).values(newPlayersData);
    }

    const allPlayers = await db.select().from(players);
    console.log(`   ✅ Total jugadores: ${allPlayers.length}`);

    // 2. COURTS
    console.log("🏟️ SEED :: Verificando pistas...");
    const existingCourts = await db.select().from(courts);
    const existingCourtNames = new Set(existingCourts.map((c) => c.name));

    const newCourtsData = COURT_NAMES.filter(
      (name) => !existingCourtNames.has(name),
    ).map((name) => ({
      name,
      authToken: `court_${crypto.randomUUID().split("-")[0]}`,
    }));

    if (newCourtsData.length > 0) {
      console.log(`   -> Creando ${newCourtsData.length} pistas nuevas...`);
      await db.insert(courts).values(newCourtsData);
    }

    // Rellenar hasta 8 si faltan (nombres genéricos)
    const currentCount = existingCourts.length + newCourtsData.length;
    if (currentCount < COURTS_COUNT) {
      const needed = COURTS_COUNT - currentCount;
      const genericCourts = Array.from({ length: needed }).map((_, i) => ({
        name: `Pista Extra ${currentCount + i + 1}`,
        authToken: `court_gen_${crypto.randomUUID().split("-")[0]}`,
      }));
      await db.insert(courts).values(genericCourts);
    }

    const allCourts = await db.select().from(courts);
    console.log(`   ✅ Total pistas: ${allCourts.length}`);

    // 3. MATCHES
    console.log("🎾 SEED :: Generando partidos históricos...");

    for (const court of allCourts) {
      console.log(`   -> Generando historial para: ${court.name}`);

      // Generar 3 partidos en horarios escalonados
      const startTimes = [
        new Date(Date.now() - 5 * 60 * 60 * 1000), // Hace 5h
        new Date(Date.now() - 3 * 60 * 60 * 1000), // Hace 3h
        new Date(Date.now() - 90 * 60 * 1000), // Hace 1.5h
      ];

      for (const startTime of startTimes) {
        await simulateAndSaveMatch(court.id, allPlayers, startTime);
      }
    }

    console.log("🌟 SEED :: Proceso COMPLETADO exitosamente.");
    process.exit(0);
  } catch (err) {
    console.error("❌ SEED :: Error fatal:", err);
    process.exit(1);
  }
}

// --- SIMULATION LOGIC ---

async function simulateAndSaveMatch(
  courtId: number,
  allPlayers: (typeof players.$inferSelect)[],
  startTime: Date,
) {
  // A. Seleccionar 4 jugadores
  const matchPlayers = getRandomItems(allPlayers, 4);
  if (matchPlayers.length < 4) {
    console.warn("⚠️ Not enough players to simulate match");
    return;
  }

  const p1 = matchPlayers[0]!;
  const p2 = matchPlayers[1]!; // Pair A
  const p3 = matchPlayers[2]!;
  const p4 = matchPlayers[3]!; // Pair B

  // B. Crear el partido 'finished'
  const matchRes = await db
    .insert(matches)
    .values({
      courtId,
      pairAName: `${p1.name} / ${p2.name}`,
      pairBName: `${p3.name} / ${p4.name}`,
      pairAPlayer1Id: p1.id,
      pairAPlayer2Id: p2.id,
      pairBPlayer1Id: p3.id,
      pairBPlayer2Id: p4.id,
      servingPlayerId: p1.id,
      status: "finished",
      matchType: "league",
      startTime: startTime,
      hasGoldPoint: true,
    })
    .returning();

  const match = matchRes[0];
  if (!match) throw new Error("Failed to create match");

  const matchId = match.id;

  // C. Simular Puntos (Time Travel)
  let currentTime = new Date(startTime);
  let snapshot: MatchSnapshot = {
    id: matchId,
    matchType: "league",
    pairAName: match.pairAName || "Pair A",
    pairBName: match.pairBName || "Pair B",
    pairAPlayer1Id: p1.id,
    pairAPlayer2Id: p2.id,
    pairBPlayer1Id: p3.id,
    pairBPlayer2Id: p4.id,
    pairAPlayer1Name: p1.name,
    pairAPlayer2Name: p2.name,
    pairBPlayer1Name: p3.name,
    pairBPlayer2Name: p4.name,
    pairAScore: "0",
    pairBScore: "0",
    pairAGames: 0,
    pairBGames: 0,
    pairASets: 0,
    pairBSets: 0,
    currentSetIdx: 1,
    isTieBreak: false,
    hasGoldPoint: true,
    startTime: startTime.toISOString(),
    // fixme: endTime missing in type but required? It's optional usually.
    // actually MatchSnapshot definition might have endTime as string | null.
    // checking usage in toSnapshot... yes it handles null.
    endTime: null,
    courtId,
    courtName: "Simulated",
    status: "live",
    sets: [],
    stats: matchPlayers.map((p) => ({
      playerId: p!.id,
      pointsWon: 0,
      winners: 0,
      unforcedErrors: 0,
      smashWinners: 0,
    })),
  };

  const dbPointHistory: (typeof pointHistory.$inferInsert)[] = [];
  const dbMatchSets: (typeof matchSets.$inferInsert)[] = [];
  const finalStats = new Map<number, typeof matchStats.$inferInsert>();

  // Init stats map
  [p1, p2, p3, p4].forEach((p) => {
    finalStats.set(p.id, {
      matchId,
      playerId: p.id,
      pointsWon: 0,
      winners: 0,
      unforcedErrors: 0,
      smashWinners: 0,
    });
  });

  let pointCount = 0;
  let isMatchFinished = false;

  // LOOP
  while (!isMatchFinished) {
    if (pointCount > 500) break; // Safety break
    pointCount++;

    // 1. Pick Winner
    const winnerIdx = randomInt(0, 3);
    const winnerPlayer = matchPlayers[winnerIdx]!;
    const winnerSide = winnerIdx < 2 ? "pair_a" : "pair_b";

    // 2. Pick Method
    const methods: PointMethod[] = [
      "winner",
      "winner",
      "forced_error",
      "unforced_error",
    ];
    let method = getRandomItem(methods);

    // Random smash winner sometimes
    if (method === "winner" && Math.random() > 0.8) {
      // keep it winner but logic below handles smash
    }

    const stroke: PadelStroke = getRandomItem([
      "forehand",
      "backhand",
      "volley_forehand",
      "volley_backhand",
      "smash",
      "bandeja",
    ]);

    // 3. Process Point
    const outcome = PadelEngine.processPoint(
      snapshot,
      winnerSide,
      method,
      stroke,
      false,
    );

    // 4. Update Time
    currentTime = new Date(currentTime.getTime() + randomInt(20, 90) * 1000);

    // 5. Record History
    dbPointHistory.push({
      matchId,
      setNumber: snapshot.currentSetIdx,
      gameNumber: snapshot.pairAGames + snapshot.pairBGames + 1,
      pointNumber: pointCount,
      winnerSide,
      winnerPlayerId: winnerPlayer.id,
      method,
      stroke,
      scoreAfterPairA: outcome.nextSnapshot.pairAScore,
      scoreAfterPairB: outcome.nextSnapshot.pairBScore,
      createdAt: currentTime,
      isGamePoint: outcome.history.isGamePoint,
      isSetPoint: outcome.history.isSetPoint,
      isMatchPoint: outcome.history.isMatchPoint,
    });

    // 6. Update Stats (Manual)
    const statEntry = finalStats.get(winnerPlayer.id)!;
    statEntry.pointsWon = (statEntry.pointsWon || 0) + 1;
    if (method === "winner") {
      statEntry.winners = (statEntry.winners || 0) + 1;
      if (stroke === "smash") {
        statEntry.smashWinners = (statEntry.smashWinners || 0) + 1;
      }
    } else if (method === "unforced_error") {
      // El error lo cometió EL OTRO.
      const userSide = winnerSide === "pair_a" ? "pair_b" : "pair_a";
      const loserIdx =
        userSide === "pair_a" ? randomInt(0, 1) : randomInt(2, 3);
      const loserPlayer = matchPlayers[loserIdx]!;
      const loserStat = finalStats.get(loserPlayer.id)!;
      loserStat.unforcedErrors = (loserStat.unforcedErrors || 0) + 1;
    }

    // 7. Update Snapshot State
    snapshot = outcome.nextSnapshot;

    // 8. Handle Set/Match End
    if (outcome.setCompleted) {
      dbMatchSets.push({
        matchId,
        setNumber: outcome.setCompleted.setNumber,
        pairAGames: outcome.setCompleted.pairAGames,
        pairBGames: outcome.setCompleted.pairBGames,
        tieBreakPairAPoints: outcome.setCompleted.tieBreakPairAPoints,
        tieBreakPairBPoints: outcome.setCompleted.tieBreakPairBPoints,
      });

      // [CRITICAL FIX]: Increment set counter manually
      const setWinner =
        outcome.setCompleted.pairAGames > outcome.setCompleted.pairBGames
          ? "pair_a"
          : "pair_b";

      if (setWinner === "pair_a") snapshot.pairASets++;
      else snapshot.pairBSets++;

      if (snapshot.pairASets >= 2) {
        snapshot.winnerSide = "pair_a";
        snapshot.status = "finished";
        isMatchFinished = true;
      } else if (snapshot.pairBSets >= 2) {
        snapshot.winnerSide = "pair_b";
        snapshot.status = "finished";
        isMatchFinished = true;
      }
    }

    if (snapshot.status === "finished") {
      isMatchFinished = true;
    }
  }

  // D. Bulk Inserts
  if (dbPointHistory.length > 0) {
    await db.insert(pointHistory).values(dbPointHistory);
  }

  if (dbMatchSets.length > 0) {
    await db.insert(matchSets).values(dbMatchSets);
  }

  const statsValues = Array.from(finalStats.values());
  if (statsValues.length > 0) {
    await db.insert(matchStats).values(statsValues);
  }

  // E. Final Update Match
  await db
    .update(matches)
    .set({
      endTime: currentTime,
      pairAGames: snapshot.pairAGames,
      pairBGames: snapshot.pairBGames,
      pairASets: snapshot.pairASets,
      pairBSets: snapshot.pairBSets,
      pairAScore: snapshot.pairAScore,
      pairBScore: snapshot.pairBScore,
      winnerSide: snapshot.winnerSide,
      status: "finished",
    })
    .where(eq(matches.id, matchId));

  console.log(
    `      -> Match ${matchId} Terminado: ${snapshot.pairASets}-${snapshot.pairBSets} (${dbPointHistory.length} puntos)`,
  );
}

// EXECUTE
seed();
