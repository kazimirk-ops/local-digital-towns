-- Add terms acceptance tracking to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS termsAcceptedAt TIMESTAMPTZ;

-- Index for querying users who have/haven't accepted terms
CREATE INDEX IF NOT EXISTS idx_users_terms_accepted ON users(termsAcceptedAt);

-- Add terms acceptance to application tables
ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS termsAcceptedAt TIMESTAMPTZ;
ALTER TABLE business_applications ADD COLUMN IF NOT EXISTS termsAcceptedAt TIMESTAMPTZ;
ALTER TABLE resident_applications ADD COLUMN IF NOT EXISTS termsAcceptedAt TIMESTAMPTZ;
