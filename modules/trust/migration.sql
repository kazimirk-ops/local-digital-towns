-- Trust module migration (L4)
-- Trust tiers, identity verification, resident verification, business subscriptions

-- Trust applications (identity verification requests)
-- Adapted from Sebastian data.js trust_applications table
CREATE TABLE IF NOT EXISTS trust_applications (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  requested_tier INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address1 TEXT NOT NULL DEFAULT '',
  address2 TEXT DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  identity_method TEXT NOT NULL DEFAULT '',
  identity_status TEXT NOT NULL DEFAULT 'pending',
  presence_status TEXT NOT NULL DEFAULT 'pending',
  presence_verified_at TIMESTAMPTZ,
  presence_lat DOUBLE PRECISION,
  presence_lng DOUBLE PRECISION,
  presence_accuracy_meters DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id INTEGER REFERENCES users(id),
  decision_reason TEXT DEFAULT ''
);

-- Resident verification requests
-- Adapted from Sebastian data.js resident_verification_requests table
CREATE TABLE IF NOT EXISTS resident_verification_requests (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  address_line1 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id INTEGER REFERENCES users(id),
  decision_reason TEXT DEFAULT ''
);

-- Business subscriptions
-- Adapted from Sebastian data.js business_subscriptions table
CREATE TABLE IF NOT EXISTS business_subscriptions (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'free_trial',
  status TEXT NOT NULL DEFAULT 'active',
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure trust-related columns exist on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_tier INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_buyer_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_seller_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS resident_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ghosting_percent NUMERIC(5,1) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ghost_report_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_orders_as_buyer INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bidding_suspended_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trust_applications_user ON trust_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_trust_applications_status ON trust_applications(status);
CREATE INDEX IF NOT EXISTS idx_resident_verif_user ON resident_verification_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_resident_verif_status ON resident_verification_requests(status);
CREATE INDEX IF NOT EXISTS idx_biz_sub_place ON business_subscriptions(place_id);
CREATE INDEX IF NOT EXISTS idx_biz_sub_user ON business_subscriptions(user_id);
