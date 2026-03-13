-- Places module migration
-- Self-referencing geographic hierarchy
-- Unifies DT communities + Sebastian towns/districts + PP network_levels

CREATE TABLE IF NOT EXISTS places (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'town',
  -- types: country, state, region, town, neighborhood
  parent_id INTEGER REFERENCES places(id),
  domain TEXT,
  status TEXT DEFAULT 'pending',
  -- pending, active, inactive
  feature_flags JSONB DEFAULT '{}',
  lat DECIMAL(10,7),
  lng DECIMAL(10,7),
  radius_meters INTEGER DEFAULT 40000,
  bounding_box JSONB DEFAULT NULL,
  zoom INTEGER DEFAULT 13,
  population INTEGER,
  timezone TEXT DEFAULT 'America/New_York',
  county TEXT DEFAULT '',
  meta JSONB DEFAULT '{}',
  -- theme colors, niches, branding, pulse feeds
  level INTEGER DEFAULT 0,
  level_progress INTEGER DEFAULT 0,
  -- from PP network_levels progression model
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_places_parent ON places(parent_id);
CREATE INDEX IF NOT EXISTS idx_places_type ON places(type);
CREATE INDEX IF NOT EXISTS idx_places_domain ON places(domain);
CREATE INDEX IF NOT EXISTS idx_places_status ON places(status);

-- Place memberships
-- Unifies DT community_memberships + PP town_connections
CREATE TABLE IF NOT EXISTS place_memberships (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  user_id INTEGER REFERENCES users(id),
  role TEXT DEFAULT 'member',
  -- member, moderator, admin, founder
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(place_id, user_id)
);

-- Town/place requests (from DT + PP)
CREATE TABLE IF NOT EXISTS place_requests (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  place_name TEXT NOT NULL,
  state TEXT,
  country TEXT DEFAULT 'US',
  population_range TEXT,
  message TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the geographic hierarchy

-- United States
INSERT INTO places (name, slug, type, status, timezone)
VALUES ('United States', 'us', 'country', 'active', 'America/New_York')
ON CONFLICT (slug) DO NOTHING;

-- Florida
INSERT INTO places (name, slug, type, parent_id, status, timezone, lat, lng, zoom)
VALUES ('Florida', 'florida', 'state',
  (SELECT id FROM places WHERE slug='us'),
  'active', 'America/New_York', 27.9944, -81.7603, 7)
ON CONFLICT (slug) DO NOTHING;

-- Treasure Coast Region
INSERT INTO places (name, slug, type, parent_id, status, timezone, lat, lng, zoom)
VALUES ('Treasure Coast', 'treasure-coast', 'region',
  (SELECT id FROM places WHERE slug='florida'),
  'active', 'America/New_York', 27.5905, -80.3659, 10)
ON CONFLICT (slug) DO NOTHING;

-- Tampa Bay Region
INSERT INTO places (name, slug, type, parent_id, status, timezone, lat, lng, zoom)
VALUES ('Tampa Bay', 'tampa-bay-region', 'region',
  (SELECT id FROM places WHERE slug='florida'),
  'active', 'America/New_York', 27.9506, -82.4572, 10)
ON CONFLICT (slug) DO NOTHING;

-- Sebastian (town)
INSERT INTO places (name, slug, type, parent_id, status, domain,
  lat, lng, radius_meters, zoom, timezone, county, feature_flags)
VALUES (
  'Sebastian', 'sebastian', 'town',
  (SELECT id FROM places WHERE slug='treasure-coast'),
  'active', 'sebastian-florida.com',
  27.8164, -80.4706, 40000, 13,
  'America/New_York', 'Indian River',
  '{"core":true,"tags":true,"auth":true,"places":true}')
ON CONFLICT (slug) DO NOTHING;

-- Digital Towns staging (town)
INSERT INTO places (name, slug, type, parent_id, status, domain,
  lat, lng, zoom, timezone, feature_flags)
VALUES (
  'Digital Towns Staging', 'digitaltowns', 'town',
  (SELECT id FROM places WHERE slug='us'),
  'active', 'digitaltowns.app',
  27.8164, -80.4706, 13,
  'America/New_York',
  '{"core":true,"tags":true,"auth":true,"places":true}')
ON CONFLICT (slug) DO NOTHING;
