-- Orders & Invoices module migration (L1)
-- Extracted from PP invoices + DT orders

-- Buyer profiles (from PP)
CREATE TABLE IF NOT EXISTS buyer_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  ship_to_name TEXT,
  ship_to_street TEXT,
  ship_to_city TEXT,
  ship_to_state TEXT,
  ship_to_zip TEXT,
  ship_to_country TEXT DEFAULT 'US',
  notes TEXT,
  tags JSONB DEFAULT '[]',
  place_id INTEGER REFERENCES places(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Orders (unified DT + PP)
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id),
  seller_id INTEGER REFERENCES users(id),
  buyer_id INTEGER REFERENCES users(id),
  buyer_profile_id INTEGER REFERENCES buyer_profiles(id),
  place_id INTEGER REFERENCES places(id),
  status TEXT DEFAULT 'pending',
  subtotal_cents INTEGER DEFAULT 0,
  shipping_cents INTEGER DEFAULT 0,
  platform_fee_cents INTEGER DEFAULT 0,
  total_cents INTEGER DEFAULT 0,
  deposit_cents INTEGER DEFAULT 0,
  deposit_pct INTEGER DEFAULT 0,
  balance_due_cents INTEGER DEFAULT 0,
  payment_method TEXT DEFAULT 'stripe',
  stripe_payment_intent_id TEXT,
  shipping_address JSONB DEFAULT '{}',
  tracking_number TEXT,
  carrier TEXT,
  notes TEXT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Invoices (from PP — most sophisticated)
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  seller_id INTEGER REFERENCES users(id),
  buyer_profile_id INTEGER REFERENCES buyer_profiles(id),
  invoice_number TEXT UNIQUE,
  status TEXT DEFAULT 'draft',
  line_items JSONB DEFAULT '[]',
  subtotal_cents INTEGER DEFAULT 0,
  shipping_cents INTEGER DEFAULT 0,
  discount_cents INTEGER DEFAULT 0,
  total_cents INTEGER DEFAULT 0,
  amount_paid_cents INTEGER DEFAULT 0,
  deposit_pct INTEGER DEFAULT 0,
  deposit_amount_cents INTEGER DEFAULT 0,
  notes TEXT,
  due_date DATE,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_seller ON invoices(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
