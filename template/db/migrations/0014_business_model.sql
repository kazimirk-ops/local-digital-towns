-- Migration: 0014_business_model.sql
-- Business Model Changes: Featured stores, buyer deposit, ghost reports

-- 1. Giveaway Offers: Add start/end dates for featured store scheduling
ALTER TABLE giveaway_offers ADD COLUMN IF NOT EXISTS startsAt TIMESTAMPTZ;
ALTER TABLE giveaway_offers ADD COLUMN IF NOT EXISTS endsAt TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_giveaway_active ON giveaway_offers(status, startsAt, endsAt);

-- 2. Orders: Add buyer deposit column (rename from gratuity concept)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyerDepositCents INTEGER DEFAULT 0;
-- Migrate existing data from serviceGratuityCents
UPDATE orders SET buyerDepositCents = serviceGratuityCents WHERE serviceGratuityCents > 0 AND buyerDepositCents = 0;

-- 3. Ghost Reports: Track buyer non-payment
CREATE TABLE IF NOT EXISTS ghost_reports (
  id SERIAL PRIMARY KEY,
  orderId INTEGER NOT NULL UNIQUE,
  buyerUserId INTEGER NOT NULL,
  sellerUserId INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  reportedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_ghost_buyer ON ghost_reports(buyerUserId);
CREATE INDEX IF NOT EXISTS idx_ghost_seller ON ghost_reports(sellerUserId);
CREATE INDEX IF NOT EXISTS idx_ghost_order ON ghost_reports(orderId);

-- 4. Users: Add ghosting metrics
ALTER TABLE users ADD COLUMN IF NOT EXISTS ghostingPercent DOUBLE PRECISION DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ghostReportCount INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totalOrdersAsBuyer INTEGER DEFAULT 0;
