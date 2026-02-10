<div align="center">
  <br />
  <br />

  # <code>padel-counters</code>

  **MOTOR DE COMENTARIOS DEPORTIVOS EN TIEMPO REAL**
  <br />

  [![Bun](https://img.shields.io/badge/bun-v1.2.16-black?style=for-the-badge&logo=bun)](https://bun.sh)
  [![Hono](https://img.shields.io/badge/hono-E36002?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
  [![TypeScript](https://img.shields.io/badge/typescript-%23007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Drizzle](https://img.shields.io/badge/drizzle-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
  [![Neon](https://img.shields.io/badge/neon-00E599?style=for-the-badge&logo=neon&logoColor=black)](https://neon.tech/)


  <br />
  <br />
</div>

---

### 00 __ OVERVIEW

> **ABSTRACT:** Backend especializado para la gestión y arbitraje de partidos de **Pádel** en tiempo real. Incluye un motor de puntuación completo (Sets, Tie-breaks, Puntos de Oro), telemetría IoT y narración automática distribuida vía WebSockets.
>
> **ESTADO:** ⚠️ EN DESARROLLO PERO FUNCIONAL.


---

### 01 __ ARQUITECTURA Y DECISIONES

| COMPONENTE | TECNOLOGÍA | NOTA |
| :--- | :--- | :--- |
| **Runtime** | `Bun` | Ejecución JS/TS nativa de baja latencia |
| **Router** | `Hono` | Estándares Web, middleware ligero y tipado |
| **Real-time** | `Bun WebSocket` | Implementación C++ optimizada (sin `ws` lib) |
| **Database** | `Neon (Postgres)` | Serverless SQL para escalabilidad automática |
| **ORM** | `Drizzle` | Introspección de esquema y consultas type-safe |
| **Protection** | `Upstash Redis` | Rate Limiting distribuido (Sliding Window) |

#### 🏗️ Diagrama de Arquitectura

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


<br>

### 02 __ INSTALACIÓN

*Iniciar entorno de desarrollo:*

```bash
# 1. Clonar repositorio
git clone https://github.com/samuhlo-training/padel-counters.git

# 2. Instalar dependencias
bun install

# 3. Sincronizar Base de Datos (Requiere .env)
bun run db:generate
bun run db:migrate

# 4. Iniciar Servidor
bun run dev
```

### 02.1 __ VARIABLES DE ENTORNO

Para que los comandos de base de datos y el limitador de trafico funcionen correctamente, es necesario configurar un archivo `.env` en la raíz del proyecto:

| VARIABLE | DESCRIPCIÓN | NOTA |
| :--- | :--- | :--- |
| `DATABASE_URL` | String de conexión a Postgres (Neon) | Necesario para ORM y migraciones |
| `UPSTASH_REDIS_REST_URL` | URL de la API REST de Upstash Redis | Control de tráfico (Rate Limit) |
| `UPSTASH_REDIS_REST_TOKEN` | Token de autenticación de Upstash | Control de tráfico (Rate Limit) |
| `PORT` | Puerto donde correrá el servidor | Opcional (Default: `8000`) |
| `HOST` | Host para la interfaz de red | Opcional (Default: `0.0.0.0`) |

#### Estructura sugerida (`.env`)
```bash
# PostgreSQL Connection (Neon)
DATABASE_URL='postgresql://user:password@host.aws.neon.tech/neondb?sslmode=require'

# Upstash Redis (Serverless Rate Limiting)
UPSTASH_REDIS_REST_URL='https://your-instance.upstash.io'
UPSTASH_REDIS_REST_TOKEN='your_auth_token'

# Server Config
PORT=8000
HOST='0.0.0.0'
```

> **SEGURIDAD:** Mantén tus secretos seguros. El archivo `.env` contiene credenciales sensibles y **NUNCA** debe ser incluido en el control de versiones (Git).

### 02.2 __ MODELO DE DATOS

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
    }

    matches {
        int id PK
        varchar status
        int pair_a_games
        int pair_b_games
        text pair_a_score
        text pair_b_score
    }

    match_stats {
        int id PK
        int match_id FK
        int player_id FK
        int points_won
    }

    point_history {
        int id PK
        int match_id FK
        text winner_side
    }
```

> [!NOTE]
> *Diagrama simplificado. Ver `docs/CURRENT_STATE_DOCS.md` para el esquema completo.*


### 03 __ CARACTERÍSTICAS CLAVE

*   **Zero-Overhead WebSockets**: Uso directo de `Bun.upgrade` integrado en Hono.
*   **Resilient Rate Limiting**: Middleware con estrategia "Fail-open" (si Redis cae, el tráfico pasa).
*   **Domain-Driven Structure**: Organización por módulos (`routes/matches`, `ws/server`) en lugar de capas técnicas puras.
*   **Strict Typing**: Schema validation con Zod + TypeScript en cada frontera (HTTP & DB).

### 03.1 __ API & WEBSOCKETS

#### 🌐 REST API (Hono)

| Método | Endpoint | Acción |
| :--- | :--- | :--- |
| `GET` | `/matches` | Lista de partidos activos |
| `POST` | `/matches` | Crear nuevo partido |
| `POST` | `/matches/:id/point` | Registrar punto y actualizar score |
| `GET` | `/matches/:id/commentary` | Obtener feed de comentarios |
| `GET` | `/courts` | Consultar estado de pistas (Libre/Ocupada) |

#### ⚡ WebSockets (Bun native)

**Conexión:** `ws://HOST:PORT/ws`

| Evento (C→S) | Descripción |
| :--- | :--- |
| `SUBSCRIBE` | Suscribirse a actualizaciones de un partido |
| `AUTH_DEVICE` | Autenticar cámara/IoT para telemetría |
| `TELEMETRY_EVENT` | Enviar datos de golpeo (IoT) |
| `REQUEST_STATS` | Pedir estadísticas bajo demanda |

> [!TIP]
> Solo los clientes suscritos a un `matchId` reciben los eventos `MATCH_UPDATE` y `COMMENTARY` en tiempo real.


A. THE HOOK (RESILIENT MIDDLEWARE)
Intercepta conexiones WS, valida IP contra Redis Cloud y aplica lógica de fallback si el servicio externo falla.

```typescript
import { Hono } from "hono";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const app = new Hono();
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "10 s"),
});

// [BRUTALIST SNIPPET] :: src/index.ts
app.use("/ws", async (c, next) => {
  // A. IDENTIFICAR -> IP Fallback logic
  let ip = c.req.header("CF-Connecting-IP") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim();

  // B. VERIFICAR -> Pedir permiso a Redis (Fail-open Pattern)
  let limitResult;
  try {
    limitResult = await ratelimit.limit(ip || "127.0.0.1");
  } catch (error) {
    // [RESILIENCE] -> Si Redis falla, no bloqueamos el servicio
    limitResult = { success: true, remaining: Infinity };
  }

  if (!limitResult.success) {
    return c.text("ERROR: Rate limit exceeded. Relax.", 429);
  }

  await next();
});
```

### 04 __ CALIDAD Y PRUEBAS

El sistema cuenta con una suite de pruebas automatizadas que garantizan la integridad de la lógica de puntuación y la estabilidad de las comunicaciones en tiempo real.

| TIPO | ARCHIVO | COBERTURA |
| :--- | :--- | :--- |
| **Integración (API)** | `verify_matches.test.ts` | CRUD de partidos, estados y persistencia |
| **Integración (API)** | `verify_commentary.test.ts` | Feed de comentarios, filtros y ordenación |
| **Real-Time (WS)** | `verify_ws_snapshot.test.ts` | Suscripción y entrega de estado inicial |
| **Real-Time (WS)** | `verify_ws_bi_directional.test.ts` | Peticiones bajo demanda sobre WebSocket |
| **Lógica (Core)** | `verify_padel_flow.test.ts` | Flujo completo de sets, Gold Point y Tie-break |

*Para ejecutar la suite completa:*

```bash
bun test
```

### 05 __ ESTRUCTURA DEL PROYECTO

```text
src/
├── index.ts              # Entry point (Hono + Bun.serve)
├── routes/               # Endpoints REST (HTTP)
├── ws/                   # Lógica WebSockets (Handlers, Utils)
├── services/             # Lógica de negocio y persistencia
├── controllers/          # Orquestación de peticiones
├── utils/                # Engines (Scoring, CommentaryBot)
├── db/                   # Esquema Drizzle y conexión
├── types/                # Tipos TS centralizados
└── validation/           # Esquemas Zod (Validación estricta)
```

> [!NOTE]
> *Consultar `docs/CURRENT_STATE_DOCS.md` para un desglose detallado de cada archivo.*

<div align="center">
<br />

<code>DISEÑADO Y CODIFICADO POR <a href='https://github.com/samuhlo'>samuhlo</a></code>

<small>Lugo, Galicia</small>

</div>
