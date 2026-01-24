# Production Readiness Checklist

**Date:** January 24, 2026
**Status:** READY FOR PRODUCTION (with manual steps noted below)

---

## 1. Infrastructure Configuration (render.yaml)

| Item | Status | Notes |
|------|--------|-------|
| Web service defined | PASS | `digitaltowns-web` with starter plan |
| Health check endpoint | PASS | `/health` configured |
| Auth service defined | PASS | Private service on port 3002 |
| CRM service defined | PASS | Private service on port 3001 |
| Backup worker defined | PASS | Nightly at 2 AM |
| Email worker defined | PASS | Queue-based email processing |
| Sync worker defined | PASS | CRM synchronization |
| Analytics worker defined | PASS | Event aggregation |
| PostgreSQL database | PASS | v16, starter plan |
| Redis cache | PASS | Starter plan |
| Environment variables | PASS | All secrets use `sync: false` or `generateValue: true` |
| JWT_SECRET auto-generated | PASS | Line 62: `generateValue: true` |
| NODE_ENV=production | PASS | Set on all services |

---

## 2. Service Startup

| Item | Status | Notes |
|------|--------|-------|
| `npm run start` | PASS | `node server.js` |
| `npm run start:auth` | PASS | `node services/auth/index.js` |
| `npm run start:crm` | PASS | `node services/crm/index.js` |
| `npm run worker:backup` | PASS | `node workers/backup/index.js` |
| `npm run worker:email` | PASS | `node workers/email/index.js` |
| `npm run worker:sync` | PASS | `node workers/sync/index.js` |
| `npm run worker:analytics` | PASS | `node workers/analytics/index.js` |
| Health check endpoint exists | PASS | `GET /health` returns `{status:"ok"}` |
| Node engine specified | PASS | `>=18.0.0` in package.json |

---

## 3. Database Connection Handling

| Item | Status | Notes |
|------|--------|-------|
| Connection pooling | PASS | pg Pool with max=20 connections |
| Pool error handler | PASS | `pool.on('error')` catches idle client errors |
| Connection timeout | PASS | 5 seconds |
| Idle timeout | PASS | 30 seconds |
| SSL support | PASS | Auto-enabled when `sslmode=require` in URL |
| Production check | PASS | Exits if DATABASE_URL missing in production |

---

## 4. Logging Security

| Item | Status | Notes |
|------|--------|-------|
| Passwords not logged | PASS | No password values in console.* calls |
| Tokens not logged | PASS | Only logs presence (!!token), not values |
| API keys not logged | PASS | Stripe webhook logs `!!secret`, not actual secret |
| JWT_SECRET warning | PASS | Logs warning if missing, not the value |
| Stack traces hidden in prod | PASS | Global error handler hides stack in production |

---

## 5. Documentation Files

| Item | Status | Notes |
|------|--------|-------|
| README.md exists | PASS | Basic instructions present |
| .env.example exists | PASS | Comprehensive with 50+ variables documented |
| PRODUCTION_AUDIT.md | PASS | Security audit report |
| This checklist | PASS | PRODUCTION_CHECKLIST.md |

### README.md Status: MINIMAL
The README has basic run instructions but lacks:
- Production deployment guide
- Architecture overview
- Troubleshooting section

**Recommendation:** Acceptable for beta launch; expand documentation later.

---

## 6. Manual Steps Required Before Deploy

### Required (Before First Deploy)

1. **Set Stripe Keys in Render Dashboard**
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_ID=price_...
   ```

2. **Set SMTP/Email Credentials**
   ```
   SMTP_HOST=your-smtp-host
   SMTP_USER=your-smtp-user
   SMTP_PASS=your-smtp-password
   EMAIL_FROM=noreply@yourdomain.com
   ```

3. **Set PUBLIC_BASE_URL**
   ```
   PUBLIC_BASE_URL=https://yourdomain.com
   ```

4. **Configure Admin Emails**
   ```
   ADMIN_EMAILS=admin1@example.com,admin2@example.com
   ```

5. **Create Stripe Webhook**
   - Go to Stripe Dashboard > Developers > Webhooks
   - Add endpoint: `https://yourdomain.com/api/stripe/webhook`
   - Select events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.*`
   - Copy signing secret to `STRIPE_WEBHOOK_SECRET`

6. **Run Database Migration**
   - Render will run `npm install` then `npm run start`
   - First startup will run migrations automatically via `initDb()`

### Optional (Can Configure Later)

- **S3/R2 for Image Uploads** - R2_* or AWS_* credentials
- **Facebook OAuth** - FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
- **Google OAuth** - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- **HubSpot CRM** - HUBSPOT_API_KEY, HUBSPOT_PORTAL_ID
- **Backblaze B2 Backups** - B2_KEY_ID, B2_APP_KEY
- **Cloudflare Calls** - CF_CALLS_APP_ID, CF_CALLS_APP_SECRET

---

## Summary

```
CATEGORY                    STATUS
─────────────────────────────────────
render.yaml                 PASS
Service Startup             PASS
Database Connection         PASS
Logging Security            PASS
Documentation               PASS (minimal)
─────────────────────────────────────
OVERALL                     READY FOR PRODUCTION
```

### Pre-Deploy Checklist
- [ ] Set STRIPE_SECRET_KEY in Render
- [ ] Set STRIPE_WEBHOOK_SECRET in Render
- [ ] Set STRIPE_PRICE_ID in Render
- [ ] Set SMTP credentials in Render
- [ ] Set PUBLIC_BASE_URL in Render
- [ ] Set ADMIN_EMAILS in Render
- [ ] Create Stripe webhook endpoint
- [ ] Push code to trigger deploy

### Post-Deploy Verification
- [ ] Visit `/health` - should return `{"status":"ok"}`
- [ ] Test user registration flow
- [ ] Test business subscription checkout
- [ ] Verify webhook receives events
- [ ] Check worker logs in Render dashboard
