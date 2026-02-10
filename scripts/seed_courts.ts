import { db } from "../src/db/db.ts";
import { courts } from "../src/db/schema.ts";
import { randomUUID } from "node:crypto";

/**
 * █ SCRIPT: SEED_COURTS
 * =====================================================================
 * DESC:   Popula la tabla 'courts' si está vacía o tiene menos de 8 pistas.
 *         Usa nombres realistas de patrocinadores.
 * USO:    bun db:seed
 *STATUS:  ONEOFF
 * =====================================================================
 */

const SPONSOR_NAMES = [
  "Pista Central Vodafone",
  "Pista Automóviles Arias",
  "Pista Estrella Damm",
  "Pista Coca-Cola",
  "Pista Bullpadel",
  "Pista Babolat",
  "Pista Movistar",
  "Pista Red Bull",
];

async function seedCourts() {
  console.log("🌱 SEED :: Iniciando sembrado de pistas...");

  try {
    // 1. Contar pistas actuales
    const existing = await db
      .select({
        id: courts.id,
        name: courts.name,
      })
      .from(courts);

    const existingCount = existing.length;

    console.log(`📊 SEED :: Pistas existentes: ${existingCount}`);

    if (existingCount >= 8) {
      console.log("✅ SEED :: Ya existen 8 o más pistas. Saltando...");
      process.exit(0);
    }

    // 2. Calcular cuántas faltan
    const numberNeeded = 8 - existingCount;

    // Filtrar nombres ya usados (simple check)
    const existingNames = new Set(existing.map((c) => c.name));
    const courtsToAdd: string[] = [];

    for (const name of SPONSOR_NAMES) {
      if (!existingNames.has(name) && courtsToAdd.length < numberNeeded) {
        courtsToAdd.push(name);
      }
    }

    // Si aún faltan (porque se acabaron los sponsors), rellenar con genéricos
    while (courtsToAdd.length < numberNeeded) {
      courtsToAdd.push(`Pista Extra ${courtsToAdd.length + existingCount + 1}`);
    }

    if (courtsToAdd.length === 0) {
      console.log("✅ SEED :: No hay nombres nuevos para añadir.");
      process.exit(0);
    }

    console.log(
      `🔨 SEED :: Creando ${courtsToAdd.length} pistas nuevas:`,
      courtsToAdd,
    );

    // 3. Insertar
    const values = courtsToAdd.map((name) => ({
      name,
      authToken: `court_${randomUUID().split("-")[0]}`,
    }));

    const inserted = await db.insert(courts).values(values).returning();

    inserted.forEach((c) => {
      console.log(`   -> Creada: [${c.id}] ${c.name} (Token: ${c.authToken})`);
    });

    console.log("✅ SEED :: Proceso completado con éxito.");
    process.exit(0);
  } catch (error) {
    console.error("❌ SEED :: Error fatal:", error);
    process.exit(1);
  }
}

// Ejecutar
seedCourts();
