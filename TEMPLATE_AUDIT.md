# TEMPLATE AUDIT — Sebastian-Specific References

> **Generated:** 2026-02-09
> **Codebase:** `/Users/rytasdirse/local-digital-towns`
> **Purpose:** Identify every Sebastian-specific hardcoded reference that must be templatized for multi-town deployment.

---

## Table of Contents

1. [Town Name & Branding](#1-town-name--branding)
2. [Domain & URL References](#2-domain--url-references)
3. [Email Addresses](#3-email-addresses)
4. [GPS Coordinates & Geofencing](#4-gps-coordinates--geofencing)
5. [Florida / Location-Specific References](#5-florida--location-specific-references)
6. [Database Schema (Column Names)](#6-database-schema-column-names)
7. [Data Layer (data.js)](#7-data-layer-datajs)
8. [Server Logic (server.js)](#8-server-logic-serverjs)
9. [Frontend — HTML Pages](#9-frontend--html-pages)
10. [Frontend — JavaScript](#10-frontend--javascript)
11. [Mobile App (Capacitor / Android)](#11-mobile-app-capacitor--android)
12. [Config Files](#12-config-files)
13. [Environment Variables & Startup](#13-environment-variables--startup)
14. [Deployment (render.yaml)](#14-deployment-renderyaml)
15. [Theme & Branding Assets](#15-theme--branding-assets)
16. [Social Share Text](#16-social-share-text)
17. [Email Templates](#17-email-templates)
18. [Database Migrations](#18-database-migrations)
19. [API Keys & Secrets](#19-api-keys--secrets)
20. [SVG / Image Assets](#20-svg--image-assets)

---

## 1. Town Name & Branding

All instances of "Sebastian", "Digital Sebastian", or "Sebastian Digital Town" used as display names.

| File | Line | Text |
|------|------|------|
| `town_config.js` | 79 | `name: "Sebastian"` |
| `town_config.js` | 78 | `slug: "sebastian"` |
| `town_config.js` | 80 | `state: "FL"` |
| `town_config.js` | 81 | `region: "Treasure Coast"` |
| `town_config.js` | 83 | `accent: "#00ffae"` (brand color) |
| `config/towns.js` | 16 | `slug: "sebastian"` |
| `config/towns.js` | 17 | `name: "Sebastian"` |
| `config/towns.js` | 18 | `fullName: "Digital Sebastian"` |
| `config/towns.js` | 58 | `welcomeMessage: "Welcome to Digital Sebastian!"` |
| `config/towns.js` | 62 | `supportEmail: "support@digitalsebastian.com"` |
| `config/towns.js` | 82 | `sebastian: {` (object key) |
| `config/towns.js` | 85 | `slug: "sebastian"` |
| `config/towns.js` | 86 | `name: "Sebastian"` |
| `config/towns.js` | 87 | `fullName: "Digital Sebastian"` |
| `config/towns.js` | 88 | `domains: ["digitalsebastian.com", "sebastian.digitaltowns.com", "localhost"]` |
| `config/towns.js` | 118 | `// Default to sebastian for development` |
| `config/towns.js` | 119 | `return towns.sebastian;` |
| `config/towns.js` | 126 | `return towns[slug] \|\| towns.sebastian;` |
| `config/towns.js` | 138 | `return towns.sebastian;` |
| `config/towns.js` | 146 | `const townSlug = process.env.TOWN_SLUG \|\| "sebastian";` |
| `server.js` | 38 | `displayName: isAdmin ? "Digital Sebastian" : ...` |
| `server.js` | 167 | `town: process.env.TOWN_NAME \|\| "Sebastian"` |

---

## 2. Domain & URL References

All hardcoded references to `sebastian-florida.com` and related domains.

| File | Line | Text |
|------|------|------|
| `server.js` | 605 | `const trackUrl = 'https://sebastian-florida.com/delivery-tracking?orderId=' + orderId;` |
| `server.js` | 611 | `from: 'Sebastian Express <noreply@sebastian-florida.com>'` |
| `server.js` | 1147 | `toEmail.endsWith("@sebastian-florida.com") ? "support@sebastian-florida.com" : toEmail` |
| `server.js` | 1446 | `(process.env.BASE_URL \|\| "https://sebastian-florida.com") + "/api/auth/google/callback"` |
| `server.js` | 1456 | `const baseUrl = process.env.BASE_URL \|\| "https://sebastian-florida.com";` |
| `server.js` | 2637 | `const baseUrl = process.env.BASE_URL \|\| 'https://sebastian-florida.com';` |
| `server.js` | 4970 | `success_url: \`${process.env.BASE_URL \|\| 'https://sebastian-florida.com'}/me/subscription?upgraded=true\`` |
| `server.js` | 4971 | `cancel_url: \`${process.env.BASE_URL \|\| 'https://sebastian-florida.com'}/me/subscription?canceled=true\`` |
| `server.js` | 5824 | `\|\| "https://sebastian.local"` (fallback URL) |
| `data.js` | 2857 | `\|\| 'https://sebastian.local'` (fallback URL) |
| `public/index.html` | 17 | `<meta property="og:url" content="https://sebastian-florida.com">` |
| `public/index.html` | 18 | `<meta property="og:image" content="https://sebastian-florida.com/og-image.jpg">` |
| `mobile-app/capacitor.config.json` | 6 | `"url": "https://sebastian-florida.com"` |
| `mobile-app/dist/index.html` | 1 | `<meta http-equiv="refresh" content="0;url=https://sebastian-florida.com">` |
| `config/towns.js` | 88 | `domains: ["digitalsebastian.com", "sebastian.digitaltowns.com", "localhost"]` |

---

## 3. Email Addresses

All `@sebastian-florida.com` and `@digitalsebastian.com` email references.

| File | Line | Text |
|------|------|------|
| `server.js` | 611 | `from: 'Sebastian Express <noreply@sebastian-florida.com>'` |
| `server.js` | 1147 | `toEmail.endsWith("@sebastian-florida.com") ? "support@sebastian-florida.com"` |
| `public/privacy.html` | 278 | `Email: support@sebastian-florida.com` |
| `public/terms.html` | 346 | `Contact us first at support@sebastian-florida.com` |
| `public/terms.html` | 373 | `Email: support@sebastian-florida.com` |
| `public/delete-account.html` | 20 | `support@sebastian-florida.com` |
| `public/pay.html` | 61 | `Contact support@sebastian-florida.com if you need assistance.` |
| `public/js/beta-banner.js` | 35 | `<a href="mailto:support@sebastian-florida.com">support@sebastian-florida.com</a>` |
| `config/towns.js` | 62 | `supportEmail: "support@digitalsebastian.com"` |

---

## 4. Phone Numbers

| File | Line | Text |
|------|------|------|
| `public/app.js` | 1666 | `(772) 569-6700` (hardcoded local phone number with 772 area code) |

> **Note:** The number `772-867-4198` was **not found** in the codebase. The only (772) area code number is above.

---

## 5. GPS Coordinates & Geofencing

Hardcoded lat/lng for Sebastian, FL and geofence boundaries.

| File | Line | Text |
|------|------|------|
| `config/towns.js` | 74 | `lat: 27.8164` |
| `config/towns.js` | 75 | `lng: -80.4706` |
| `server.js` | 1861 | `const center = { lat: 27.816, lng: -80.470 };` |
| `server.js` | 1862 | `const radiusMeters = 15000;` |
| `server.js` | 1878 | `minLat: 27.72` |
| `server.js` | 1879 | `maxLat: 27.88` |
| `server.js` | 1880 | `minLng: -80.56` |
| `server.js` | 1881 | `maxLng: -80.39` |
| `public/app.js` | 2755 | `const center=[27.816,-80.470];` |
| `town_config.js` | 83-88 | Theme colors `accent: "#00ffae"` (used as map marker color) |

---

## 6. Florida / Location-Specific References

References to FL, Florida, 32958, Indian River County, Treasure Coast.

| File | Line | Text |
|------|------|------|
| `town_config.js` | 80 | `state: "FL"` |
| `town_config.js` | 81 | `region: "Treasure Coast"` |
| `config/towns.js` | 20 | `region: "Florida"` |
| `data.js` | 179 | `"Indian River Lagoon"` (in archive content) |
| `data.js` | 184 | `"Florida's east coast"` (in archive content) |
| `data.js` | 194 | `"Sebastian Inlet"` (in archive content) |
| `data.js` | 199 | `"While much of Florida experienced rapid expansion, Sebastian remained modest."` |
| `data.js` | 1732 | `const zipMatch=zip==="32958";` |
| `data.js` | 1736 | `"Outside Sebastian/32958; added to waitlist."` |
| `public/app.js` | 1302 | `$("localBizState").value="FL";` |
| `public/app.js` | 1633 | `Sebastian, FL • Community Safety` |
| `public/app.js` | 1645 | `Indian River County is safer than 99% of US counties` |
| `public/app.js` | 1723 | `Sebastian Area • Last 30 Days` |
| `public/app.js` | 1748 | `View recent incidents in Indian River County` |
| `public/app.js` | 1817 | `vehicle burglaries in Sebastian area` |
| `public/app.js` | 1984 | `Sebastian Inlet • Port Canaveral` |
| `public/store.html` | 318 | `placeholder="Street address (e.g. 1234 Indian River Dr)"` |
| `public/store.html` | 320 | `value="Sebastian"` (delivery city default) |
| `public/store.html` | 321 | `value="FL"` (delivery state default) |
| `public/subscribe.html` | 243 | `placeholder="123 Main St, Sebastian, FL"` |
| `public/index.html` | 32 | `Welcome to Sebastian, Florida` |
| `public/index.html` | 460 | `<input id="localBizCity" value="Sebastian" />` |
| `public/index.html` | 464 | `<input id="localBizState" value="FL" />` |
| `public/index.html` | 501 | `physically located in Sebastian, FL` |
| `public/terms.html` | 348 | `courts of Indian River County, Florida` |
| `public/terms.html` | 372 | `Sebastian, Florida` (contact address) |
| `public/privacy.html` | 143 | `data-town="sebastian"` |
| `public/privacy.html` | 277 | `Sebastian, Florida` (contact address) |

---

## 6. Database Schema (Column Names)

Sebastian-specific column and field names that should be made generic.

| File | Line | Text |
|------|------|------|
| `db/migrations/0001_init.sql` | 312 | `locationVerifiedSebastian INTEGER NOT NULL DEFAULT 0` (users table) |
| `db/migrations/0001_init.sql` | 458 | `confirmSebastian INTEGER NOT NULL DEFAULT 0` (local_biz_applications table) |
| `db/migrations/0001_init.sql` | 487 | `inSebastian TEXT NOT NULL` (business_applications table) |
| `db/migrations/0001_init.sql` | 503 | `yearsInSebastian TEXT NOT NULL DEFAULT ''` (resident_applications table) |
| `db/migrations/0002_alter.sql` | 35 | `ALTER TABLE users ADD COLUMN IF NOT EXISTS locationVerifiedSebastian INTEGER` |
| `db/migrations/0025_rename_admin_display_name.sql` | 1-2 | `UPDATE users SET displayName = 'Digital Sebastian'` |
| `db/migrations/0026_places_store_type.sql` | 5 | `-- Set Sebastian Organics (ID 18) to managed store` |

**Suggested renames:**
- `locationVerifiedSebastian` → `locationVerified`
- `confirmSebastian` → `confirmLocalBusiness`
- `inSebastian` → `inTown`
- `yearsInSebastian` → `yearsInTown`

---

## 7. Data Layer (data.js)

| File | Line | Text |
|------|------|------|
| `data.js` | 175-226 | **Entire archive seed content** — Sebastian-specific town history (Indigenous peoples, Indian River Lagoon, Sebastian Inlet, Florida east coast, etc.) |
| `data.js` | 226 | `"This archive will grow with the Daily Digital Sebastian Pulse."` |
| `data.js` | 240 | `JSON.stringify(["history","sebastian","identity"])` |
| `data.js` | 644 | `async function setUserLocationVerifiedSebastian(userId, verified)` |
| `data.js` | 647 | `UPDATE users SET locationVerifiedSebastian=$1 WHERE id=$2` |
| `data.js` | 1115 | `locationVerifiedSebastian: Number(user.locationVerifiedSebastian \|\| 0)` |
| `data.js` | 1731 | `const cityMatch=city.toLowerCase().includes("sebastian");` |
| `data.js` | 1732 | `const zipMatch=zip==="32958";` |
| `data.js` | 1735 | `"Address matches Sebastian pilot."` |
| `data.js` | 1736 | `"Outside Sebastian/32958; added to waitlist."` |
| `data.js` | 2667 | `lines.push(\`# Daily Pulse — Sebastian — ${key}\`);` |
| `data.js` | 2723 | `\`Daily Pulse — Sebastian — ${key}\`` |
| `data.js` | 2732 | `\`Daily Pulse — Sebastian — ${key}\`` |
| `data.js` | 2857 | `\|\| 'https://sebastian.local'` |
| `data.js` | 2860 | `"🌴 Today in Sebastian:"` |
| `data.js` | 2897 | `"#SebastianFL #SupportLocal #ShopLocal #DigitalSebastian"` |
| `data.js` | 2989 | `const inSebastian = (payload?.inSebastian \|\| "").toString().trim();` |
| `data.js` | 2991-2992 | `inSebastian` field validation and error messages |
| `data.js` | 2996 | `inSebastian` in INSERT statement |
| `data.js` | 3008 | `inSebastian` value binding |
| `data.js` | 3048 | `yearsInSebastian` in INSERT statement |
| `data.js` | 3060 | `(payload?.yearsInSebastian \|\| "")` |
| `data.js` | 3115 | `const city = (payload.city \|\| "Sebastian").toString().trim();` |
| `data.js` | 3120 | `payload.confirmSebastian === true \|\| payload.confirmSebastian === 1 ...` |
| `data.js` | 3124 | `if(!confirm) return { error: "confirmSebastian required" };` |
| `data.js` | 4015 | `setUserLocationVerifiedSebastian` (module export) |

---

## 8. Server Logic (server.js)

| File | Line | Text |
|------|------|------|
| `server.js` | 38 | `displayName: isAdmin ? "Digital Sebastian" : ...` |
| `server.js` | 167 | `town: process.env.TOWN_NAME \|\| "Sebastian"` |
| `server.js` | 605 | `'https://sebastian-florida.com/delivery-tracking?orderId='` |
| `server.js` | 611 | `from: 'Sebastian Express <noreply@sebastian-florida.com>'` |
| `server.js` | 613 | `subject: 'Sebastian Express - ...'` |
| `server.js` | 614 | `<h2 style="color:#2dd4bf;">🚀 Sebastian Express</h2>` |
| `server.js` | 1147 | `toEmail.endsWith("@sebastian-florida.com")` |
| `server.js` | 1175 | `subject: "Your Sebastian Digital Town login code"` |
| `server.js` | 1223 | `application for Sebastian Digital Town has been approved` |
| `server.js` | 1235 | `subject: "Your Sebastian Digital Town Application is Approved!"` |
| `server.js` | 1446 | `"https://sebastian-florida.com"` (Google OAuth fallback) |
| `server.js` | 1456 | `"https://sebastian-florida.com"` (Google OAuth fallback) |
| `server.js` | 1606 | `inSebastian: (req.body?.inSebastian \|\| "")` |
| `server.js` | 1633 | `yearsInSebastian: (req.body?.yearsInSebastian \|\| "")` |
| `server.js` | 1855 | `function isInsideSebastian(lat, lng, accuracyMeters)` |
| `server.js` | 1871 | `error:"Not inside Sebastian verification zone."` |
| `server.js` | 1875 | `function isInsideSebastianBox(lat, lng)` |
| `server.js` | 1884 | `error:"Not inside Sebastian verification box."` |
| `server.js` | 1886 | `// TODO: Replace with a precise geofence/polygon for Sebastian.` |
| `server.js` | 1895 | `const check = isInsideSebastian(lat, lng, accuracyMeters);` |
| `server.js` | 1905 | `const check = isInsideSebastianBox(lat, lng);` |
| `server.js` | 1907 | `await data.setUserLocationVerifiedSebastian(u, true);` |
| `server.js` | 1974 | `if(Number(user?.locationVerifiedSebastian \|\| 0) !== 1)` |
| `server.js` | 1975 | `error:"Location verified in Sebastian required."` |
| `server.js` | 2637 | `'https://sebastian-florida.com'` (BASE_URL fallback) |
| `server.js` | 3256 | `"[Sebastian Beta] Test Email"` |
| `server.js` | 4970-4971 | `'https://sebastian-florida.com'` (Stripe success/cancel URLs) |
| `server.js` | 5824 | `"https://sebastian.local"` (fallback) |
| `server.js` | 5839 | `"on Digital Sebastian! Support local businesses in Sebastian, FL."` |
| `server.js` | 5854 | `"in the Sebastian Giveaway! Join Digital Sebastian"` |
| `server.js` | 5871 | `"in the Sebastian Sweepstakes! Join Digital Sebastian"` |
| `server.js` | 5892 | `"on Digital Sebastian!"` / `"in Sebastian, FL."` |

---

## 9. Frontend — HTML Pages

### Page Titles with "Sebastian"

| File | Line | Text |
|------|------|------|
| `public/index.html` | 20 | `<title>Sebastian Digital Town</title>` |
| `public/index.html` | 14 | `<meta property="og:title" content="Sebastian, Florida — Local Community Platform">` |
| `public/index.html` | 19 | `<meta name="description" content="Sebastian, Florida's local community platform...">` |
| `public/referrals.html` | 14 | `<title>Referral Program - Digital Sebastian</title>` |
| `public/subscription.html` | 14 | `<title>Subscribe - Digital Sebastian</title>` |
| `public/signup-success.html` | 14 | `<title>Welcome to Digital Sebastian!</title>` |
| `public/store.html` | 14 | `<title>Storefront • Sebastian Digital Town</title>` |
| `public/my_subscription.html` | 14 | `<title>My Subscription - Digital Sebastian</title>` |
| `public/my_orders.html` | 14 | `<title>My Orders – Sebastian</title>` |
| `public/admin.html` | 14 | `<title>Admin Metrics – Sebastian</title>` |
| `public/admin_media.html` | 14 | `<title>Admin Media – Sebastian</title>` |
| `public/admin_pulse.html` | 14 | `<title>Daily Pulse Export – Sebastian</title>` |
| `public/admin_analytics.html` | 14 | `<title>Platform Analytics – Sebastian</title>` |
| `public/login.html` | 14 | `<title>Login - Digital Sebastian</title>` |
| `public/delete-account.html` | 6 | `<title>Delete Account - Sebastian Florida</title>` |
| `public/coming_soon.html` | 14 | `<title>Sebastian Digital Town — Private Beta</title>` |
| `public/delivery-tracking.html` | 6 | `<title>Delivery Tracking - Sebastian Express</title>` |
| `public/business_subscription.html` | 14 | `<title>Business Subscription - Digital Sebastian</title>` |
| `public/giveaway_offer_form.html` | 14 | `<title>Submit Giveaway Offer - Digital Sebastian</title>` |
| `public/seller_orders.html` | 14 | `<title>Seller Orders – Sebastian</title>` |
| `public/subscribe.html` | 14 | `<title>Join Digital Sebastian</title>` |
| `public/subscribe/success.html` | 14 | `<title>Welcome to Digital Sebastian!</title>` |

### `data-town="sebastian"` Attributes

| File | Line |
|------|------|
| `public/index.html` | 29 |
| `public/referrals.html` | 66 |
| `public/privacy.html` | 143 |
| `public/live_host.html` | 28 |
| `public/admin_login.html` | 28 |
| `public/pay_success.html` | 26 |
| `public/subscription.html` | 53 |
| `public/admin_media.html` | 31 |
| `public/signup-success.html` | 109 |
| `public/store.html` | 149 |
| `public/my_subscription.html` | 238 |
| `public/live.html` | 29 |
| `public/admin_sweep.html` | 34 |
| `public/my_orders.html` | 18 |
| `public/store_profile.html` | 19 |
| `public/admin_trust.html` | 25 |
| `public/my_profile.html` | 19 |
| `public/sweep_claim.html` | 18 |
| `public/admin_analytics.html` | 19 |
| `public/business_subscription.html` | 19 |
| `public/hub.html` | 33 |
| `public/giveaway_offer_form.html` | 286 |
| `public/admin.html` | 135 |
| `public/admin_pulse.html` | 55 |
| `public/order-confirmed.html` | 26 |
| `public/debug_context.html` | 21 |
| `public/pay.html` | 26 |
| `public/admin_verify.html` | 24 |
| `public/profile.html` | 117 |
| `public/pay_cancel.html` | 25 |
| `public/terms.html` | 163 |
| `public/admin_giveaway_offers.html` | 86 |

### Body Content with "Sebastian"

| File | Line | Text |
|------|------|------|
| `public/index.html` | 32 | `Welcome to Sebastian, Florida` |
| `public/index.html` | 45 | `Sebastian <span class="beta-badge">BETA</span>` |
| `public/index.html` | 68 | `Sebastian Pulse` |
| `public/index.html` | 124 | `Sebastian Map` |
| `public/index.html` | 137 | `src="/images/sebastian-ui-map.png" alt="Sebastian Map"` |
| `public/index.html` | 410 | `Find trusted service providers in Sebastian.` |
| `public/index.html` | 425-426 | `Local Sebastian Businesses` |
| `public/index.html` | 432 | `businesses physically located in Sebastian` |
| `public/index.html` | 460 | `<input id="localBizCity" value="Sebastian" />` |
| `public/index.html` | 501 | `physically located in Sebastian, FL` |
| `public/index.html` | 530-535 | Channel names: `Sebastian Neighbors & Friends`, `Sebastian Community Chat`, etc. |
| `public/index.html` | 630 | `The Sebastian Pulse` |
| `public/index.html` | 855 | `Help us improve Sebastian Digital Town` |
| `public/coming_soon.html` | 118 | `Sebastian Digital Town is in private beta.` |
| `public/coming_soon.html` | 127 | `Apply as a Sebastian Resident` |
| `public/signup-success.html` | 112-121 | `Welcome to Digital Sebastian!` / `Redirecting you to Digital Sebastian...` |
| `public/subscription.html` | 64 | `Join the Digital Sebastian community` |
| `public/subscribe.html` | 159-160 | `Join Digital Sebastian` / `connect with your local Sebastian community` |
| `public/subscribe/success.html` | 99 | `Welcome to Digital Sebastian!` |
| `public/my_subscription.html` | 249 | `Manage your Digital Sebastian membership` |
| `public/business_subscription.html` | 164 | `Your business listed on Digital Sebastian` |
| `public/delivery-tracking.html` | 30 | `🚀 Sebastian Express` |
| `public/store.html` | 320 | `value="Sebastian"` (delivery city) |
| `public/store_profile.html` | 104 | `Set up a new store in Sebastian` |
| `public/store_profile.html` | 151 | `How long in Sebastian` |
| `public/hub.html` | 93 | `How long in Sebastian` |
| `public/admin.html` | 155 | `Admin Metrics – Sebastian` |
| `public/admin_media.html` | 35 | `Admin Media – Sebastian` |
| `public/admin_applications.html` | 77 | `In Sebastian` (table header) |
| `public/apply_business.html` | 52-53 | `Located in Sebastian?` / `id="businessInSebastian"` |
| `public/apply_resident.html` | 52 | `How long in Sebastian?` |
| `public/verify.html` | 77 | `placeholder="Sebastian"` |
| `public/delete-account.html` | 19 | `deletion of your Sebastian Florida account` |
| `public/terms.html` | 346 | `Contact us first at support@sebastian-florida.com` |
| `public/terms.html` | 347 | `governed by the laws of the State of Florida` |
| `public/terms.html` | 348 | `courts of Indian River County, Florida` |
| `public/terms.html` | 372-373 | `Sebastian, Florida` / `support@sebastian-florida.com` |
| `public/privacy.html` | 277-278 | `Sebastian, Florida` / `support@sebastian-florida.com` |

---

## 10. Frontend — JavaScript

| File | Line | Text |
|------|------|------|
| `public/theme.js` | 4 | `town: "sebastian"` |
| `public/theme.js` | 11 | `(document.body?.dataset?.town \|\| "sebastian").toLowerCase()` |
| `public/app.js` | 182-187 | Channel names: `"Sebastian Neighbors & Friends"`, `"Sebastian Community Chat"`, `"Sebastian Lifestyle & Wellness"`, `"Sebastian Culture & Memories"` |
| `public/app.js` | 1290 | `confirmSebastian: $("localBizConfirm").checked ? 1 : 0` |
| `public/app.js` | 1301 | `$("localBizCity").value="Sebastian"` |
| `public/app.js` | 1633 | `Sebastian, FL • Community Safety` |
| `public/app.js` | 1645 | `Indian River County is safer than 99% of US counties` |
| `public/app.js` | 1723 | `Sebastian Area • Last 30 Days` |
| `public/app.js` | 1748 | `View recent incidents in Indian River County` |
| `public/app.js` | 1817 | `vehicle burglaries in Sebastian area` |
| `public/app.js` | 1984 | `Sebastian Inlet • Port Canaveral` |
| `public/app.js` | 2100 | `Inlet • MikeAtTheInlet` |
| `public/app.js` | 2278 | `"Sebastian Resident+ required to submit prizes."` |
| `public/app.js` | 2302 | `console.warn("Sebastian Resident+ required for prize offers")` |
| `public/app.js` | 2755 | `const center=[27.816,-80.470];` (hardcoded coordinates) |
| `public/signup.js` | 88 | `"Location verified in Sebastian."` |
| `public/signup.js` | 89 | `"Not inside Sebastian verification box."` |
| `public/signup.js` | 115 | `Verify location in Sebastian before submitting Tier 1.` |
| `public/signup.js` | 130 | `const tierName = tierNames[payload.requestedTier] \|\| "Sebastian local"` |
| `public/apply_business.js` | 21 | `inSebastian: document.getElementById("businessInSebastian").value.trim()` |
| `public/apply_resident.js` | 21 | `yearsInSebastian: document.getElementById("residentYears").value.trim()` |
| `public/admin_applications.js` | 129 | `tr.appendChild(td(row.inSebastian))` |
| `public/admin_applications.js` | 161 | `tr.appendChild(td(row.yearsInSebastian \|\| ""))` |
| `public/store_profile.js` | 479 | `on Digital Sebastian!` |
| `public/store_profile.js` | 652 | `on Digital Sebastian! Bidding starts now.` |
| `public/store_profile.js` | 813 | `"Get your store listed on Digital Sebastian"` |
| `public/store_profile.js` | 853 | `"Get your store listed on Digital Sebastian"` |
| `public/store.js` | 96 | `Free delivery in Sebastian.` |
| `public/store.js` | 612 | `on Digital Sebastian!` |
| `public/giveaway_offer_form.js` | 204 | `on Digital Sebastian! Check out local giveaways and support Sebastian businesses.` |
| `public/js/share.js` | 149 | `"I just got verified as a Sebastian resident on Digital Sebastian! Join our local community and support Sebastian businesses."` |
| `public/js/beta-banner.js` | 35 | `support@sebastian-florida.com` |
| `public/share_modal.js` | 333 | `Just made a purchase in Sebastian!` |
| `public/share_modal.js` | 351 | `I just won in the Sebastian Town Giveaway!` |
| `public/share_modal.js` | 369 | `Just left a review on Sebastian Digital Town!` |
| `public/share_modal.js` | 383-384 | `verified Sebastian local!` / `on Digital Sebastian! Join our local community and support Sebastian businesses.` |

---

## 11. Mobile App (Capacitor / Android)

| File | Line | Text |
|------|------|------|
| `mobile-app/capacitor.config.json` | 2 | `"appId": "com.sebastianflorida.app"` |
| `mobile-app/capacitor.config.json` | 3 | `"appName": "Sebastian Florida"` |
| `mobile-app/capacitor.config.json` | 6 | `"url": "https://sebastian-florida.com"` |
| `mobile-app/dist/index.html` | 1 | `url=https://sebastian-florida.com` |
| `mobile-app/android/app/src/main/assets/capacitor.config.json` | 2 | `"appId": "com.sebastianflorida.app"` |
| `mobile-app/android/app/src/main/assets/capacitor.config.json` | 3 | `"appName": "Sebastian Florida"` |
| `mobile-app/android/app/src/main/assets/capacitor.config.json` | 6 | `"url": "https://sebastian-florida.com"` |
| `mobile-app/android/app/build.gradle` | 4 | `namespace = "com.sebastianflorida.app"` |
| `mobile-app/android/app/build.gradle` | 7 | `applicationId "com.sebastianflorida.app"` |
| `mobile-app/android/app/src/main/java/com/sebastianflorida/app/MainActivity.java` | 1 | `package com.sebastianflorida.app;` |
| `mobile-app/android/app/src/main/res/values/strings.xml` | 3 | `<string name="app_name">Sebastian Florida</string>` |
| `mobile-app/android/app/src/main/res/values/strings.xml` | 4 | `<string name="title_activity_main">Sebastian Florida</string>` |
| `mobile-app/android/app/src/main/res/values/strings.xml` | 5 | `<string name="package_name">com.sebastianflorida.app</string>` |
| `mobile-app/android/app/src/main/res/values/strings.xml` | 6 | `<string name="custom_url_scheme">com.sebastianflorida.app</string>` |

---

## 12. Config Files

| File | Line | Text |
|------|------|------|
| `town_config.js` | 78 | `slug: "sebastian"` |
| `town_config.js` | 79 | `name: "Sebastian"` |
| `town_config.js` | 80 | `state: "FL"` |
| `town_config.js` | 81 | `region: "Treasure Coast"` |
| `town_config.js` | 83-88 | Theme colors: `accent: "#00ffae"`, `bg: "#070b10"`, etc. |
| `config/towns.js` | 14-78 | Full `defaultTownConfig` with Sebastian defaults |
| `config/towns.js` | 82-89 | `sebastian` town entry in `towns` registry |
| `public/themes/sebastian.json` | 1-61 | Full theme file named after Sebastian |

---

## 13. Environment Variables & Startup

| File | Line | Text |
|------|------|------|
| `.env` | 4 | `R2_BUCKET=sebastian-assets` |
| `.env` | 5 | `R2_PUBLIC_BASE_URL=...r2.cloudflarestorage.com/sebastian-assets` |
| `.env.example` | 14 | `TOWN_NAME=Sebastian` |
| `.env.example` | 15 | `TOWN_SLUG=sebastian` |
| `.env.local` | 2 | `DATABASE_URL=postgres://...localhost:5432/local_digital_towns` |
| `start.sh` | 6 | `export R2_BUCKET="sebastian-assets"` |

---

## 14. Deployment (render.yaml)

| File | Line | Text |
|------|------|------|
| `render.yaml` | 70 | `value: "Sebastian"` (TOWN_NAME env var) |

---

## 15. Theme & Branding Assets

| File | Description |
|------|-------------|
| `public/themes/sebastian.json` | Theme config file named "sebastian" — colors, fonts, UI settings, heroImageUrl |
| `public/themes/sebastian.json:2` | `"name": "Sebastian"` |
| `public/themes/sebastian.json:25` | `"heroImageUrl": "/images/sebastian-main-map.png"` |
| `public/images/sebastian-ui-map.png` | Map image with Sebastian-specific content |
| `public/images/stores/auto_banner.svg:19` | `Sebastian Auto Works` (placeholder store) |
| `public/images/stores/bakery_banner.svg:19` | `Sebastian Bakery & Sweets` (placeholder store) |

---

## 16. Social Share Text

All hardcoded social sharing strings mentioning Sebastian.

| File | Line | Text |
|------|------|------|
| `server.js` | 5839 | `"on Digital Sebastian! Support local businesses in Sebastian, FL."` |
| `server.js` | 5854 | `"in the Sebastian Giveaway! Join Digital Sebastian"` |
| `server.js` | 5871 | `"in the Sebastian Sweepstakes! Join Digital Sebastian"` |
| `server.js` | 5892 | `"on Digital Sebastian!"` / `"in Sebastian, FL."` |
| `data.js` | 2860 | `"🌴 Today in Sebastian:"` |
| `data.js` | 2897 | `"#SebastianFL #SupportLocal #ShopLocal #DigitalSebastian"` |
| `public/share_modal.js` | 333 | `"Just made a purchase in Sebastian!"` |
| `public/share_modal.js` | 351 | `"I just won in the Sebastian Town Giveaway!"` |
| `public/share_modal.js` | 369 | `"Just left a review on Sebastian Digital Town!"` |
| `public/share_modal.js` | 383-384 | `"verified Sebastian local"` / `"on Digital Sebastian!"` |
| `public/js/share.js` | 149 | `"Sebastian resident on Digital Sebastian!"` |
| `public/giveaway_offer_form.js` | 204 | `"on Digital Sebastian! ... support Sebastian businesses."` |
| `public/store_profile.js` | 479, 652 | `"on Digital Sebastian!"` |
| `public/store.js` | 612 | `"on Digital Sebastian!"` |

---

## 17. Email Templates

| File | Line | Text |
|------|------|------|
| `server.js` | 611 | `from: 'Sebastian Express <noreply@sebastian-florida.com>'` |
| `server.js` | 613 | `subject: 'Sebastian Express - ...'` |
| `server.js` | 614 | `🚀 Sebastian Express` (HTML email body) |
| `server.js` | 1175 | `subject: "Your Sebastian Digital Town login code"` |
| `server.js` | 1223 | `application for Sebastian Digital Town has been approved.` |
| `server.js` | 1235 | `subject: "Your Sebastian Digital Town Application is Approved!"` |
| `server.js` | 3256 | `"[Sebastian Beta] Test Email"` |

---

## 18. Database Migrations

| File | Line | Text |
|------|------|------|
| `db/migrations/0001_init.sql` | 312 | `locationVerifiedSebastian INTEGER` (column definition) |
| `db/migrations/0001_init.sql` | 458 | `confirmSebastian INTEGER` (column definition) |
| `db/migrations/0001_init.sql` | 487 | `inSebastian TEXT` (column definition) |
| `db/migrations/0001_init.sql` | 503 | `yearsInSebastian TEXT` (column definition) |
| `db/migrations/0002_alter.sql` | 35 | `ADD COLUMN locationVerifiedSebastian INTEGER` |
| `db/migrations/0025_rename_admin_display_name.sql` | 2 | `SET displayName = 'Digital Sebastian'` |
| `db/migrations/0026_places_store_type.sql` | 5 | `-- Set Sebastian Organics (ID 18) to managed store` |

---

## 19. API Keys & Secrets

**These are live/test credentials that must be per-town or removed from code:**

| File | Line | Type | Text |
|------|------|------|------|
| `.env` | 1 | R2 Account | `R2_ACCOUNT_ID=d29d33f25f64afdd001df04920eaf237` |
| `.env` | 2 | R2 Access Key | `R2_ACCESS_KEY_ID=672156aded15afb375f98d97af1d0276` |
| `.env` | 3 | R2 Secret | `R2_SECRET_ACCESS_KEY=bf5907c0b2b52a45d72acedc0eb1323502d3158356b36718b7f7a043ba79b098` |
| `.env` | 4 | R2 Bucket | `R2_BUCKET=sebastian-assets` |
| `.env` | 7 | Stripe Secret | `STRIPE_SECRET_KEY=sk_test_51Sqapa2KMS...` |
| `.env` | 8 | Stripe Publishable | `STRIPE_PUBLISHABLE_KEY=pk_test_51Sqapa2KMS...` |
| `.env` | 9 | Stripe Webhook | `STRIPE_WEBHOOK_SECRET=whsec_2332511975f9d3c02b...` |
| `start.sh` | 2-7 | R2 Credentials | All R2 credentials duplicated in shell script |

---

## 20. SVG / Image Assets

| File | Line | Text |
|------|------|------|
| `public/images/stores/auto_banner.svg` | 19 | `Sebastian Auto Works` |
| `public/images/stores/bakery_banner.svg` | 19 | `Sebastian Bakery & Sweets` |
| `public/images/sebastian-ui-map.png` | — | Sebastian-specific map image |
| `public/themes/sebastian.json` | 25 | References `/images/sebastian-main-map.png` |

---

## Summary Statistics

| Category | Count |
|----------|-------|
| **Total files with Sebastian references** | ~50+ |
| **Hardcoded "Sebastian" string occurrences** | ~253 |
| **Domain references (sebastian-florida.com)** | 15 |
| **Email addresses (@sebastian-florida.com)** | 9 |
| **Phone numbers (772 area code)** | 1 |
| **GPS coordinates** | 5 locations (center + bounding box) |
| **Florida/FL/32958 references** | 20+ |
| **Database column names with "Sebastian"** | 4 columns across 3 tables |
| **HTML pages with data-town="sebastian"** | 33 pages |
| **Page titles with "Sebastian"** | 22 pages |
| **Social share strings** | 14+ |
| **Email template subjects/bodies** | 7 |
| **Mobile app identifiers** | 7 (appId, appName, namespace, etc.) |
| **API keys/secrets in code** | 8 (should be env-only) |
| **SVG/image assets** | 4 files |

---

## Priority Templatization Order

1. **CRITICAL** — `config/towns.js` & `town_config.js`: These are the central config. All other files should read from these.
2. **CRITICAL** — Database schema: Rename `locationVerifiedSebastian`, `confirmSebastian`, `inSebastian`, `yearsInSebastian` to generic names via migration.
3. **HIGH** — `server.js`: Replace all 25+ hardcoded Sebastian strings with config lookups (town.name, town.fullName, town.domain).
4. **HIGH** — `data.js`: Replace all 20+ hardcoded Sebastian strings with config lookups.
5. **HIGH** — `public/index.html` & other HTML: Use server-side templating or JS config injection for town name, `data-town`, titles, and OG tags.
6. **HIGH** — Mobile app config: `capacitor.config.json`, `build.gradle`, `strings.xml` need per-town build variants.
7. **MEDIUM** — Frontend JS files (`app.js`, `share_modal.js`, `signup.js`, etc.): Read town name from config/API instead of hardcoding.
8. **MEDIUM** — Email templates: Use town config for from address, subject lines, body content.
9. **MEDIUM** — GPS coordinates: Move to town config (already partially there in `config/towns.js`).
10. **LOW** — Archive seed content in `data.js`: Make this per-town seed data.
11. **LOW** — SVG placeholder assets: Generate per-town or make generic.
12. **LOW** — `.env` / `start.sh`: Document per-town environment setup.
