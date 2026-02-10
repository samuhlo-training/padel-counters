# 📖 Documentación Completa: Padel Counters Backend

> Última actualización: 2026-02-08

---

## 🏗️ Arquitectura General

```mermaid
graph TB
    subgraph Clients
        WEB[Web App]
        IOT[Cámaras/IoT]
    end

    subgraph Server["Bun Server"]
        HONO[Hono Router]
        WS[WebSocket Server]
        CTRL[Controllers]
        ENGINE[PadelEngine]
    end

    subgraph Storage
        PG[(PostgreSQL)]
        REDIS[(Upstash Redis)]
    end

    WEB --HTTP--> HONO
    WEB --WS--> WS
    IOT --WS--> WS
    HONO --> CTRL
    WS --> CTRL
    CTRL --> ENGINE
    CTRL --> PG
    HONO --> REDIS
```

| Componente | Tecnología |
|:--|:--|
| Runtime | Bun 1.x |
| HTTP Router | Hono |
| WebSocket | Bun nativo (ServerWebSocket) |
| Base de Datos | PostgreSQL + Drizzle ORM |
| Rate Limiting | Upstash Redis (Sliding Window) |
| Validación | Zod |

---

## 🌐 HTTP API (REST)

### Rutas Montadas

| Prefijo | Archivo | Descripción |
|:--|:--|:--|
| `/matches` | [matches.ts](../src/routes/matches.ts) | CRUD de partidos |
| `/matches/:id/commentary` | [commentary.ts](../src/routes/commentary.ts) | Feed minuto a minuto |
| `/courts` | [courts.ts](../src/routes/courts.ts) | Estado de pistas |

### Endpoints

| Método | Endpoint | Descripción | Tablas Afectadas |
|:--|:--|:--|:--|
| `GET` | `/` | Health check | - |
| `GET` | `/matches` | Lista partidos | `matches` |
| `POST` | `/matches` | Crea partido + stats iniciales | `matches`, `match_stats` |
| `POST` | `/matches/:id/point` | Registra punto | `matches`, `point_history`, `match_stats`, `match_sets` |
| `GET` | `/matches/:id/commentary` | Lista comentarios | `commentary` |
| `POST` | `/matches/:id/commentary` | Crea comentario + broadcast | `commentary` |
| `GET` | `/courts` | Lista pistas y estado | `courts` |

---

## ⚡ WebSocket API

### Conexión

```
ws://localhost:8000/ws
```

Rate limiting: **5 conexiones / 10s** por IP (bypass en test environment).

---

### Tipos de Cliente

| Tipo | Autenticación | Mensajes Permitidos |
|:--|:--|:--|
| **Espectador** | Ninguna | `SUBSCRIBE`, `UNSUBSCRIBE`, `REQUEST_STATS` |
| **Dispositivo IoT** | Token (`AUTH_DEVICE`) | `TELEMETRY_EVENT` (post-auth) |

---

### Mensajes Client → Server

```mermaid
flowchart LR
    subgraph Espectador
        SUB["SUBSCRIBE {matchId}"]
        UNSUB["UNSUBSCRIBE {matchId}"]
        STATS["REQUEST_STATS {matchId, subtype, playerId?}"]
    end

    subgraph IoT
        AUTH["AUTH_DEVICE {token}"]
        TELEM["TELEMETRY_EVENT {playerId, method, stroke, ...}"]
    end
```

| Tipo | Payload | Handler | Acción |
|:--|:--|:--|:--|
| `SUBSCRIBE` | `{matchId: string}` | [subscription.ts](../src/ws/handlers/subscription.ts) | Suscribe al topic + envía snapshot inicial |
| `UNSUBSCRIBE` | `{matchId: string}` | subscription.ts | Desuscribe del topic |
| `REQUEST_STATS` | `{matchId, subtype: "PLAYER" | "MATCH_SUMMARY", playerId?}` | [stats.ts](../src/ws/handlers/stats.ts) | Query a DB y respuesta directa |
| `AUTH_DEVICE` | `{token: string}` | [iot.ts](../src/ws/handlers/iot.ts) | Valida token vs `courts.authToken`, marca socket como dispositivo |
| `TELEMETRY_EVENT` | `{playerId, stroke, speed, method, isNetPoint}` | iot.ts | Procesa punto + genera comentario automático |

---

### Mensajes Server → Client

| Tipo | Payload | Cuándo se emite |
|:--|:--|:--|
| `WELCOME` | `string` | Al conectar |
| `SUBSCRIBED` / `UNSUBSCRIBED` | `string` | Confirmación de suscripción |
| `AUTH_SUCCESS` | `{courtName}` | Autenticación IoT exitosa |
| `MATCH_UPDATE` | `{matchId, timestamp, snapshot, lastPoint}` | Cada punto o al suscribirse |
| `COMMENTARY` | `{data: Commentary}` | Nuevo comentario |
| `MATCH_CREATED` | `{data: Match}` | Nuevo partido (global broadcast) |
| `STATS_RESPONSE` | `{subtype, matchId, data}` | Respuesta a `REQUEST_STATS` |
| `ERROR` | `string` | Cualquier error |

