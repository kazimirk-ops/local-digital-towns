-- Businesses module migration
-- Map pins, seeded businesses, claim flow, local business applications.
-- Extracted from DT routes/businesses.js + routes/seeded.js + Sebastian localbiz

CREATE TABLE IF NOT EXISTS businesses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  address TEXT,
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  city VARCHAR(100),
  phone VARCHAR(50),
  website TEXT,
  hours JSONB DEFAULT '{}',
  photos JSONB DEFAULT '[]',
  seeded BOOLEAN DEFAULT false,
  seeded_at TIMESTAMPTZ,
  claimed BOOLEAN DEFAULT false,
  claimed_at TIMESTAMPTZ,
  claimed_by INTEGER REFERENCES users(id),
  share_token TEXT UNIQUE,
  share_token_expires_at TIMESTAMPTZ,
  share_count INTEGER DEFAULT 0,
  removed BOOLEAN DEFAULT false,
  removed_at TIMESTAMPTZ,
  approved BOOLEAN DEFAULT false,
  rating DECIMAL(2,1) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  place_id INTEGER REFERENCES places(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_businesses_place ON businesses(place_id);
CREATE INDEX IF NOT EXISTS idx_businesses_coords ON businesses(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_businesses_seeded ON businesses(seeded);
CREATE INDEX IF NOT EXISTS idx_businesses_share_token ON businesses(share_token);

-- Local business applications (from Sebastian local_business_applications)
CREATE TABLE IF NOT EXISTS business_applications (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  user_id INTEGER REFERENCES users(id),
  business_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
