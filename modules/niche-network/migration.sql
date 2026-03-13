-- Niche Network module migration (L3)
-- Registered niche platforms + inbound sale events

-- Registered niche platforms
CREATE TABLE IF NOT EXISTS niche_platforms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  webhook_secret TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  sale_count INTEGER DEFAULT 0,
  buyer_count INTEGER DEFAULT 0,
  last_event_at TIMESTAMPTZ,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- All sale events received from niche platforms
CREATE TABLE IF NOT EXISTS niche_sale_events (
  id SERIAL PRIMARY KEY,
  platform_id INTEGER REFERENCES niche_platforms(id),
  platform_slug TEXT NOT NULL,
  external_ref TEXT,
  buyer_email TEXT,
  buyer_name TEXT,
  buyer_phone TEXT,
  ship_to_city TEXT,
  ship_to_state TEXT,
  ship_to_zip TEXT,
  ship_to_country TEXT DEFAULT 'US',
  amount_cents INTEGER DEFAULT 0,
  category TEXT DEFAULT '',
  tags JSONB DEFAULT '[]',
  place_id INTEGER REFERENCES places(id),
  user_id INTEGER REFERENCES users(id),
  processed BOOLEAN DEFAULT false,
  location_tag_fired BOOLEAN DEFAULT false,
  raw JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform_slug, external_ref)
);

CREATE INDEX IF NOT EXISTS idx_sale_events_platform ON niche_sale_events(platform_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_events_zip ON niche_sale_events(ship_to_zip);
CREATE INDEX IF NOT EXISTS idx_sale_events_place ON niche_sale_events(place_id);

-- Add zip_codes array column to places table
ALTER TABLE places ADD COLUMN IF NOT EXISTS zip_codes TEXT[] DEFAULT '{}';

-- Seed plant-purge platform
INSERT INTO niche_platforms (name, slug, webhook_secret)
VALUES ('Plant Purge', 'plant-purge', 'pp-webhook-secret-change-me')
ON CONFLICT (slug) DO NOTHING;

-- Seed zip codes for existing places
UPDATE places SET zip_codes = ARRAY['32958','32960','32966','32967','32968','32976','32978']
WHERE slug = 'sebastian';

UPDATE places SET zip_codes = ARRAY['33601','33602','33603','33604','33605','33606','33607','33609','33610','33611','33612','33613','33614','33615','33616','33617','33618','33619','33620','33621','33629','33634','33635','33637','33647']
WHERE slug = 'tampa-bay-region';
