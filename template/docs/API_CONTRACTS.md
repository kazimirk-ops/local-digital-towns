# Phase 1 API Contracts

Base URL: `BASE_URL` (default http://localhost:3000)

Common headers:
- `Content-Type: application/json`
- `Accept: application/json`

Auth model: auth-by-code (email or phone). Session returned as cookie or token.

Errors use a consistent envelope:
```json
{
  "error": "string",
  "code": "STRING_CODE",
  "details": {"optional": true}
}
```

---

## Auth-by-Code

### POST /api/auth/request-code
Request:
```json
{
  "channel": "email|sms",
  "destination": "string",
  "intent": "login|signup"
}
```
Response:
```json
{
  "ok": true,
  "request_id": "req_123",
  "expires_in_seconds": 300
}
```

### POST /api/auth/verify-code
Request:
```json
{
  "request_id": "req_123",
  "code": "123456"
}
```
Response:
```json
{
  "ok": true,
  "session": {
    "token": "sess_abc",
    "expires_at": "2025-01-01T12:00:00Z"
  },
  "user": {
    "id": "user_1",
    "display_name": "Ada",
    "role": "user|admin"
  }
}
```

### POST /api/auth/logout
Request:
```json
{}
```
Response:
```json
{
  "ok": true
}
```

---

## Session

### GET /api/me
Response:
```json
{
  "ok": true,
  "user": {
    "id": "user_1",
    "display_name": "Ada",
    "role": "user|admin",
    "status": "active|suspended"
  }
}
```

---

## Intake

### POST /api/intake
Request:
```json
{
  "display_name": "Ada",
  "bio": "Short intro",
  "location": {"lat": 40.7128, "lng": -74.0060},
  "intent": "seller|buyer|both"
}
```
Response:
```json
{
  "ok": true,
  "intake": {
    "id": "intake_1",
    "status": "pending",
    "created_at": "2025-01-01T12:00:00Z"
  }
}
```

### GET /api/intake/:id
Response:
```json
{
  "ok": true,
  "intake": {
    "id": "intake_1",
    "status": "pending|approved|rejected",
    "display_name": "Ada",
    "bio": "Short intro",
    "location": {"lat": 40.7128, "lng": -74.0060},
    "intent": "seller|buyer|both",
    "review": {
      "reviewed_by": "admin_1",
      "reviewed_at": "2025-01-01T12:00:00Z",
      "reason": "string"
    }
  }
}
```

### GET /api/intake
Query params: `status=pending|approved|rejected`
Response:
```json
{
  "ok": true,
  "items": [
    {"id": "intake_1", "status": "pending", "display_name": "Ada"}
  ]
}
```

### POST /api/intake/:id/approve
Request:
```json
{
  "reason": "Approved"
}
```
Response:
```json
{
  "ok": true,
  "intake": {"id": "intake_1", "status": "approved"}
}
```

### POST /api/intake/:id/reject
Request:
```json
{
  "reason": "Not enough detail"
}
```
Response:
```json
{
  "ok": true,
  "intake": {"id": "intake_1", "status": "rejected"}
}
```

---

## Marketplace (Buy-It-Now)

### POST /api/listings
Request:
```json
{
  "title": "Bike",
  "description": "Single-speed",
  "price_cents": 12000,
  "currency": "USD",
  "location": {"lat": 40.7128, "lng": -74.0060},
  "photos": ["https://..."]
}
```
Response:
```json
{
  "ok": true,
  "listing": {
    "id": "list_1",
    "status": "active",
    "price_cents": 12000
  }
}
```

### GET /api/listings
Query params: `status=active|sold`, `near=lat,lng`, `radius_km=5`
Response:
```json
{
  "ok": true,
  "items": [
    {"id": "list_1", "title": "Bike", "price_cents": 12000, "status": "active"}
  ]
}
```

### GET /api/listings/:id
Response:
```json
{
  "ok": true,
  "listing": {
    "id": "list_1",
    "title": "Bike",
    "description": "Single-speed",
    "price_cents": 12000,
    "currency": "USD",
    "status": "active",
    "seller_id": "user_1",
    "location": {"lat": 40.7128, "lng": -74.0060},
    "photos": ["https://..."]
  }
}
```

### POST /api/listings/:id/purchase
Request:
```json
{
  "payment_method": "card_on_file|manual",
  "notes": "Optional"
}
```
Response:
```json
{
  "ok": true,
  "order": {
    "id": "order_1",
    "listing_id": "list_1",
    "status": "paid|pending",
    "amount_cents": 12000
  }
}
```

---

## Auctions

### POST /api/auctions
Request:
```json
{
  "title": "Vintage lamp",
  "description": "Brass base",
  "start_at": "2025-01-01T12:00:00Z",
  "end_at": "2025-01-02T12:00:00Z",
  "start_price_cents": 5000,
  "min_increment_cents": 500,
  "photos": ["https://..."]
}
```
Response:
```json
{
  "ok": true,
  "auction": {"id": "auc_1", "status": "scheduled"}
}
```

### GET /api/auctions
Query params: `status=scheduled|live|ended`
Response:
```json
{
  "ok": true,
  "items": [
    {"id": "auc_1", "title": "Vintage lamp", "status": "live"}
  ]
}
```

### POST /api/auctions/:id/bids
Request:
```json
{
  "amount_cents": 5500
}
```
Response:
```json
{
  "ok": true,
  "bid": {"id": "bid_1", "amount_cents": 5500, "user_id": "user_2"}
}
```

### POST /api/auctions/:id/close
Request:
```json
{}
```
Response:
```json
{
  "ok": true,
  "result": {
    "status": "ended",
    "winner_id": "user_2",
    "amount_cents": 5500
  }
}
```

---

## Giveaway

### POST /api/giveaways
Request:
```json
{
  "title": "Free plants",
  "description": "Three pots",
  "end_at": "2025-01-02T12:00:00Z",
  "photos": ["https://..."]
}
```
Response:
```json
{
  "ok": true,
  "giveaway": {"id": "give_1", "status": "open"}
}
```

### POST /api/giveaways/:id/entries
Request:
```json
{}
```
Response:
```json
{
  "ok": true,
  "entry": {"id": "entry_1", "giveaway_id": "give_1"}
}
```

### POST /api/giveaways/:id/draw
Request:
```json
{
  "seed": "optional-deterministic-seed"
}
```
Response:
```json
{
  "ok": true,
  "winner": {
    "user_id": "user_3",
    "drawn_at": "2025-01-02T12:00:00Z"
  }
}
```

### POST /api/giveaways/:id/claim
Request:
```json
{
  "shipping": {"name": "Ada", "address": "123 Main"}
}
```
Response:
```json
{
  "ok": true,
  "claim": {"id": "claim_1", "status": "claimed"}
}
```

---

## Channels

### GET /api/channels
Response:
```json
{
  "ok": true,
  "items": [
    {"id": "chan_1", "name": "General", "visibility": "public"}
  ]
}
```

### POST /api/channels
Request:
```json
{
  "name": "General",
  "visibility": "public|private"
}
```
Response:
```json
{
  "ok": true,
  "channel": {"id": "chan_1", "name": "General"}
}
```

### GET /api/channels/:id/messages
Response:
```json
{
  "ok": true,
  "items": [
    {"id": "msg_1", "body": "Hello", "user_id": "user_1", "created_at": "2025-01-01T12:00:00Z"}
  ]
}
```

### POST /api/channels/:id/messages
Request:
```json
{
  "body": "Hello"
}
```
Response:
```json
{
  "ok": true,
  "message": {"id": "msg_1", "body": "Hello"}
}
```

---

## Pulse

### GET /api/pulse
Query params: `near=lat,lng`, `radius_km=5`
Response:
```json
{
  "ok": true,
  "items": [
    {"id": "pulse_1", "type": "listing|auction|giveaway", "title": "Bike", "location": {"lat": 40.7128, "lng": -74.0060}}
  ]
}
```

### POST /api/pulse
Request:
```json
{
  "type": "announcement",
  "title": "Pop-up market",
  "body": "Saturday 10am",
  "location": {"lat": 40.7128, "lng": -74.0060}
}
```
Response:
```json
{
  "ok": true,
  "pulse": {"id": "pulse_1", "created_at": "2025-01-01T12:00:00Z"}
}
```

---

## Admin

### GET /api/admin/users
Response:
```json
{
  "ok": true,
  "items": [
    {"id": "user_1", "display_name": "Ada", "role": "admin"}
  ]
}
```

### POST /api/admin/users/:id/role
Request:
```json
{
  "role": "user|admin|moderator"
}
```
Response:
```json
{
  "ok": true,
  "user": {"id": "user_1", "role": "moderator"}
}
```

### GET /api/admin/moderation/actions
Response:
```json
{
  "ok": true,
  "items": [
    {"id": "mod_1", "actor_id": "admin_1", "action": "intake_approved", "target_id": "intake_1"}
  ]
}
```
