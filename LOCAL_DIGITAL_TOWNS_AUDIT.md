# Local Digital Towns — Comprehensive Codebase Audit

**Audit Date:** February 2026
**Codebase Version:** 1.0.0
**Auditor:** Claude Code (automated static analysis)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Analysis](#2-architecture-analysis)
3. [Feature Inventory](#3-feature-inventory)
4. [Code Quality Assessment](#4-code-quality-assessment)
5. [Security Audit](#5-security-audit)
6. [Performance Review](#6-performance-review)
7. [Scalability & Deployment](#7-scalability--deployment)
8. [Documentation Status](#8-documentation-status)
9. [Issues & Recommendations](#9-issues--recommendations)
10. [Business-Relevant Summary](#10-business-relevant-summary)

---

## 1. Project Overview

### What It Is

Local Digital Towns (LDT) is a full-stack community marketplace platform designed for hyperlocal digital economies. The pilot deployment serves **Sebastian, Florida** at `sebastian-florida.com`. The platform combines a marketplace, community channels, gamified engagement (sweepstakes), trust-based identity verification, live streaming, and seller commerce tools into a single monolithic application.

### Key Stats

| Metric | Value |
|--------|-------|
| Language | Node.js (CommonJS) |
| Framework | Express 5.2.1 |
| Database | PostgreSQL 16 + Redis |
| Main server file | 7,266 lines |
| Data access layer | 4,202 lines (150+ exported functions) |
| Frontend files | 49 HTML, 46+ JS, 13 CSS |
| Largest frontend file | `app.js` — 43,079 lines |
| Database tables | 63 (61 in migrations + 2 missing) |
| Database migrations | 31 files |
| API endpoints | 200+ routes |
| Dependencies | 16 runtime, 1 dev |
| Minimum Node | >= 18.0.0 |

### Entry Points

| Script | Purpose |
|--------|---------|
| `npm start` | Production server |
| `npm run dev` | Development with nodemon |
| `npm run start:auth` | Auth microservice (planned) |
| `npm run start:crm` | CRM microservice (planned) |
| `npm run worker:backup` | Database backup worker |
| `npm run worker:email` | Email queue worker |
| `npm run worker:sync` | CRM sync worker |
| `npm run worker:analytics` | Analytics aggregation worker |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed database |

### Tech Stack

- **Runtime:** Node.js >= 18
- **Web Framework:** Express 5.2.1
- **Database:** PostgreSQL 16 (via `pg` 8.11.5)
- **Cache/Queue:** Redis (via `ioredis` 5.3.2)
- **Payments:** Stripe 17.4.0 (Connect, Checkout, Subscriptions)
- **File Storage:** Cloudflare R2 (S3-compatible, via `@aws-sdk/client-s3`)
- **Email:** Resend API (primary), Nodemailer (legacy)
- **Error Monitoring:** Sentry (`@sentry/node` 10.36.0)
- **Auth:** bcryptjs + JWT + cookie sessions + Google OAuth
- **Security:** Helmet, CORS, express-rate-limit
- **Live Streaming:** Cloudflare Calls
- **Shipping:** Shippo REST API
- **Delivery:** Uber Direct API
- **Scheduled Tasks:** node-cron
- **File Uploads:** multer
- **Deployment:** Render.com

---

## 2. Architecture Analysis

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Render.com                            │
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  Web Server  │  │ Auth Service │  │ CRM Service  │      │
│  │  (main app)  │  │  (planned)   │  │  (planned)   │      │
│  │  port 10000  │  │  port 3002   │  │  port 3001   │      │
│  └──────┬───────┘  └─────────────┘  └─────────────┘      │
│         │                                                  │
│  ┌──────┴───────────────────────────────┐                 │
│  │           server.js (7,266 lines)     │                 │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  │                 │
│  │  │ Routes │  │  Auth  │  │Webhooks│  │                 │
│  │  │ (200+) │  │Middleware│ │(Stripe │  │                 │
│  │  │        │  │        │  │ Uber)  │  │                 │
│  │  └────────┘  └────────┘  └────────┘  │                 │
│  └──────┬───────────────────────────────┘                 │
│         │                                                  │
│  ┌──────┴───────────────────────────────┐                 │
│  │         data.js (4,202 lines)         │                 │
│  │     150+ DAO functions (SQL queries)  │                 │
│  └──────┬───────────────────────────────┘                 │
│         │                                                  │
│  ┌──────┴──────┐  ┌──────────┐                            │
│  │ PostgreSQL  │  │  Redis   │                            │
│  │   16        │  │          │                            │
│  └─────────────┘  └──────────┘                            │
│                                                           │
│  Workers: backup, email, sync, analytics                  │
└──────────────────────────────────────────────────────────┘
```

### Directory Structure

```
local-digital-towns/
├── server.js              # Main Express app (7,266 lines)
├── data.js                # Data access layer (4,202 lines)
├── package.json           # 16 dependencies
├── render.yaml            # Render deployment config
├── .env.example           # 40+ environment variables
├── town_directory.js      # Linked towns directory
├── town_config.js         # Town configuration
├── config/
│   ├── towns.js           # Multi-town routing
│   └── town-config.json   # Town-specific settings
├── lib/
│   ├── db.js              # PostgreSQL connection pool
│   ├── trust.js           # Modern trust/permission system
│   ├── permissions.js     # Legacy permissions (deprecated)
│   ├── notify.js          # Resend email notifications
│   └── r2.js              # Cloudflare R2 file uploads
├── db/
│   ├── migrate.js         # Migration runner
│   └── migrations/        # 31 SQL migration files (0001-0031)
├── scripts/
│   ├── generate_pulse.js  # Daily community digest
│   ├── migrate.js         # DB migration script
│   └── seed.js            # Database seeding
├── services/
│   ├── auth/              # Auth microservice (planned)
│   └── crm/               # CRM microservice (planned)
├── workers/               # Background job processors
└── public/                # Frontend (108+ files)
    ├── index.html         # Main town UI (943 lines)
    ├── app.js             # Main app logic (43,079 lines)
    ├── dashboard.html     # Seller dashboard
    ├── login.html/js      # Authentication
    ├── store.html/js      # Storefront
    ├── deposit.html       # Deposit payment
    ├── admin*.html/js     # 14 admin pages
    ├── js/
    │   ├── beta-banner.js # Beta warning banner
    │   ├── town.js        # Town config loader
    │   └── share.js       # Share utilities
    └── *.css              # 13 stylesheets
```

### Server Architecture (server.js)

The 7,266-line server.js is a monolith with the following structure:

| Section | Lines | Purpose |
|---------|-------|---------|
| Setup & Config | 1-100 | Dependencies, env, Stripe/Sentry init |
| DB Migration | 100-130 | Inline migration queries (ALTER TABLE) |
| Middleware | 130-328 | Helmet, CORS, rate-limit, static files, auth helpers |
| Stripe Webhook | 329-630 | Webhook handler (checkout, payment, subscription events) |
| API Routes | 630-7060 | 200+ route handlers |
| Error Handler | 7060-7080 | Global Express error handler |
| Cron Jobs | 7136 | Weekly batch order email (Friday 6am ET) |
| Server Start | 7140-7160 | Listen + DB init |
| Permissions | 7161-7266 | Inline permissions module |

### Auth System

Six auth middleware functions provide layered access control:

| Function | Purpose |
|----------|---------|
| `getUserId(req)` | Read `sid` cookie → lookup user from sessions table |
| `requireLogin(req, res)` | Returns userId or 401 |
| `isAdminUser(user)` | Checks `isAdmin` flag, email allowlist, or admin flag value |
| `requireAdmin(req, res)` | Requires login + admin check |
| `requirePerm(req, res, perm)` | Permission check via trust tier system |
| `requireBuyerTier(req, res)` | Specific buyer permission check |
| `requireSellerPlace(req, res)` | Requires seller with active place/store |

**Session Management:**
- Cookie: `sid` (session ID)
- Storage: `sessions` table (sid, userid, expiresat)
- Default max age: 30 days

### Data Layer (data.js)

The data access layer uses a DAO pattern with 150+ exported functions:

- **`stmt()` helper** wraps `db.query`/`db.one`/`db.many` into `{ get, all, run }` interface
- **`toCamelCase()`** normalizes PostgreSQL snake_case columns to camelCase via 85+ regex replacements
- All queries use parameterized SQL (`$1`, `$2`) to prevent injection
- Critical operations wrapped in `BEGIN`/`ROLLBACK` transactions
- All dates stored and returned as ISO strings

### Library Modules

| Module | Lines | Purpose |
|--------|-------|---------|
| `lib/db.js` | 57 | PostgreSQL pool (max 20, idle 30s, connect 5s timeout, SSL) |
| `lib/trust.js` | ~200 | Modern trust tier system with `resolveTier()`, `hasPerm()`, `can()` |
| `lib/permissions.js` | ~80 | Legacy permission system (superseded by trust.js) |
| `lib/notify.js` | ~50 | Resend email with `sendAdminEmail()`, `sendEmail()` |
| `lib/r2.js` | ~60 | Cloudflare R2 uploads with unique keys and prefix organization |

### Multi-Tenant Design

- `townId` column on most database tables
- `config/towns.js` — `getCurrentTown()` for town routing
- `config/town-config.json` — Per-town settings (names, URLs, rules, templates)
- `window.__TOWN_CONFIG__` — Frontend town configuration injection
- Currently single-tenant (Sebastian, FL) with architecture for expansion

---

## 3. Feature Inventory

### 3.1 Marketplace

| Feature | Status | Notes |
|---------|--------|-------|
| Item listings (buy/sell) | Working | Title, price, photos, category, quantity |
| Offers (negotiations) | Working | Buyer-seller offer flow |
| Requests (wanted posts) | Working | Community request board |
| Auctions with bidding | Working | Start bid, auto-close, winner management |
| Shopping cart | Working | Multi-item cart with checkout |
| Stripe checkout | Working | Order payment via Stripe sessions |
| Category browsing | Working | Filter by category/type |
| Search/filtering | Partial | Basic category filtering |

### 3.2 Seller Commerce Tools

| Feature | Status | Notes |
|---------|--------|-------|
| Seller dashboard | Working | KPIs: revenue, orders, deposits, daily breakdown |
| Invoice system | Working | Create, send, pay via Stripe Connect |
| Deposit system (anti-ghosting) | Working | 5%/10% deposits, forfeit/refund workflow |
| Stripe Connect | Working | Seller onboarding, payout splitting |
| Customer list | Working | Email, name, purchase count, total spent |
| Email broadcasts | Working | Send to customer list via Resend |
| Sales analytics | Working | Revenue by product, top customers, weekly revenue, AOV |
| CSV exports | Working | Users, orders, subscriptions, places |
| Facebook/ManyChat webhooks | Working | Comment-to-pay, listing sync |
| Shippo shipping | Working | Rate quotes, label purchase, tracking notification |
| Uber Direct delivery | Working | Quote, dispatch, tracking |

### 3.3 Trust & Identity System

| Feature | Status | Notes |
|---------|--------|-------|
| 5-tier trust system | Working | Visitor (0) → Individual (1) → Verified Resident (2) → Business (3) → Admin (4) |
| Location verification | Working | GPS bounding box check |
| Resident verification | Working | Application + admin approval |
| Business verification | Working | Application + admin approval |
| Buyer verification | Working | Admin-gated buyer access |
| Trust applications | Working | User applies, admin reviews |
| Progressive permissions | Working | Tier-based feature gating |

### 3.4 Community Features

| Feature | Status | Notes |
|---------|--------|-------|
| Channels (public discussion) | Working | Create, message, threads, image uploads |
| Direct messaging | Working | User-to-user conversations |
| Store conversations | Working | Buyer-seller messaging per store |
| Channel moderation | Working | Mute users, moderator roles |
| Channel requests | Working | Users request new channels |
| Events/Calendar | Working | Submit, approve, RSVP |
| Live streaming | Partial | Cloudflare Calls integration, UI complete |
| Scheduled live shows | Working | Host scheduling, bookmarks |
| Store following | Working | Follow/unfollow stores |
| Social sharing | Working | Share purchases, wins, reviews to Facebook/Twitter |
| Daily Pulse (digest) | Working | Auto-generated community metrics + highlights |
| Archive | Working | Historical community records |

### 3.5 Sweepstakes & Gamification

| Feature | Status | Notes |
|---------|--------|-------|
| Sweepstake creation | Working | Title, prize, dates, entry cost |
| Rule-based entries | Working | Earn entries via: message, listing, purchase, review, share |
| Entry caps/cooldowns | Working | Anti-gaming controls |
| Weighted random drawing | Working | Winner selection with snapshot |
| Prize claiming | Working | Message + photo confirmation |
| Prize offers (donations) | Working | Community members donate prizes |
| Giveaway offers | Working | Bridge between businesses and sweepstakes |
| Winner announcement | Working | Channel post + email notification |
| Spin wheel UI | Working | Animated visual wheel component |

### 3.6 Business Subscriptions

| Feature | Status | Notes |
|---------|--------|-------|
| Individual plan (free) | Working | Tier 1 access |
| Business plan ($10/mo) | Working | Stripe subscription |
| 7-day trial | Working | Trial period on signup |
| Stripe customer portal | Partial | TODO in code for individual subscriptions |
| Subscription management | Working | Cancel, reactivate, upgrade |
| Giveaway rewards | Working | Free month for prize donors |

### 3.7 Referral Program

| Feature | Status | Notes |
|---------|--------|-------|
| Referral code generation | Working | 8-char alphanumeric codes |
| Referrer registration | Working | Opt-in referral program |
| Commission tracking | Working | Per-invoice earnings |
| Referral stats | Working | Total referred, active, balance |
| Cashout requests | Working | Request payout of earnings |

### 3.8 Ghost Reports

| Feature | Status | Notes |
|---------|--------|-------|
| Report non-paying buyers | Working | 48-hour wait period |
| Ghost percentage tracking | Working | Per-buyer reliability score |
| Ghost statistics | Working | Aggregate reporting |

### 3.9 Admin Dashboard

| Feature | Status | Notes |
|---------|--------|-------|
| Store application review | Working | Approve/reject stores |
| Event moderation | Working | Approve/deny events |
| Trust tier management | Working | Set user tiers |
| Analytics dashboard | Working | Users, places, listings, orders, revenue |
| Media management | Working | Upload tracking, orphan detection |
| Pulse export | Working | Generate + share daily digest |
| Sweepstake management | Working | Create, draw, notify, rules |
| User CSV exports | Working | Export users, orders, subscriptions |
| Support ticket review | Working | View and respond to tickets |
| Waitlist management | Working | Approve/reject signups |
| Batch order emails | Working | Weekly cron (Friday 6am ET) |
| Delivery tracking | Working | Uber Direct status |

### 3.10 Email Notifications

| Trigger | Status |
|---------|--------|
| Auth code (login) | Working |
| Invoice sent to buyer | Working |
| Deposit request sent | Working |
| Shipping tracking | Working |
| Customer broadcast | Working |
| Admin notifications | Working |
| Prize winner notification | Working |
| Application status updates | Working |

### 3.11 Public/Landing Pages

| Page | Status |
|------|--------|
| Landing page (`/`) | Working |
| Login (`/login`) | Working |
| Verify (`/verify`) | Working |
| Waitlist (`/waitlist`) | Working |
| Apply Business (`/apply/business`) | Working |
| Apply Resident (`/apply/resident`) | Working |
| Privacy Policy (`/privacy`) | Working |
| Terms of Service (`/terms`) | Working |
| Subscribe (`/subscribe`) | Working |
| Coming Soon (`/coming_soon.html`) | Working |

---

## 4. Code Quality Assessment

### 4.1 Strengths

**Consistent Data Layer Pattern**
- All database access goes through `data.js` — no raw SQL in route handlers
- Parameterized queries throughout (`$1`, `$2` placeholders)
- Transaction wrapping for multi-step operations

**Clean API Design**
- RESTful endpoint naming (`GET /api/seller/invoices`, `POST /api/orders/:id/review`)
- Consistent JSON response format
- Proper HTTP status codes (200, 201, 400, 401, 403, 404, 500)

**Progressive Feature Gating**
- Trust tier system cleanly separates user capabilities
- Multiple auth middleware functions for different access levels
- Feature flags (`LOCKDOWN_MODE`, `SWEEP_TEST_MODE`)

**Modular Library Code**
- `lib/` modules are focused and well-separated
- `lib/trust.js` is a clean, testable module with clear resolution logic
- `lib/r2.js` has good error handling and validation

### 4.2 Weaknesses

**Monolith Scale Issues**
- `server.js` at 7,266 lines is too large for a single file — should be split into route modules
- `data.js` at 4,202 lines contains every query for every feature — should be split by domain
- `public/app.js` at 43,079 lines is extremely large for a frontend file

**Column Naming Inconsistency**
- Original tables use camelCase in SQL (`userId`, `placeId`, `createdAt`)
- PostgreSQL silently lowercases these to `userid`, `placeid`, `createdat`
- Newer commerce tables (invoices, deposits, shipments) correctly use snake_case (`user_id`, `place_id`)
- `toCamelCase()` in data.js has 85+ regex replacements to normalize this mismatch
- This is a maintenance burden and source of subtle bugs

**Duplicate Permission Systems**
- `lib/trust.js` (modern, hierarchical tier resolution)
- `lib/permissions.js` (legacy, simpler tier-to-perms mapping)
- Both are loaded and used in different parts of the codebase
- Server.js also has inline permission functions at lines 7161-7266

**Inconsistent Error Handling**
- Some routes use try/catch with proper error responses
- Others let errors propagate to the global handler
- Some webhook handlers silently swallow errors
- No structured error logging format

**No Test Suite**
- Zero unit tests
- Zero integration tests
- No test framework in dependencies
- No CI/CD test pipeline
- Only a manual smoke test script exists (for PlantPurges, not LDT)

### 4.3 Code Metrics

| Metric | Assessment |
|--------|------------|
| Modularity | Low — 3 mega-files hold most logic |
| Naming consistency | Low — mixed camelCase/snake_case across tables |
| DRY principle | Medium — some duplication in route handlers |
| Error handling | Medium — inconsistent across routes |
| Comments/docs | Low — minimal inline documentation |
| Type safety | None — no TypeScript, no JSDoc types |
| Test coverage | None — 0% |
| Dependency hygiene | Good — 16 deps, all actively maintained |

---

## 5. Security Audit

### 5.1 Critical Issues

#### CRIT-1: Missing Database Tables (invoices, deposits)

The `invoices` and `deposits` tables are extensively queried throughout server.js (dashboard stats, revenue calculations, checkout flows, webhook handlers) but **no migration file creates these tables**. The application depends on ALTER TABLE statements in the inline migration section (server.js lines 100-130) to add columns, implying these tables were created manually or via a missing migration.

**Risk:** New deployments will fail. Any database rebuild will lose these tables.
**Fix:** Create a proper migration (0032) that includes `CREATE TABLE IF NOT EXISTS` for invoices and deposits with all referenced columns.

#### CRIT-2: Google OAuth JWT Not Verified

The Google OAuth callback trusts the `id_token` from the token exchange without verifying its signature against Google's public keys. An attacker who can intercept the token exchange could forge identity claims.

**Risk:** Account takeover via forged OAuth tokens.
**Fix:** Use Google's token verification endpoint or verify the JWT signature locally.

### 5.2 High Issues

#### HIGH-1: Stripe Webhook Signature Verification Fragile

The Stripe webhook handler wraps signature verification in a try/catch. If `STRIPE_WEBHOOK_SECRET` is not set or verification fails, behavior depends on the catch handler — which may still process the event.

**Risk:** Forged webhook events could mark orders as paid or create subscriptions.
**Fix:** Hard-fail if signature verification fails. Never process unverified webhook events.

#### HIGH-2: Referral Earnings Recorded Before Payment Confirmation

Referral commissions may be recorded during checkout session creation rather than after payment confirmation via webhook.

**Risk:** Referrers could earn commissions on unpaid orders.
**Fix:** Move referral earning recording to the Stripe webhook handler after payment confirmation.

#### HIGH-3: Session Cookie Security

The `sid` session cookie configuration should be reviewed for:
- `httpOnly: true` (prevent XSS access)
- `secure: true` (HTTPS only in production)
- `sameSite: 'lax'` or `'strict'` (CSRF protection)

**Risk:** Session hijacking via XSS or CSRF.
**Fix:** Audit cookie options and enforce secure defaults in production.

#### HIGH-4: Admin Login via Passphrase

Admin login uses a shared passphrase (`ADMIN_LOGIN_PASSPHRASE` env var) rather than per-user credentials. Anyone with the passphrase can access admin features.

**Risk:** Shared secret with no audit trail of which admin performed actions.
**Fix:** Implement per-admin authentication with activity logging.

### 5.3 Medium Issues

#### MED-1: No CSRF Protection

The application has no CSRF token mechanism. State-changing POST/PUT/DELETE requests are protected only by session cookies.

**Risk:** Cross-site request forgery attacks.
**Fix:** Implement CSRF tokens or use `SameSite=Strict` cookies.

#### MED-2: XSS Risk in Channel Messages

Channel messages accept user text that may be rendered as HTML in the frontend. Without proper sanitization, this is an XSS vector.

**Risk:** Stored XSS via channel messages.
**Fix:** Ensure all user content is escaped before rendering. Use `textContent` instead of `innerHTML`.

#### MED-3: Missing Rate Limiting on Sensitive Endpoints

While `express-rate-limit` is configured globally, sensitive endpoints like login, admin login, and payment creation may need stricter per-endpoint rate limits.

**Risk:** Brute force attacks on auth codes or admin passphrase.
**Fix:** Add specific rate limiters to auth and payment endpoints.

#### MED-4: No Input Validation Library

Route handlers manually validate input with ad-hoc checks. There's no schema validation library (like Joi, Zod, or express-validator).

**Risk:** Inconsistent validation, potential bypass of business rules.
**Fix:** Adopt a validation library for request body/params/query validation.

### 5.4 Low Issues

#### LOW-1: Debug Routes in Production

Debug endpoints exist (`/debug/context`, `/debug/routes`, `/api/debug/env`) that could leak environment information.

**Risk:** Information disclosure.
**Fix:** Gate behind `requireAdmin` or disable in production.

#### LOW-2: Helmet CSP Configuration

The Content Security Policy configured via Helmet should be audited to ensure it's not overly permissive (e.g., allowing inline scripts, connecting to arbitrary origins).

#### LOW-3: CORS Configuration

`CORS_ORIGINS` is configured via environment variable. Verify that the allowed origins list is minimal and correct for production.

### 5.5 Security Strengths

- All SQL queries use parameterized placeholders (no string concatenation)
- Passwords hashed with bcryptjs
- Auth codes have 10-minute expiry and 60-second cooldown
- Helmet configured for security headers
- Rate limiting enabled globally
- Email addresses redacted in logs
- SSL support for database connections
- File upload validation via multer

---

## 6. Performance Review

### 6.1 Database Performance

**Connection Pool Configuration:**
- Max connections: 20
- Idle timeout: 30 seconds
- Connection timeout: 5 seconds
- Type conversion for TIMESTAMPTZ to ISO strings

**Indexing Coverage:**
The database has 80+ indexes across 63 tables. Key indexes include:
- Foreign key indexes on all major relationships
- Composite indexes for common query patterns
- Unique constraints where appropriate (e.g., `userId + placeId` for follows)

**Missing Indexes (potential):**
- `invoices.place_id` — used in dashboard stats queries
- `invoices.status` — filtered frequently
- `deposits.place_id` — used in deposit listings
- `deposits.status` — filtered frequently
- These tables are missing from migrations entirely (see CRIT-1)

### 6.2 Query Performance Concerns

**N+1 Query Patterns:**
- `getOrdersForSellerPlaces(placeIds)` — may execute separate queries per place
- Customer list endpoint joins orders with users for aggregation
- Frontend loads store names in separate API calls per order

**Large Result Sets:**
- `getAllUsers()`, `getAllOrders()` — no pagination, returns all records
- Admin export endpoints (`/api/admin/export/*.csv`) load entire tables
- `getListings()` returns all listings without pagination

**`toCamelCase()` Overhead:**
- Every query result row passes through 85+ regex replacements
- This runs on every database read operation
- Could be optimized by fixing column names at the database level

### 6.3 Frontend Performance

**Critical Issue — `app.js` is 43,079 lines:**
- Single JavaScript file for the entire application
- No code splitting, lazy loading, or bundling
- No minification or compression configured
- Full download required on first page load

**No Build Pipeline:**
- Raw JavaScript served directly (no transpilation, no bundling)
- CSS files served individually (no concatenation)
- No asset fingerprinting for cache busting

**No Service Worker or PWA:**
- No offline support
- No push notifications
- No app manifest

### 6.4 Caching

- Redis is configured but usage in server.js is minimal
- No HTTP cache headers configured for static assets
- No query result caching
- `express.static` serves files without cache control headers

### 6.5 Performance Recommendations

1. **Split `app.js`** into feature modules with lazy loading
2. **Add pagination** to all list endpoints (listings, users, orders)
3. **Implement query caching** via Redis for frequently-accessed data (featured stores, active sweepstakes, town context)
4. **Fix column naming** at the database level to eliminate `toCamelCase()` overhead
5. **Add HTTP cache headers** to static assets
6. **Implement a build pipeline** (esbuild or Vite) for frontend bundling/minification
7. **Add database connection pooling metrics** to monitor pool exhaustion

---

## 7. Scalability & Deployment

### 7.1 Render.com Deployment (render.yaml)

**Web Services:**

| Service | Type | Port | Notes |
|---------|------|------|-------|
| digitaltowns-web | Public | 10000 | Main application |
| auth-service | Private | 3002 | Auth microservice (planned) |
| crm-service | Private | 3001 | CRM microservice (planned) |

**Background Workers:**

| Worker | Purpose |
|--------|---------|
| backup-worker | Database backups to Backblaze B2 |
| email-worker | Email queue processing |
| sync-worker | CRM and third-party sync |
| analytics-worker | Event aggregation |

**Databases:**

| Database | Type | Access |
|----------|------|--------|
| PostgreSQL 16 | Managed | Private network only |
| Redis | Managed | Private network only |

### 7.2 Multi-Town Architecture

The codebase supports multi-town deployment via:
- `townId` column on most database tables
- `config/towns.js` for town routing
- `config/town-config.json` for per-town customization
- `window.__TOWN_CONFIG__` for frontend configuration

**Current state:** Single-tenant (Sebastian, FL only). The architecture supports expansion but would require:
- DNS/routing for additional town subdomains
- Town-specific configuration entries
- Admin separation per town

### 7.3 Scalability Concerns

**Monolith Bottleneck:**
- All 200+ routes in a single process
- No horizontal scaling strategy beyond Render's auto-scaling
- Stripe webhooks, API routes, and static file serving share resources

**Database Scaling:**
- 20 connection pool limit may be insufficient under load
- No read replicas configured
- No connection pooler (PgBouncer) between app and database
- All queries go to a single database instance

**File Storage:**
- Cloudflare R2 provides global CDN for uploaded files
- No local file caching strategy

**Worker Architecture:**
- Workers defined in render.yaml but not fully implemented
- Email sending is synchronous in route handlers (should use queue)
- No job retry mechanism visible

### 7.4 Environment Variables

40+ environment variables organized by concern:

| Category | Variables |
|----------|-----------|
| App Config | NODE_ENV, PORT, TOWN_ID, TOWN_SLUG, TOWN_NAME, PUBLIC_BASE_URL, LOCKDOWN_MODE |
| Database | DATABASE_URL, REDIS_URL |
| Security | SESSION_SECRET, JWT_SECRET, JWT_EXPIRES_IN, CORS_ORIGINS |
| Stripe | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_BUSINESS_PRICE_ID, STRIPE_PRICE_ID, STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL |
| Email | SMTP_HOST/PORT/USER/PASS, EMAIL_FROM, RESEND_API_KEY, ADMIN_NOTIFICATION_EMAIL, ADMIN_NOTIFY_EMAILS |
| Storage | R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL |
| Backups | B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME, BACKUP_ENCRYPTION_KEY, BACKUP_SCHEDULE |
| OAuth | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL |
| Live | CF_CALLS_APP_ID, CF_CALLS_APP_SECRET, CF_CALLS_BASE_URL |
| Admin | ADMIN_EMAILS, ADMIN_LOGIN_PASSPHRASE |
| Monitoring | SENTRY_DSN, SENTRY_FORCE_ENABLE |

---

## 8. Documentation Status

### 8.1 Existing Documentation

| File | Content | Quality |
|------|---------|---------|
| README.md | Project overview, setup instructions | Basic |
| AGENTS.md | AI agent instructions for working on the codebase | Good |
| PRODUCTION_AUDIT.md | Previous production audit notes | Partial |
| PRODUCTION_CHECKLIST.md | Deployment checklist | Partial |
| .env.example | Environment variable documentation | Comprehensive |

### 8.2 Missing Documentation

| Document | Priority | Notes |
|----------|----------|-------|
| API Reference | High | 200+ endpoints undocumented |
| Database Schema | High | 63 tables with no ERD or schema docs |
| Architecture Decision Records | Medium | No record of design decisions |
| Deployment Guide | Medium | render.yaml exists but no runbook |
| Developer Onboarding | Medium | No setup-from-scratch guide |
| Feature Specifications | Low | Features exist but specs don't |
| Changelog | Low | No version history |

### 8.3 Inline Documentation

- Minimal code comments throughout
- No JSDoc annotations on functions
- Some TODO/FIXME comments:
  - `TODO: track actual billing period` (line 2028)
  - `TODO: Implement Stripe customer portal for individual subscriptions` (line 6093)
- No API documentation (no Swagger/OpenAPI spec)

---

## 9. Issues & Recommendations

### 9.1 Critical (Fix Immediately)

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| C1 | Missing invoices/deposits migration | New deployments fail | 1 day |
| C2 | Google OAuth JWT not verified | Account takeover risk | 1 day |
| C3 | No test suite | Cannot verify changes safely | 1-2 weeks |

### 9.2 High Priority (Fix This Sprint)

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| H1 | Stripe webhook signature can be bypassed | Payment fraud | 2 hours |
| H2 | Referral earnings before payment confirmation | Financial loss | 4 hours |
| H3 | Session cookie security flags | Session hijacking | 1 hour |
| H4 | Admin shared passphrase | No accountability | 1-2 days |
| H5 | Debug routes accessible in production | Information leak | 1 hour |

### 9.3 Medium Priority (Plan for Next Sprint)

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| M1 | Split server.js into route modules | Maintainability | 3-5 days |
| M2 | Split data.js into domain modules | Maintainability | 2-3 days |
| M3 | Fix column naming inconsistency | Eliminate toCamelCase overhead | 2-3 days |
| M4 | Add input validation library | Security, reliability | 2-3 days |
| M5 | Add CSRF protection | Security | 1 day |
| M6 | Add pagination to list endpoints | Performance | 2 days |
| M7 | Frontend build pipeline | Performance | 2-3 days |
| M8 | XSS sanitization audit | Security | 1-2 days |

### 9.4 Low Priority (Backlog)

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| L1 | API documentation (OpenAPI spec) | Developer experience | 3-5 days |
| L2 | TypeScript migration | Type safety, IDE support | 2-4 weeks |
| L3 | Redis caching for hot queries | Performance | 2-3 days |
| L4 | PWA support (service worker, manifest) | User experience | 2-3 days |
| L5 | Implement planned auth/CRM microservices | Scalability | 2-4 weeks |
| L6 | Split `app.js` (43K lines) into modules | Frontend maintainability | 1-2 weeks |
| L7 | Add database connection monitoring | Operations | 1 day |
| L8 | Remove legacy `lib/permissions.js` | Code cleanup | 2 hours |
| L9 | Standardize error response format | API consistency | 1-2 days |

### 9.5 Technical Debt Summary

| Category | Debt Level | Key Contributor |
|----------|-----------|-----------------|
| Code organization | High | 3 mega-files (server.js, data.js, app.js) |
| Testing | Critical | 0% test coverage |
| Security | High | OAuth, CSRF, XSS, debug routes |
| Performance | Medium | No pagination, no caching, no build pipeline |
| Documentation | High | No API docs, no schema docs |
| Database | High | Missing migrations, naming inconsistency |
| Frontend | High | 43K-line app.js, no build tool |
| Type safety | Medium | Pure JavaScript, no TypeScript |

---

## 10. Business-Relevant Summary

### What's Working Well

1. **Rich Feature Set:** The platform has an impressive breadth of features — marketplace, invoicing, deposits, channels, sweepstakes, live streaming, trust system, referrals, and admin tools. Most are functional and tested in production (Sebastian, FL pilot).

2. **Multi-Revenue Model:** The platform generates revenue through:
   - Business subscriptions ($10/month)
   - 2% platform fee on invoice transactions
   - Stripe Connect integration for seamless seller payments
   - Referral program encouraging growth

3. **Community Engagement Tools:** The sweepstakes/gamification system, Daily Pulse digest, and channel discussions drive engagement and retention.

4. **Anti-Fraud Measures:** The deposit system (anti-ghosting), trust tiers, ghost reporting, and buyer verification create accountability in local commerce.

5. **Third-Party Integrations:** Stripe (payments), Shippo (shipping), Uber Direct (delivery), Resend (email), Cloudflare (R2 storage, live streaming), and Google OAuth provide a professional-grade infrastructure.

### Key Risks

1. **No Tests = Fragile Deployments:** Every code change is a roll of the dice. With 200+ endpoints and complex business logic, a single regression could break payments, lose orders, or corrupt data.

2. **Security Gaps:** The Google OAuth vulnerability (CRIT-2) and weak webhook verification (HIGH-1) could lead to financial loss or account compromise.

3. **Scaling Ceiling:** The monolith architecture will hit performance limits as the platform grows. The 43K-line frontend file and 7K-line server file will slow down development velocity.

4. **Missing Migrations = Deployment Risk:** If the database needs to be rebuilt (disaster recovery, new environment), the invoices and deposits tables won't exist. This is the most immediately dangerous issue.

5. **Single Developer Risk:** The codebase has characteristics of a single-developer project (mega-files, no tests, minimal docs). Onboarding a second developer would be challenging.

### Recommended Priority for Business

| Priority | Action | Business Impact |
|----------|--------|-----------------|
| 1 | Create missing migrations (invoices, deposits) | Prevents deployment failures |
| 2 | Fix Google OAuth verification | Prevents account takeover |
| 3 | Add basic test suite (auth, payments, webhooks) | Enables safe deployment |
| 4 | Harden Stripe webhook verification | Prevents payment fraud |
| 5 | Split server.js into modules | Enables faster development |
| 6 | Add frontend build pipeline | Improves page load speed |
| 7 | Write API documentation | Enables team scaling |

### Platform Maturity Assessment

| Dimension | Score (1-5) | Notes |
|-----------|-------------|-------|
| Feature completeness | 4/5 | Comprehensive feature set, most working |
| Code quality | 2/5 | Functional but poorly organized |
| Security | 2/5 | Several critical and high issues |
| Performance | 2/5 | No optimization, no build pipeline |
| Scalability | 2/5 | Architecture supports it, implementation doesn't |
| Documentation | 1/5 | Almost no documentation |
| Test coverage | 0/5 | No tests exist |
| Deployment reliability | 3/5 | Render.com config good, but missing migrations |
| Developer experience | 2/5 | Hard to navigate, no tests, no types |
| **Overall** | **2/5** | **Feature-rich MVP that needs hardening** |

### Bottom Line

Local Digital Towns is a feature-rich MVP with an impressive breadth of functionality for a community marketplace. The core product vision — trust-based local commerce with gamified engagement — is well-executed in terms of features. However, the codebase has significant technical debt in code organization, security, testing, and documentation. The immediate priorities are:

1. **Stabilize** — Fix missing migrations and security vulnerabilities
2. **Test** — Add test coverage for critical paths (auth, payments, webhooks)
3. **Harden** — Address security issues (OAuth, CSRF, XSS, admin auth)
4. **Organize** — Split mega-files into maintainable modules
5. **Document** — Create API reference and developer onboarding guide

The platform is ready for a small pilot but would need the above improvements before scaling to multiple towns or onboarding additional developers.

---

*End of Audit Report*
