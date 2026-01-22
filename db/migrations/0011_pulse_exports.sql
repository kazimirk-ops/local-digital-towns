CREATE TABLE IF NOT EXISTS pulse_exports (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  exportType TEXT NOT NULL DEFAULT 'facebook',
  exportedAt TIMESTAMPTZ NOT NULL,
  exportedByUserId INTEGER,
  pulseData JSONB,
  postText TEXT
);
