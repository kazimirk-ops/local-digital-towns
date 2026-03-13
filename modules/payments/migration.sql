-- Payments module migration (L1)
-- Extracted from PP Stripe + DT Connect + PP wallet

-- Seller payment accounts
CREATE TABLE IF NOT EXISTS seller_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) UNIQUE,
  stripe_account_id TEXT,
  stripe_onboarded BOOLEAN DEFAULT false,
  stripe_charges_enabled BOOLEAN DEFAULT false,
  stripe_payouts_enabled BOOLEAN DEFAULT false,
  payment_methods_enabled JSONB DEFAULT '["stripe","cash"]',
  platform_fee_pct DECIMAL DEFAULT 10.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Payment transactions
CREATE TABLE IF NOT EXISTS payment_transactions (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  invoice_id INTEGER REFERENCES invoices(id),
  user_id INTEGER REFERENCES users(id),
  type TEXT DEFAULT 'charge',
  amount_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER DEFAULT 0,
  stripe_payment_intent_id TEXT,
  stripe_transfer_id TEXT,
  status TEXT DEFAULT 'pending',
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Wallet (from PP)
CREATE TABLE IF NOT EXISTS wallet_balances (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) UNIQUE,
  balance_cents INTEGER DEFAULT 0,
  total_earned_cents INTEGER DEFAULT 0,
  total_spent_cents INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  type TEXT,
  amount_cents INTEGER NOT NULL,
  description TEXT,
  order_id INTEGER REFERENCES orders(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
