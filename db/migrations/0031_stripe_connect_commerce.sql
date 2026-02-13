-- Stripe Connect + Commerce columns on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS regen_pct NUMERIC(4,2) DEFAULT 1.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shippo_api_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ship_from_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ship_from_street TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ship_from_city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ship_from_state TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ship_from_zip TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_code TEXT;

-- Facebook API key on places (seller storefronts)
ALTER TABLE places ADD COLUMN IF NOT EXISTS facebook_api_key TEXT;

-- Referrers table
CREATE TABLE IF NOT EXISTS referrers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  ref_code VARCHAR(20) UNIQUE NOT NULL,
  commission_percent NUMERIC(4,2) DEFAULT 5.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Referral earnings
CREATE TABLE IF NOT EXISTS referral_earnings (
  id SERIAL PRIMARY KEY,
  referrer_id INTEGER REFERENCES referrers(id),
  seller_id INTEGER REFERENCES users(id),
  invoice_id INTEGER,
  amount NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shipments table
CREATE TABLE IF NOT EXISTS shipments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'pending',
  from_name VARCHAR(255), from_street VARCHAR(255), from_city VARCHAR(255), from_state VARCHAR(50), from_zip VARCHAR(20),
  to_name VARCHAR(255), to_street VARCHAR(255), to_city VARCHAR(255), to_state VARCHAR(50), to_zip VARCHAR(20),
  weight_oz NUMERIC(10,2), length_in NUMERIC(10,2), width_in NUMERIC(10,2), height_in NUMERIC(10,2),
  selected_rate JSONB,
  label_url TEXT, tracking_number VARCHAR(255), tracking_url VARCHAR(255),
  carrier VARCHAR(100), service VARCHAR(255),
  shippo_shipment_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Standalone deposits for cash pickup
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS buyer_name TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS total_price NUMERIC(10,2);
