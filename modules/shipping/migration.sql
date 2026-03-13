-- Shipping module migration (L1)
-- Extracted from PP Shippo integration + Sebastian shipments

CREATE TABLE IF NOT EXISTS shipments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  seller_id INTEGER REFERENCES users(id),
  buyer_id INTEGER REFERENCES users(id),
  carrier TEXT,
  service TEXT,
  tracking_number TEXT,
  label_url TEXT,
  shippo_shipment_id TEXT,
  shippo_transaction_id TEXT,
  shippo_rate_id TEXT,
  from_address JSONB DEFAULT '{}',
  to_address JSONB DEFAULT '{}',
  parcel JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  rate_cents INTEGER,
  weight_oz DECIMAL,
  estimated_days INTEGER,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);
