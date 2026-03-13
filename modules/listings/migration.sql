-- Listings module migration (L1)
-- Extracted from DT routes/listings.js + server.js auctions

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  seller_id INTEGER REFERENCES users(id),
  place_id INTEGER REFERENCES places(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_cents INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  category TEXT DEFAULT 'general',
  niche TEXT DEFAULT '',
  condition TEXT DEFAULT 'used',
  photos JSONB DEFAULT '[]',
  status TEXT DEFAULT 'active',
  listing_type TEXT DEFAULT 'buy_now',
  payment_methods JSONB DEFAULT '["pickup","shipping"]',
  shipping_enabled BOOLEAN DEFAULT true,
  pickup_enabled BOOLEAN DEFAULT true,
  delivery_enabled BOOLEAN DEFAULT false,
  quantity INTEGER DEFAULT 1,
  sold_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  featured BOOLEAN DEFAULT false,
  tags JSONB DEFAULT '[]',
  meta JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_place ON listings(place_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_type ON listings(listing_type, status);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category, niche);

-- Auctions table (from DT)
CREATE TABLE IF NOT EXISTS auctions (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id),
  seller_id INTEGER REFERENCES users(id),
  place_id INTEGER REFERENCES places(id),
  start_price_cents INTEGER NOT NULL,
  current_price_cents INTEGER,
  reserve_price_cents INTEGER,
  buy_now_price_cents INTEGER,
  bid_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  ends_at TIMESTAMPTZ NOT NULL,
  winner_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auction_bids (
  id SERIAL PRIMARY KEY,
  auction_id INTEGER REFERENCES auctions(id),
  bidder_id INTEGER REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auctions_listing ON auctions(listing_id);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status, ends_at);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON auction_bids(auction_id, amount_cents DESC);