---

## 🔄 Flujo de Datos

### 1. Creación de Partido (HTTP)

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Hono
    participant DB as PostgreSQL
    participant WS as WebSocket

    C->>H: POST /matches {body}
    H->>H: Validar (Zod)
    H->>DB: INSERT matches
    H->>DB: INSERT match_stats (x4 players)
    DB-->>H: Match object
    H->>WS: broadcastMatchCreated()
    WS-->>C: {type: MATCH_CREATED}
    H-->>C: 201 {data: match}
```

**Tablas:**
- `matches` → Nueva fila con marcador inicial (0-0)
- `match_stats` → 4 filas (una por jugador) con estadísticas en 0

---

### 2. Registro de Punto (HTTP)

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Hono
    participant CTRL as Controller
    participant ENGINE as PadelEngine
    participant DB as PostgreSQL
    participant WS as WebSocket

    C->>H: POST /matches/:id/point
    H->>H: Validar params + body
    H->>CTRL: processPointScored()
    CTRL->>DB: SELECT match
    CTRL->>CTRL: Determinar scorerSide
    CTRL->>ENGINE: processPoint(snapshot, side, method)
    ENGINE-->>CTRL: PointOutcome
    CTRL->>DB: Transaction
    Note over CTRL,DB: INSERT point_history
    Note over CTRL,DB: UPDATE match_stats
    Note over CTRL,DB: INSERT match_sets (si aplica)
    Note over CTRL,DB: UPDATE matches
    DB-->>CTRL: Commit
    CTRL->>WS: broadcastToMatch(MATCH_UPDATE)
    WS-->>C: {type: MATCH_UPDATE, snapshot}
    CTRL-->>H: Success
    H-->>C: 200 {success: true}
```

**Tablas:**
- `point_history` → Log del punto con contexto (set, game, method, flags)
- `match_stats` → +1 winner/error según acción
- `match_sets` → Nueva fila si el set terminó
- `matches` → Actualización del marcador actual

---

### 3. Telemetría IoT (WebSocket)

```mermaid
sequenceDiagram
    participant CAM as Cámara/IoT
    participant WS as WebSocket
    participant IoT as IoT Handler
    participant CTRL as Controller
    participant BOT as CommentaryBot
    participant DB as PostgreSQL

    CAM->>WS: AUTH_DEVICE {token}
    WS->>IoT: handleDeviceAuth()
    IoT->>DB: SELECT courts WHERE token = ?
    DB-->>IoT: Court data
    IoT-->>CAM: AUTH_SUCCESS

    CAM->>WS: TELEMETRY_EVENT {playerId, method, stroke}
    WS->>IoT: handleTelemetryEvent()
    IoT->>DB: SELECT courts.activeMatchId
    IoT->>CTRL: processPointScored()
    Note over CTRL: (Same flow as HTTP)
    IoT->>BOT: generateAutomatedComment()
    BOT-->>IoT: "¡Winner de derecha!"
    IoT->>DB: INSERT commentary
    IoT->>WS: broadcastCommentary()
    WS-->>CAM: {type: COMMENTARY}
```

**Tablas:**
- `courts` → Lookup por `authToken`, read `activeMatchId`
- `players` → Lookup nombre para comentario
- `commentary` → Nueva fila con texto generado
- + Todas las tablas del flujo de punto

---

### 4. Comentarios en Tiempo Real (Pub/Sub)

> [!IMPORTANT]
> Los comentarios se entregan **únicamente** a los clientes suscritos al partido específico mediante el sistema **Pub/Sub nativo de Bun**.

```mermaid
sequenceDiagram
    participant S1 as Espectador A
    participant S2 as Espectador B
    participant WS as WebSocket Server
    participant HTTP as HTTP Client

    Note over S1,S2: Fase de Suscripción
    S1->>WS: SUBSCRIBE {matchId: "42"}
    WS->>S1: SUBSCRIBED + Snapshot
    S2->>WS: SUBSCRIBE {matchId: "99"}
    WS->>S2: SUBSCRIBED + Snapshot

    Note over HTTP,WS: Nuevo Comentario (Match 42)
    HTTP->>WS: POST /matches/42/commentary
    WS->>WS: server.publish("42", COMMENTARY)
    WS-->>S1: {type: COMMENTARY, data: {...}}
    Note over S2: ❌ No recibe (suscrito a match 99)
```

