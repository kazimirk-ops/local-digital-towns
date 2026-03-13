-- Tags module migration

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'content',
  network_scope TEXT DEFAULT 'local',
  description TEXT DEFAULT '',
  auto_apply_rule JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_tags (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'manual',
  value TEXT DEFAULT '',
  applied_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT NULL,
  UNIQUE(user_id, tag_id)
);

CREATE TABLE IF NOT EXISTS listing_tags (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  applied_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(listing_id, tag_id)
);

CREATE TABLE IF NOT EXISTS tag_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'apply',
  delta INTEGER DEFAULT 0,
  source_table TEXT DEFAULT '',
  source_id INTEGER DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tag_rules (
  id SERIAL PRIMARY KEY,
  seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  action TEXT NOT NULL DEFAULT 'auto-tag',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(seller_id, tag_id, action)
);

-- Seed starter tags (23 total, idempotent)

-- Content tags (10)
INSERT INTO tags (name, type, network_scope, description) VALUES
  ('plants', 'content', 'global', 'Plant-related listings and sellers'),
  ('gaming', 'content', 'global', 'Gaming and video game items'),
  ('live-stream', 'content', 'global', 'Live stream shows and auctions'),
  ('travel', 'content', 'global', 'Travel-related services and listings'),
  ('food', 'content', 'global', 'Food, produce, and culinary items'),
  ('collectibles', 'content', 'global', 'Collectible cards, coins, memorabilia'),
  ('fashion', 'content', 'global', 'Clothing, shoes, accessories'),
  ('home-garden', 'content', 'global', 'Home improvement and garden supplies'),
  ('pets', 'content', 'global', 'Pet supplies and services'),
  ('sports', 'content', 'global', 'Sports equipment and memorabilia')
ON CONFLICT (name) DO NOTHING;

-- Behavioral tags (8)
INSERT INTO tags (name, type, network_scope, description) VALUES
  ('trusted-buyer', 'behavioral', 'global', 'Completed purchases with no disputes'),
  ('trusted-seller', 'behavioral', 'global', 'Consistent fulfillment, positive reviews'),
  ('ghost-risk', 'behavioral', 'local', 'No-show pattern on local pickups'),
  ('review-flag', 'behavioral', 'local', 'Flagged for suspicious review activity'),
  ('high-engagement', 'behavioral', 'global', 'Frequent listings, purchases, or shares'),
  ('verified-local', 'behavioral', 'local', 'GPS-verified local presence'),
  ('top-seller', 'behavioral', 'global', 'Top 10% by volume in their community'),
  ('new-member', 'behavioral', 'global', 'Account less than 30 days old')
ON CONFLICT (name) DO NOTHING;

-- Interest tags (5)
INSERT INTO tags (name, type, network_scope, description) VALUES
  ('interested-plants', 'interest', 'global', 'Browsed or purchased plant items'),
  ('interested-gaming', 'interest', 'global', 'Browsed or purchased gaming items'),
  ('interested-collectibles', 'interest', 'global', 'Browsed or purchased collectibles'),
  ('interested-food', 'interest', 'global', 'Browsed or purchased food items'),
  ('interested-travel', 'interest', 'global', 'Browsed or purchased travel services')
ON CONFLICT (name) DO NOTHING;
