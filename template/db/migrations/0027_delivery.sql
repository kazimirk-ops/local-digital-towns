-- Delivery support for managed stores
ALTER TABLE places ADD COLUMN IF NOT EXISTS pickup_address_full TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address JSONB DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS uber_quote_id TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS uber_delivery_id TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT '';
