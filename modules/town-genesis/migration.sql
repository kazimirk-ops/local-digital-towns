-- Town Genesis module migration (L3)
-- Genesis candidates forming from location signals

CREATE TABLE IF NOT EXISTS genesis_candidates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  zip TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  signal_count INTEGER DEFAULT 0,
  threshold INTEGER DEFAULT 50,
  progress_pct INTEGER DEFAULT 0,
  status TEXT DEFAULT 'forming',
  place_id INTEGER REFERENCES places(id),
  auto_provisioned BOOLEAN DEFAULT false,
  provisioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_genesis_status ON genesis_candidates(status, signal_count DESC);
