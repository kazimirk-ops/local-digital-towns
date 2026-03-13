-- Achievements & Leaderboard module migration (L2)
-- Extracted from DT server.js leaderboard tables

CREATE TABLE IF NOT EXISTS leaderboard_scores (
  id SERIAL PRIMARY KEY,
  place_slug TEXT NOT NULL,
  track TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  score DECIMAL(5,2) DEFAULT 0,
  rank INTEGER,
  month TEXT NOT NULL,
  is_defending_champion BOOLEAN DEFAULT false,
  all_time_wins INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(place_slug, track, entity_id, month)
);

CREATE TABLE IF NOT EXISTS leaderboard_shares (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  share_type TEXT NOT NULL,
  share_ref_id TEXT NOT NULL,
  utm_token TEXT UNIQUE NOT NULL,
  clicked BOOLEAN DEFAULT false,
  clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leaderboard_badges (
  id SERIAL PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  badge_type TEXT NOT NULL,
  place_slug TEXT NOT NULL,
  awarded_month TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lb_scores_place_month ON leaderboard_scores(place_slug, month);
CREATE INDEX IF NOT EXISTS idx_lb_scores_track ON leaderboard_scores(track, place_slug, month);
CREATE INDEX IF NOT EXISTS idx_lb_shares_utm ON leaderboard_shares(utm_token);
CREATE INDEX IF NOT EXISTS idx_lb_shares_user ON leaderboard_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_lb_badges_entity ON leaderboard_badges(entity_id, entity_type);
