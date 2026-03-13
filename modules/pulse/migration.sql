-- Pulse module migration
-- Daily digest, activity feed posts, export tracking.
-- Extracted from Sebastian daily_pulses + DT pulse_posts

CREATE TABLE IF NOT EXISTS daily_pulses (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  day_key TEXT NOT NULL,
  status TEXT DEFAULT 'published',
  metrics_json JSONB DEFAULT '{}',
  highlights_json JSONB DEFAULT '{}',
  markdown_body TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(place_id, day_key)
);

CREATE TABLE IF NOT EXISTS pulse_exports (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  export_type TEXT DEFAULT 'facebook',
  exported_by INTEGER REFERENCES users(id),
  post_text TEXT DEFAULT '',
  pulse_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Activity feed posts (from DT pulse_posts)
CREATE TABLE IF NOT EXISTS pulse_posts (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  author_id INTEGER REFERENCES users(id),
  type TEXT DEFAULT 'community',
  title TEXT DEFAULT '',
  body TEXT DEFAULT '',
  data JSONB DEFAULT '{}',
  pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_pulses_place_day ON daily_pulses(place_id, day_key DESC);
CREATE INDEX IF NOT EXISTS idx_daily_pulses_created ON daily_pulses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pulse_posts_place ON pulse_posts(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pulse_exports_place ON pulse_exports(place_id, created_at DESC);
