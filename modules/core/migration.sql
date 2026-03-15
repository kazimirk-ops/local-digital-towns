-- Core module migration
-- Always runs first on every boot. All tables use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  module_name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communities (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  feature_flags JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  trust_tier TEXT DEFAULT 'visitor',
  is_admin INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  user_id INTEGER,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Platform users identity bridge
CREATE TABLE IF NOT EXISTS platform_users (
  id SERIAL PRIMARY KEY,
  dt_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  platform_slug TEXT NOT NULL,
  platform_user_id TEXT,
  platform_user_type TEXT,
  platform_display_name TEXT,
  platform_avatar_url TEXT,
  platform_stripe_connected BOOLEAN DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  UNIQUE(email, platform_slug)
);

CREATE INDEX IF NOT EXISTS idx_platform_users_email
  ON platform_users(email);
CREATE INDEX IF NOT EXISTS idx_platform_users_dt_user_id
  ON platform_users(dt_user_id);
CREATE INDEX IF NOT EXISTS idx_platform_users_platform_slug
  ON platform_users(platform_slug);

-- Seed staging community
INSERT INTO communities (slug, name, domain, status, feature_flags)
VALUES ('digitaltowns', 'Digital Towns Staging',
        'digitaltowns.app', 'active',
        '{"core": true, "tags": true, "auth": true, "places": true}')
ON CONFLICT (slug) DO NOTHING;