| Paso | Código | Archivo |
|:--|:--|:--|
| 1. Cliente envía `SUBSCRIBE` | `socket.subscribe(matchId)` | [subscription.ts](../src/ws/handlers/subscription.ts#L45) |
| 2. Comentario se guarda en DB | `INSERT INTO commentary` | [matchService.ts](../src/services/matchService.ts#L329-338) |
| 3. Broadcast al topic | `server.publish(matchId, ...)` | [utils.ts](../src/ws/utils.ts#L71) |
| 4. Solo suscritos reciben | Filtrado automático por Bun | Runtime nativo |

**Orígenes del broadcast:**

| Trigger | Descripción |
|:--|:--|
| `POST /matches/:id/commentary` | Comentario manual desde HTTP API |
| `TELEMETRY_EVENT` (IoT) | Comentario automático generado por `CommentaryBot` |

> [!TIP]
> El topic de pub/sub coincide con el `matchId` como string. Un cliente puede suscribirse a múltiples partidos simultáneamente.

---

## 🗄️ Modelo de Base de Datos

```mermaid
erDiagram
    players ||--o{ matches : "plays in"
    players ||--o{ match_stats : "has stats"
    players ||--o{ point_history : "wins points"
    
    matches ||--o{ match_stats : "tracks"
    matches ||--o{ point_history : "logs"
    matches ||--o{ match_sets : "contains"
    matches ||--o{ commentary : "has"
    
    courts ||--o| matches : "hosts"

    players {
        int id PK
        text name
        text country
        int ranking
    }

    matches {
        int id PK
        varchar match_type
        int pair_a_player1_id FK
        int pair_a_player2_id FK
        int pair_b_player1_id FK
        int pair_b_player2_id FK
        int court_id FK
        text status
        int current_set_idx
        int pair_a_games
        int pair_b_games
        int pair_a_sets
        int pair_b_sets
        text pair_a_score
        text pair_b_score
        boolean is_tie_break
        boolean has_gold_point
        int serving_player_id FK
        text winner_side
    }

    courts {
        int id PK
        text name
        text auth_token UK
        int active_match_id FK
    }

    match_stats {
        int id PK
        int match_id FK
        int player_id FK
        int points_won
        int winners
        int unforced_errors
        int smash_winners
    }

    point_history {
        int id PK
        int match_id FK
        int set_number
        int game_number
        int point_number
        text winner_side
        int winner_player_id FK
        text method
        text stroke
        boolean is_net_point
        text score_after_pair_a
        text score_after_pair_b
        boolean is_game_point
        boolean is_set_point
        boolean is_match_point
    }

    match_sets {
        int id PK
        int match_id FK
        int set_number
        int pair_a_games
        int pair_b_games
    }

    commentary {
        int id PK
        int match_id FK
        int set_number
        int game_number
        text message
        text[] tags
    }
```

---

## 🔐 Seguridad

| Capa | Mecanismo |
|:--|:--|
| Rate Limiting | Upstash Redis (5 req/10s por IP en `/ws`) |
| IoT Auth | Token único por pista (`courts.authToken`) |
| Validación | Zod schemas estrictos en cada entrada |
| IP Detection | `CF-Connecting-IP` → `X-Forwarded-For` → Socket IP |

---

## 📁 Estructura de Archivos

```
src/
├── index.ts              # Entry point (Hono + Bun.serve)
├── routes/
│   ├── matches.ts        # CRUD partidos + POST point
│   └── commentary.ts     # GET/POST commentary
├── ws/
│   ├── server.ts         # Router WS (open/message/close)
│   ├── utils.ts          # sendJson, broadcast functions
│   └── handlers/
│       ├── subscription.ts  # SUBSCRIBE/UNSUBSCRIBE
│       ├── stats.ts         # REQUEST_STATS
│       └── iot.ts           # AUTH_DEVICE, TELEMETRY_EVENT
├── controllers/
│   └── match.ts          # processPointScored, getMatchSnapshot
├── utils/
│   ├── padelScoring.ts   # PadelEngine (lógica pura)
│   ├── match-status.ts   # Cálculo de estado
│   └── commentaryBot.ts  # Generador de comentarios
├── db/
│   ├── db.ts             # Cliente Drizzle
│   └── schema.ts         # Tablas + Relaciones + Enums
├── types/
│   ├── index.ts             # Barrel export centralizado
│   ├── db.types.ts          # Tipos inferidos de Drizzle (Match, Player, enums)
│   ├── padel.types.ts       # MatchSnapshot, PointOutcome, TelemetryData
│   └── websocket.types.ts   # ClientMessage, ServerMessage, WebSocketData
└── validation/
    ├── matches.ts        # createMatchSchema
    ├── commentary.ts     # createCommentarySchema
    └── point_action.ts   # pointActionSchema
```

---

> [!TIP]
> **Extensibilidad IoT:** Para añadir una nueva pista, insertar fila en `courts` con un `authToken` único. La cámara usa ese token para autenticarse y enviar telemetría.

> [!IMPORTANT]
> **Stateless Engine:** `PadelEngine` es puro y no accede a la DB. El Controller es responsable de la persistencia y el broadcast.
