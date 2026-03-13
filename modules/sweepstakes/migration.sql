-- Sweepstakes module migration (L2)
-- Extracted from Sebastian data.js + migrations

CREATE TABLE IF NOT EXISTS sweep_rules (
  id SERIAL PRIMARY KEY,
  town_id INTEGER,
  sweepstake_id INTEGER,
  rule_type TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  amount INTEGER NOT NULL DEFAULT 0,
  buyer_amount INTEGER,
  seller_amount INTEGER,
  daily_cap INTEGER DEFAULT 0,
  cooldown_seconds INTEGER DEFAULT 0,
  meta_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sweep_ledger (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  event_id TEXT,
  meta_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sweep_award_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  rule_id INTEGER REFERENCES sweep_rules(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(rule_id, event_key)
);

CREATE TABLE IF NOT EXISTS sweepstakes (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'active',
  title TEXT NOT NULL,
  prize TEXT NOT NULL,
  prize_description TEXT,
  prize_image_url TEXT,
  prize_value INTEGER DEFAULT 0,
  donor_name TEXT,
  donor_user_id INTEGER REFERENCES users(id),
  entry_cost INTEGER DEFAULT 1,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  draw_at TIMESTAMPTZ,
  max_entries_per_user_per_day INTEGER DEFAULT 10,
  winner_user_id INTEGER REFERENCES users(id),
  winner_entry_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sweepstake_entries (
  id SERIAL PRIMARY KEY,
  sweepstake_id INTEGER REFERENCES sweepstakes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  entries INTEGER DEFAULT 1,
  day_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sweep_draws (
  id SERIAL PRIMARY KEY,
  sweep_id INTEGER REFERENCES sweepstakes(id) ON DELETE CASCADE,
  created_by_user_id INTEGER REFERENCES users(id),
  winner_user_id INTEGER REFERENCES users(id),
  total_entries INTEGER DEFAULT 0,
  snapshot_json JSONB DEFAULT '{}',
  notified BOOLEAN DEFAULT false,
  claimed_at TIMESTAMPTZ,
  claimed_by_user_id INTEGER REFERENCES users(id),
  claimed_message TEXT,
  claimed_photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prize_offers (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'pending',
  title TEXT NOT NULL,
  description TEXT,
  value_cents INTEGER DEFAULT 0,
  prize_type TEXT DEFAULT 'physical',
  image_url TEXT,
  donor_user_id INTEGER REFERENCES users(id),
  donor_place_id INTEGER REFERENCES places(id),
  donor_display_name TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id INTEGER REFERENCES users(id),
  decision_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prize_awards (
  id SERIAL PRIMARY KEY,
  prize_offer_id INTEGER REFERENCES prize_offers(id),
  winner_user_id INTEGER REFERENCES users(id),
  donor_user_id INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'pending',
  proof_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sweep_ledger_user ON sweep_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sweep_entries_sweep ON sweepstake_entries(sweepstake_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sweep_draws_sweep ON sweep_draws(sweep_id);
CREATE INDEX IF NOT EXISTS idx_sweep_rules_type ON sweep_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_sweepstakes_status ON sweepstakes(status);

-- Seed default rules
INSERT INTO sweep_rules (rule_type, enabled, amount, buyer_amount, seller_amount, daily_cap, cooldown_seconds)
VALUES
  ('listing_create', true, 2, NULL, NULL, 5, 0),
  ('purchase', true, 3, 3, 2, 0, 0),
  ('review_left', true, 2, NULL, NULL, 3, 0),
  ('message_send', true, 1, NULL, NULL, 10, 60),
  ('listing_mark_sold', true, 1, NULL, NULL, 5, 0),
  ('social_share', true, 1, NULL, NULL, 5, 0)
ON CONFLICT DO NOTHING;
