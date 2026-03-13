-- Broadcast module migration (L3)
-- Admin/seller broadcasts with history tracking

CREATE TABLE IF NOT EXISTS broadcasts (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id),
  place_id INTEGER REFERENCES places(id),
  type TEXT DEFAULT 'admin',
  channel TEXT DEFAULT 'email',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  target_filter JSONB DEFAULT '{}',
  recipient_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_place ON broadcasts(place_id, status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_sender ON broadcasts(sender_id);
