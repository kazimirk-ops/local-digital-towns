-- Add "service" listing type support
-- New columns on listings for service-specific settings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS service_form_fields JSONB DEFAULT '[]'::jsonb;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS service_cta_label TEXT DEFAULT 'Request Quote';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS service_thank_you TEXT DEFAULT 'Thank you — your inquiry has been received.';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS google_calendar_url TEXT DEFAULT '';

-- Service inquiries table
CREATE TABLE IF NOT EXISTS service_inquiries (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  place_id INTEGER NOT NULL,
  seller_user_id INTEGER NOT NULL,
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_email TEXT NOT NULL DEFAULT '',
  form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_inquiries_place ON service_inquiries(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_inquiries_listing ON service_inquiries(listing_id, created_at DESC);

-- Data migration: Convert Bouffard's "2025 1040 Individual Tax Return" listing to service type
UPDATE listings
SET listingtype = 'service',
    service_cta_label = 'Get Started',
    service_thank_you = 'Thank you for your inquiry! Allie will review your information and reach out within 1-2 business days.',
    service_form_fields = '[{"id":"f1","type":"text","label":"Full Name","required":true,"placeholder":"Your full legal name"},{"id":"f2","type":"email","label":"Email","required":true,"placeholder":"you@example.com"},{"id":"f3","type":"phone","label":"Phone","required":false,"placeholder":"(555) 123-4567"},{"id":"f4","type":"dropdown","label":"Filing Status","required":true,"options":["Single","Married Filing Jointly","Married Filing Separately","Head of Household","Qualifying Widow(er)"]},{"id":"f5","type":"textarea","label":"Additional Notes","required":false,"placeholder":"Any special circumstances, questions, or additional information..."}]'::jsonb
WHERE placeid IN (SELECT id FROM places WHERE owneruserid = 24)
  AND LOWER(title) LIKE '%1040%individual%tax%'
  AND listingtype = 'item';
