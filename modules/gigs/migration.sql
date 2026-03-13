-- Gigs module migration
-- Gig categories, providers, bookings, reviews, service inquiries.
-- Extracted from DT routes/gigs.js + Sebastian service_inquiries

CREATE TABLE IF NOT EXISTS gig_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS gig_providers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  category_slug VARCHAR(100),
  place_id INTEGER REFERENCES places(id),
  business_name VARCHAR(200) DEFAULT '',
  bio TEXT DEFAULT '',
  phone VARCHAR(50) DEFAULT '',
  service_radius_miles INTEGER DEFAULT 25,
  insured BOOLEAN DEFAULT false,
  licensed BOOLEAN DEFAULT false,
  avg_rating DECIMAL(2,1) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  featured BOOLEAN DEFAULT false,
  stripe_account_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gig_applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  category_slug VARCHAR(100),
  place_id INTEGER REFERENCES places(id),
  business_name VARCHAR(200) DEFAULT '',
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(50) DEFAULT '',
  email VARCHAR(200) DEFAULT '',
  experience TEXT DEFAULT '',
  availability TEXT DEFAULT '',
  services JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gig_bookings (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER REFERENCES gig_providers(id),
  customer_id INTEGER REFERENCES users(id),
  category_slug VARCHAR(100),
  description TEXT DEFAULT '',
  scheduled_at TIMESTAMPTZ,
  address TEXT DEFAULT '',
  status VARCHAR(30) DEFAULT 'pending',
  price_cents INTEGER DEFAULT 0,
  stripe_payment_id TEXT,
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gig_reviews (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES gig_bookings(id) UNIQUE,
  reviewer_id INTEGER REFERENCES users(id),
  provider_id INTEGER REFERENCES gig_providers(id),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT DEFAULT '',
  helpful_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Service inquiries (from Sebastian service_inquiries)
CREATE TABLE IF NOT EXISTS service_inquiries (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  user_id INTEGER REFERENCES users(id),
  provider_id INTEGER REFERENCES gig_providers(id),
  category VARCHAR(100) DEFAULT '',
  form_data JSONB DEFAULT '{}',
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gig_providers_place ON gig_providers(place_id);
CREATE INDEX IF NOT EXISTS idx_gig_providers_category ON gig_providers(category_slug);
CREATE INDEX IF NOT EXISTS idx_gig_bookings_provider ON gig_bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_gig_bookings_customer ON gig_bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_gig_reviews_provider ON gig_reviews(provider_id);
CREATE INDEX IF NOT EXISTS idx_service_inquiries_place ON service_inquiries(place_id);

-- Seed default gig categories
INSERT INTO gig_categories (name, slug, description, sort_order)
VALUES
  ('Hauling', 'hauling', 'Move furniture & items', 1),
  ('Junk Removal', 'junk', 'Haul away junk', 2),
  ('Handyman', 'handyman', 'Home repairs', 3),
  ('Lawn Care', 'lawn', 'Mowing & landscaping', 4),
  ('Cleaning', 'cleaning', 'Home cleaning', 5),
  ('Pressure Washing', 'pressure-washing', 'Exterior cleaning', 6),
  ('Painting', 'painting', 'Interior & exterior', 7),
  ('Rides', 'rides', 'Local transportation', 8)
ON CONFLICT (slug) DO NOTHING;
