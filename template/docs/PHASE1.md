# Phase 1 Plan

## Goal
Ship a stable, map-first MVP for Local Digital Towns with auth-by-code, intake + moderation, marketplace listings, auctions, giveaways, channels, and pulse. Prioritize safety, reliability, and a clear deploy path.

## Stage 0 - Baseline + Docs
**Scope**
- Document API contracts, architecture, and operational SOPs.
- Add baseline smoke tests.

**Acceptance Criteria**
- docs/PHASE1.md, docs/API_CONTRACTS.md, docs/ARCHITECTURE.mmd, docs/TERMINAL_CHEATSHEET.md, docs/CHATGPT_CODEX_SOP.md exist and are readable.
- scripts/smoke.sh runs against BASE_URL and exits non-zero on disallowed responses.

## Stage 1 - Auth-by-Code + Session
**Scope**
- Email/SMS code delivery (provider stub ok).
- Code verification, session creation, logout.
- /api/me returns current session profile.

**Acceptance Criteria**
- Auth request and verify endpoints return stable JSON per contract.
- Session cookie or token set on verify; /api/me returns user context.
- Smoke tests include auth happy path and invalid code path.

## Stage 2 - Intake + Moderation
**Scope**
- User intake submissions (profile + location + intent).
- Admin review queue and decisioning.

**Acceptance Criteria**
- Intake submission stored and retrievable by ID.
- Admin approve/reject updates status and records reason.
- Moderation actions audit trail captured.

## Stage 3 - Marketplace (Buy-It-Now)
**Scope**
- Listing create/read/update.
- Purchase flow with order record.

**Acceptance Criteria**
- Listing lifecycle supports draft → active → sold.
- Purchase creates order and marks listing sold.
- Smoke tests cover listing read and buy-it-now.

## Stage 4 - Auctions
**Scope**
- Auction create and bid placement.
- Auction lifecycle: scheduled → live → ended.

**Acceptance Criteria**
- Bids validate min increment and timing rules.
- Close auction selects winner and creates order record.
- Smoke tests cover bid placement and auction close.

## Stage 5 - Giveaways
**Scope**
- Giveaway creation, entry, draw, and claim.

**Acceptance Criteria**
- Draw picks a winner using deterministic seed for audit.
- Claim records winner and prevents duplicate claims.
- Smoke tests cover entry + draw + claim.

## Stage 6 - Channels + Pulse
**Scope**
- Channels with messages.
- Pulse feed for map-first updates.

**Acceptance Criteria**
- Channels allow post + read with permission checks.
- Pulse feed returns latest entries with geo context.
- Smoke tests cover channel post/read and pulse read.

## Stage 7 - Admin + Ops
**Scope**
- Admin dashboards and moderation tools.
- Operational endpoints for health and debugging.

**Acceptance Criteria**
- Admin endpoints require admin role.
- /health stable and used by deploy checks.
- Smoke tests cover admin auth gating and /health.

## Stage 8 - Launch
**Scope**
- Staging hardening, production rollout, and monitoring.

**Acceptance Criteria**
- Staging runs full smoke suite with green results.
- Production deploy uses the same flow and passes smoke checks.

---

## Deploy Flow (Feature → Staging → Prod)
1) Create feature branch from main: `git checkout -b feature/<short-name>`.
2) Implement changes + update docs/tests.
3) Run local smoke: `BASE_URL=http://localhost:3000 bash scripts/smoke.sh`.
4) Commit with scope: `git commit -m "feat: <short summary>"`.
5) Push: `git push origin feature/<short-name>`.
6) Open PR → require review + green CI.
7) Merge to `main`.
8) Deploy to staging:
   - `git pull origin main` on staging runner.
   - `npm install` (or locked install) and restart service.
   - Run `BASE_URL=https://staging.<domain> bash scripts/smoke.sh`.
9) If staging is green, deploy to prod:
   - `git pull origin main` on prod runner.
   - `npm install` (or locked install) and restart service.
   - Run `BASE_URL=https://<domain> bash scripts/smoke.sh`.
10) Announce release + monitor errors and logs for 30 minutes.
