-- Channels module migration
-- Discussion channels, threaded messages, DMs, muting, channel requests.
-- Extracted from Sebastian data.js channel tables

CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_public BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_memberships (
  id SERIAL PRIMARY KEY,
  channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS channel_messages (
  id SERIAL PRIMARY KEY,
  channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  text TEXT NOT NULL,
  image_url TEXT DEFAULT '',
  reply_to_id INTEGER,
  thread_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_mutes (
  id SERIAL PRIMARY KEY,
  channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  muted_by INTEGER REFERENCES users(id),
  reason TEXT DEFAULT '',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS channel_requests (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS direct_conversations (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  user_a INTEGER REFERENCES users(id),
  user_b INTEGER REFERENCES users(id),
  last_message TEXT DEFAULT '',
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES direct_conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id),
  text TEXT NOT NULL,
  image_url TEXT DEFAULT '',
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channels_place ON channels(place_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_created ON channel_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conv ON direct_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_direct_conversations_users ON direct_conversations(user_a, user_b);
