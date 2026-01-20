CREATE TABLE IF NOT EXISTS sweep_rules (
  id SERIAL PRIMARY KEY,
  town_id INTEGER NOT NULL DEFAULT 1,
  rule_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  amount INTEGER NOT NULL DEFAULT 0,
  buyer_amount INTEGER NOT NULL DEFAULT 0,
  seller_amount INTEGER NOT NULL DEFAULT 0,
  daily_cap INTEGER NOT NULL DEFAULT 0,
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sweep_award_events (
  id SERIAL PRIMARY KEY,
  town_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL REFERENCES sweep_rules(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sweep_award_unique ON sweep_award_events(rule_id, event_key);
CREATE INDEX IF NOT EXISTS idx_sweep_award_user_created ON sweep_award_events(user_id, created_at);

ALTER TABLE users ADD COLUMN IF NOT EXISTS referredByUserId INTEGER;
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referredByUserId);
