# 🎮 PADEL_SIMULATOR_SVC

> **ROLE:** MOCK DATA GENERATOR
> **CONTEXT:** DEV / TESTING
> **INTEGRATION:** DIRECT (SAME PROCESS)

---

## 00 __ CONCEPT

Simulador integrado para pruebas de Frontend y estrés de WebSockets. Genera partidos completos con comportamiento pseudo-aleatorio realista (winners, errores, comentarios).

---

## 01 __ USAGE

### 01.1 __ PREREQUISITES (SEEDING)

Para simular, necesitas pistas en la base de datos.

```bash
bun db:seed
# CREATES: "Pista Central Vodafone", "Pista Red Bull", etc.
```

### 01.2 __ START_SIMULATION

Crea 4 bots y comienza un partido en la pista indicada.

**Request:** `POST /simulator/start`
```json
{ "courtId": 1 }
```

**Flow:**
1.  **Init**: Crea bots + Partido `live`.
2.  **Loop**: Genera evento cada 3s.
3.  **Logic**: Decide tipo de punto (Smash/Volea/Error).
4.  **Broadcast**: Emite `MATCH_UPDATE` + `COMMENTARY`.

### 01.3 __ STOP_SIMULATION

Detiene el loop de generación para un partido.

**Request:** `POST /simulator/stop`
```json
{ "matchId": 123 }
```

---

## 02 __ CONFIGURATION

Parámetros ajustables en `services/simulator.ts`:

| CONSTANT | DEFAULT | DESC |
| :--- | :--- | :--- |
| `INTERVAL_MS` | `3000` | Tiempo entre puntos |
| `PROBABILITY_ERROR` | `0.3` | Ratio de errores no forzados |
| `PROBABILITY_WINNER` | `0.4` | Ratio de winners limpios |

> [!NOTE]
> El simulador corre en el **mismo proceso** que el backend. Todos los eventos son reales y se transmiten por el bus de WebSockets de producción.
