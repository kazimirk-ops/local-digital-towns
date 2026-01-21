-- Add approvedTier column to application tables
ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS approvedTier INTEGER DEFAULT NULL;
ALTER TABLE business_applications ADD COLUMN IF NOT EXISTS approvedTier INTEGER DEFAULT NULL;
ALTER TABLE resident_applications ADD COLUMN IF NOT EXISTS approvedTier INTEGER DEFAULT NULL;
