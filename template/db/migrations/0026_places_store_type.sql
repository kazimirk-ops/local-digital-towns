-- Add storeType column to places table
-- Values: 'peer' (default) for peer-to-peer commerce, 'managed' for stores that handle transactions
ALTER TABLE places ADD COLUMN IF NOT EXISTS storeType TEXT DEFAULT 'peer';

-- Set Sebastian Organics (ID 18) to managed store
UPDATE places SET storeType = 'managed' WHERE id = 18;
