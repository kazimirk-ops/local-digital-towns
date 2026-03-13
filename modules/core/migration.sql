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

-- Seed staging community
INSERT INTO communities (slug, name, domain, status, feature_flags)
VALUES ('digitaltowns', 'Digital Towns Staging',
        'digitaltowns.app', 'active',
        '{"core": true, "tags": true}')
ON CONFLICT (slug) DO NOTHING;
