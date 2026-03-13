-- Disputes module migration (L4)
-- Order disputes, ghost reports, trust events, moderation actions

-- Order disputes
-- Adapted from Sebastian data.js disputes table
CREATE TABLE IF NOT EXISTS disputes (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  order_id INTEGER NOT NULL,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id),
  respondent_user_id INTEGER REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT DEFAULT '',
  resolved_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Ghost reports (buyer non-payment / no-show)
-- Adapted from Sebastian data.js / 0014_business_model.sql ghost_reports table
CREATE TABLE IF NOT EXISTS ghost_reports (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE,
  buyer_user_id INTEGER NOT NULL REFERENCES users(id),
  seller_user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT DEFAULT '',
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT DEFAULT 'active'
);

-- Trust events (audit trail for trust-affecting actions)
-- Adapted from Sebastian data.js trust_events table
CREATE TABLE IF NOT EXISTS trust_events (
  id SERIAL PRIMARY KEY,
  order_id INTEGER,
  user_id INTEGER NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Moderation actions (admin actions on disputes/reports)
CREATE TABLE IF NOT EXISTS moderation_actions (
  id SERIAL PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  admin_user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT DEFAULT '',
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_reporter ON disputes(reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_ghost_reports_buyer ON ghost_reports(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_ghost_reports_seller ON ghost_reports(seller_user_id);
CREATE INDEX IF NOT EXISTS idx_trust_events_user ON trust_events(user_id);
CREATE INDEX IF NOT EXISTS idx_trust_events_type ON trust_events(event_type);
CREATE INDEX IF NOT EXISTS idx_mod_actions_target ON moderation_actions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_mod_actions_admin ON moderation_actions(admin_user_id);
