-- Live Shows module migration (L2)
-- Extracted from Sebastian data.js live tables + DT live_session_orders

CREATE TABLE IF NOT EXISTS live_rooms (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'idle',
  title TEXT,
  description TEXT,
  host_user_id INTEGER REFERENCES users(id),
  host_place_id INTEGER REFERENCES places(id),
  host_type TEXT DEFAULT 'individual',
  host_channel_id INTEGER,
  pinned_listing_id INTEGER REFERENCES listings(id),
  cf_room_id TEXT,
  cf_room_token TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS live_show_schedule (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'scheduled',
  title TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  host_user_id INTEGER REFERENCES users(id),
  host_type TEXT DEFAULT 'individual',
  host_place_id INTEGER REFERENCES places(id),
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_show_bookmarks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  show_id INTEGER REFERENCES live_show_schedule(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, show_id)
);

CREATE TABLE IF NOT EXISTS live_chat_messages (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES live_rooms(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_session_orders (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES live_rooms(id),
  listing_id INTEGER REFERENCES listings(id),
  buyer_id INTEGER REFERENCES users(id),
  seller_id INTEGER REFERENCES users(id),
  amount_cents INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_rooms_status ON live_rooms(status);
CREATE INDEX IF NOT EXISTS idx_live_rooms_host ON live_rooms(host_user_id);
CREATE INDEX IF NOT EXISTS idx_live_schedule_start ON live_show_schedule(start_at);
CREATE INDEX IF NOT EXISTS idx_live_chat_room ON live_chat_messages(room_id, created_at DESC);
