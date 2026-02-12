# 🧠 STATE_OF_THE_ART :: PADEL-COUNTERS

> **LAST_UPDATE:** FEB 2026
> **STATUS:** PRODUCTION_READY
> **DOCS_VERSION:** 2.0.0

---

## 01 __ SYSTEM_ARCHITECTURE

```mermaid
graph TB
    subgraph CLIENTS
        WEB[Web App]
        IOT[IoT Cameras]
    end

    subgraph SERVER["BUN SERVER"]
        HONO[Hono Router]
        WS[WebSocket Server]
        CTRL[Controllers]
        ENGINE[PadelEngine]
    end

    subgraph STORAGE
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

| COMPONENT | TECHNOLOGY |
| :--- | :--- |
| **Runtime** | `Bun 1.x` |
| **HTTP Router** | `Hono` |
| **WebSocket** | `Bun Native` (ServerWebSocket) |
| **Database** | `PostgreSQL` + `Drizzle ORM` |
| **Rate Limit** | `Upstash Redis` (Sliding Window) |
| **Validation** | `Zod` |

---

## 02 __ HTTP_INTERFACE (REST)

### 02.1 __ ROUTE_MANIFEST

| PREFIX | FILE | DESCRIPTION |
| :--- | :--- | :--- |
| `/matches` | `matches.ts` | Match CRUD & Operations |
| `/matches/:id/commentary` | `commentary.ts` | Minute-by-minute feed |
| `/courts` | `courts.ts` | Court status & Dashboard |

### 02.2 __ CORE_ENDPOINTS

| METHOD | ENDPOINT | DESCRIPTION | AFFECTED TABLES |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Health Check | - |
| `GET` | `/matches` | List Matches | `matches` |
| `POST` | `/matches` | Create Match | `matches`, `match_stats` |
| `POST` | `/matches/:id/point` | Register Point | `matches`, `point_history`, `match_stats` |
| `POST` | `/matches/:id/commentary` | Add Commentary | `commentary` |
| `GET` | `/courts` | List Courts | `courts` |

---

## 03 __ WEBSOCKET_INTERFACE

> **URL:** `ws://localhost:8000/ws`
> **RATE_LIMIT:** 5 connections / 10s per IP (Bypass in TEST)

### 03.1 __ CLIENT_TYPES

| TYPE | AUTHENTICATION | ALLOWED MESSAGES |
| :--- | :--- | :--- |
| **SPECTATOR** | None | `SUBSCRIBE`, `UNSUBSCRIBE`, `REQUEST_STATS` |
| **IOT_DEVICE** | Token (`AUTH_DEVICE`) | `TELEMETRY_EVENT` |

### 03.2 __ UPSTREAM_MESSAGES (Client -> Server)

```mermaid
flowchart LR
    subgraph SPECTATOR
        SUB["SUBSCRIBE {matchId}"]
        UNSUB["UNSUBSCRIBE {matchId}"]
        STATS["REQUEST_STATS {matchId...}"]
    end

    subgraph IOT_DEVICE
        AUTH["AUTH_DEVICE {token}"]
        TELEM["TELEMETRY_EVENT {metrics...}"]
    end
```

| TYPE | PAYLOAD | HANDLER | ACTION |
| :--- | :--- | :--- | :--- |
| `SUBSCRIBE` | `{matchId}` | `subscription.ts` | Join topic + Initial snapshot |
| `UNSUBSCRIBE` | `{matchId}` | `subscription.ts` | Leave topic |
| `REQUEST_STATS` | `{matchId, subtype}` | `stats.ts` | DB Query (On-demand) |
| `AUTH_DEVICE` | `{token}` | `iot.ts` | Validate Token vs Court |
| `TELEMETRY_EVENT` | `{stroke, speed...}` | `iot.ts` | Process Point + Auto-Commentary |

### 03.3 __ DOWNSTREAM_MESSAGES (Server -> Client)

| TYPE | PAYLOAD | TRIGGER |
| :--- | :--- | :--- |
| `WELCOME` | `message` | On Connection |
| `SUBSCRIBED` | `matchId` | Ack Subscription |
| `AUTH_SUCCESS` | `{courtName}` | Ack Broker Auth |
| `MATCH_UPDATE` | `{snapshot, lastPoint}` | Point Scored / Subscribed |
| `COMMENTARY` | `{message, tags}` | New Commentary Event |
| `COURT_UPDATE` | `{courtId, status}` | Court State Change |
| `ERROR` | `message` | Exception / Fail |

---

## 04 __ DATA_FLOW_SEQUENCES

### 04.1 __ MATCH_CREATION_FLOW

