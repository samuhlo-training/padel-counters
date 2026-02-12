# 🔮 FEATURES_AND_REFACTORS

> **SCOPE:** ROADMAP & CHANGELOG
> **TARGET:** Q1 2026

---

## 01 __ COMPLETED_REFACTORS (FEB 2026)

| COMPONENT | TYPE | DETAILS | BENEFIT |
| :--- | :--- | :--- | :--- |
| **Match Service** | `REFACTOR` | Logic unified in `MatchService.createMatch` | Centralized validation & ACID transactions. |
| **Simulator** | `FEATURE` | New `/simulator` endpoints | Dev without IoT hardware. |
| **Seeding** | `SCRIPT` | `seed_enhanced_courts.ts` | Realistic court names & tokens. |
| **Iot Handler** | `SECURITY` | Strict **Zod** schema validation | Prevents crashes from malformed payloads. |

---

## 02 __ ROADMAP (FUTURE_WORK)

### 02.1 __ AUTHENTICATION
- [ ] **JWT Implementation**: Secure API endpoints (Admin vs User).
- [ ] **Role Guard**: Protect `POST /matches` from unauthorized scheduling.

### 02.2 __ MULTI-TENANCY
- [ ] **Tenant ID**: Add `clubId` to Courts and Matches schema.
- [ ] **Data Isolation**: Ensure clubs only see their own matches.

### 02.3 __ TELEMETRY_V2
- [ ] **Heatmaps**: Store `(x,y)` coordinates in `point_history`.
- [ ] **Momentum**: Real-time graph of match dominance calculation.

### 02.4 __ RESILIENCE
- [ ] **Reconnection Buffer**: "Last Event ID" pattern for micro-disconnections in WS.

### 02.5 __ MEDIA
- [ ] **Clip Linking**: Associate `pointHistory.id` with video timestamps if cameras support it.
