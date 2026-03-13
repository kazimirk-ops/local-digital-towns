-- Location Graph module migration (L3)
-- Location signals from niche sales + ZIP clustering for town genesis

CREATE TABLE IF NOT EXISTS location_signals (
  id SERIAL PRIMARY KEY,
  zip TEXT NOT NULL,
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  country TEXT DEFAULT 'US',
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  place_id INTEGER REFERENCES places(id),
  platform_slug TEXT DEFAULT '',
  sale_event_id INTEGER REFERENCES niche_sale_events(id),
  user_id INTEGER REFERENCES users(id),
  buyer_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zip_clusters (
  id SERIAL PRIMARY KEY,
  zip TEXT UNIQUE NOT NULL,
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  signal_count INTEGER DEFAULT 0,
  unique_buyers INTEGER DEFAULT 0,
  place_id INTEGER REFERENCES places(id),
  genesis_eligible BOOLEAN DEFAULT false,
  genesis_threshold INTEGER DEFAULT 50,
  genesis_requested BOOLEAN DEFAULT false,
  last_signal_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_zip ON location_signals(zip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_place ON location_signals(place_id);
CREATE INDEX IF NOT EXISTS idx_clusters_state ON zip_clusters(state, signal_count DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_eligible ON zip_clusters(genesis_eligible, signal_count DESC);
