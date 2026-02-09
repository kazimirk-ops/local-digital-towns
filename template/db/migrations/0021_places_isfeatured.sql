-- Add isFeatured column to places for business plan visibility
ALTER TABLE places ADD COLUMN IF NOT EXISTS isFeatured INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_places_featured ON places(isFeatured);
