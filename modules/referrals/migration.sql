-- Referrals module migration (L2)
-- Extracted from Sebastian migrations/0017_referral_system.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_balance_cents INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_earnings_total INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS referral_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  referred_user_id INTEGER REFERENCES users(id),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_txn_user ON referral_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_txn_referred ON referral_transactions(referred_user_id);
