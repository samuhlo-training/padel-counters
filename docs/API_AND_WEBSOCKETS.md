# 📡 API_REFERENCE & WEBSOCKETS

> **VERSION:** 1.0.0
> **STATUS:** STABLE
> **BASE_URL:** `http://localhost:8000` (Dev)

---

## 00 __ OVERVIEW

Hybrid communication model combining standard REST resources with high-performance WebSockets.

| CHANNEL | TECH | USE CASE |
| :--- | :--- | :--- |
| **REST API** | `Hono` | Resource Management (Matches, Courts) |
| **WebSockets** | `Bun Native` | Real-time Streaming (Score, Telemetry) |

---

## 01 __ REST_API

### 01.1 __ MATCHES

#### `GET /matches`
Retrieve active/scheduled matches.

*   **Query Params**: `status`, `limit`, `offset`, `sortBy`
*   **Response**:

```json
{
  "data": [
    {
      "id": 12,
      "type": "friendly",
      "status": "live",
      "score": "6-4 2-3",
      "team_a": { "name": "Lebron / Galan", "sets_won": 1 },
      "team_b": { "name": "Tapia / Coello", "sets_won": 0 }
    }
  ],
  "meta": { "count": 1 }
}
```

#### `POST /matches`
Schedule/Create a match.

```json
{
  "pairAPlayer1Id": 1,
  "pairAPlayer2Id": 2,
  "pairBPlayer1Id": 3,
  "pairBPlayer2Id": 4,
  "courtId": 1,
  "hasGoldPoint": true
}
```

#### `POST /matches/:id/point`
Manual scoring fallback (Admin).

```json
{ "playerId": 1, "actionType": "winner", "stroke": "smash" }
```

### 01.2 __ COURTS

#### `GET /courts`
Real-time court status check.

```json
[
  { "id": 1, "name": "Central Court", "status": "busy", "activeMatchId": 12 },
  { "id": 2, "name": "Court 2", "status": "free", "activeMatchId": null }
]
```

### 01.3 __ SIMULATOR

#### `POST /simulator/start`
Trigger automated bot match.

```json
{ "courtId": 2 }
```

#### `POST /simulator/stop`
Halt simulation immediately.

```json
{ "matchId": 15 }
```

---

## 02 __ WEBSOCKET_PROTOCOL

> **ENDPOINT:** `/ws`
> **FORMAT:** JSON-based custom protocol

### 02.1 __ CLIENT_MESSAGES (Upstream)

#### `SUBSCRIBE`
Listen to specific match updates.

```json
{ "type": "SUBSCRIBE", "matchId": "12" }
```

#### `REQUEST_STATS`
On-demand statistics fetch.

```json
{ "type": "REQUEST_STATS", "matchId": "12", "subtype": "MATCH_SUMMARY" }
```

#### `AUTH_DEVICE` (IoT)
Authenticate camera/sensor for telemetry.

```json
{ "type": "AUTH_DEVICE", "token": "SECURE_TOKEN_123" }
```

#### `TELEMETRY_EVENT` (IoT)
Push new point data.

```json
{
  "type": "TELEMETRY_EVENT",
  "payload": {
    "playerId": 1,
    "method": "winner",
    "stroke": "smash",
    "speed": 145
  }
}
```

### 02.2 __ SERVER_MESSAGES (Downstream)

#### `MATCH_UPDATE`
Full state snapshot (after every point).

```json
{
  "type": "MATCH_UPDATE",
  "matchId": "12",
  "timestamp": 1710928392000,
  "snapshot": {
    "pairAScore": "15",
    "pairBScore": "30",
    "status": "live",
    "servingPlayerId": 3
    // ... complete state
  }
}
```

#### `COMMENTARY`
Real-time narrative feed.

```json
{
  "type": "COMMENTARY",
  "data": {
    "message": "¡Tremendo remate por tres de Galán!",
    "tags": ["highlight", "smash"]
  }
}
```

#### `COURT_UPDATE`
Global broadcast for dashboard availability.

```json
{
  "type": "COURT_UPDATE",
  "payload": { "courtId": 1, "status": "busy", "activeMatchId": 12 }
}
```