```mermaid
sequenceDiagram
    participant C as CLIENT
    participant H as HONO/SERVICE
    participant DB as POSTGRES
    participant WS as WEBSOCKET

    C->>H: POST /matches {body}
    H->>H: Zod Validation
    H->>DB: Check Court Availability
    alt Occupied
        H-->>C: 409 Conflict
    end
    H->>DB: TX: INSERT match + UPDATE court
    DB-->>H: Match Object
    H->>WS: Broadcast COURT_UPDATE (Busy)
    WS-->>C: {type: COURT_UPDATE}
    H-->>C: 201 Created
```

**Context:**
*   **Courts**: Atomic check for `activeMatchId IS NULL`.
*   **Init**: Create `match`, `match_stats` (x4), Update `court`.

### 04.2 __ POINT_SCORING_FLOW

```mermaid
sequenceDiagram
    participant C as CLIENT
    participant CTRL as CONTROLLER
    participant ENGINE as PADEL_ENGINE
    participant DB as POSTGRES
    participant WS as WEBSOCKET

    C->>CTRL: POST /point
    CTRL->>DB: Fetch Match State
    CTRL->>ENGINE: processPoint(state, action)
    ENGINE-->>CTRL: PointOutcome
    CTRL->>DB: TX: Insert Point + Update Stats/Score
    DB-->>CTRL: Commit
    CTRL->>WS: Publish MATCH_UPDATE
    WS-->>C: {type: MATCH_UPDATE}
    opt Match Finished
        CTRL->>DB: Free Court
        CTRL->>WS: Publish COURT_UPDATE (Free)
    end
    CTRL-->>C: 200 OK
```

### 04.3 __ IOT_TELEMETRY_FLOW

```mermaid
sequenceDiagram
    participant CAM as CAMERA_IOT
    participant WS as WS_SERVER
    participant IOT as IOT_HANDLER
    participant DB as POSTGRES
    participant BOT as COMMENTARY_BOT

    CAM->>WS: AUTH_DEVICE {token}
    WS->>IOT: Validate Token
    IOT->>DB: Get Court Info
    IOT-->>CAM: AUTH_SUCCESS

    CAM->>WS: TELEMETRY_EVENT {stroke, speed}
    WS->>IOT: Handle Event
    IOT->>DB: Get Active Match
    IOT->>IOT: Process Point (Reuse Logic)
    IOT->>BOT: Generate Narrative
    BOT-->>IOT: "Smash Winner!"
    IOT->>DB: Insert Commentary
    IOT->>WS: Broadcast COMMENTARY
    WS-->>CAM: {type: COMMENTARY}
```

### 04.4 __ PUB_SUB_BROADCAST_FLOW

> **NOTE:** Native Bun Pub/Sub ensures efficient topic-based delivery.

```mermaid
sequenceDiagram
    participant S1 as USER_A (Match 42)
    participant S2 as USER_B (Match 99)
    participant WS as SERVER

    Note over S1,S2: SUBSCRIPTION PHASE
    S1->>WS: SUBSCRIBE {matchId: 42}
    S2->>WS: SUBSCRIBE {matchId: 99}

    Note over WS: EVENT ON MATCH 42
    WS->>WS: server.publish("42", DATA)
    WS-->>S1: DATA (Received)
    Note over S2: IGNORED (Different Topic)
```

---

## 05 __ DATA_MODEL_SCHEMA

```mermaid
erDiagram
    players ||--o{ matches : "plays_in"
    matches ||--o{ match_stats : "tracks"
    matches ||--o{ point_history : "logs"
    matches ||--o{ match_sets : "contains"
    matches ||--o{ commentary : "has"
    courts ||--o| matches : "hosts"

    matches {
        int id PK
        string status
        string score
        int current_set
        boolean is_tie_break
        boolean gold_point
    }

    point_history {
        int id PK
        int match_id FK
        string method
        string stroke
        int speed
        string winner_side
    }

    match_stats {
        int id PK
        int player_id
        int winners
        int unforced_errors
    }
```

---

## 06 __ SECURITY_LAYERS

| LAYER | MECHANISM |
| :--- | :--- |
| **Rate Limiting** | `Upstash Redis` (5 req / 10s per IP) |
| **IoT Auth** | `AuthToken` (Unique per Court) |
| **Input Validation** | `Zod` (Strict Schemas) |
| **IP Detection** | `CF-Connecting-IP` / `X-Forwarded-For` |

---

## 07 __ FILE_MANIFEST

```text
src/
├── index.ts              # Entry Point
├── routes/
│   ├── matches.ts        # Match/Point Endpoints
│   └── commentary.ts     # Commentary Endpoints
├── ws/
│   ├── server.ts         # WS Router
│   ├── utils.ts          # Broadcast Logic
│   └── handlers/
│       ├── subscription.ts
│       ├── stats.ts
│       └── iot.ts
├── services/
│   └── matchService.ts   # Core Business Logic
├── utils/
│   ├── padelScoring.ts   # Pure Scoring Engine
│   └── commentaryBot.ts  # NLP Generator
└── db/
    └── schema.ts         # Drizzle Definitions
```
