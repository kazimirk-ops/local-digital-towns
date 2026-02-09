-- Referral System Migration
-- Adds referral tracking, commission calculation, and credit management

-- Add referral fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS referralCode TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referralBalanceCents INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referralEarningsTotal INTEGER DEFAULT 0;

-- Index for quick referral code lookups
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referralCode);

-- Referral transactions table (log earnings and cashouts)
CREATE TABLE IF NOT EXISTS referral_transactions (
  id SERIAL PRIMARY KEY,
  userId INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,  -- 'commission', 'credit_applied', 'cashout'
  amountCents INTEGER NOT NULL,
  referredUserId INTEGER REFERENCES users(id),  -- who was referred (for commission type)
  subscriptionId INTEGER,  -- which subscription triggered this
  description TEXT,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_tx_user ON referral_transactions(userId);
CREATE INDEX IF NOT EXISTS idx_referral_tx_referred ON referral_transactions(referredUserId);
CREATE INDEX IF NOT EXISTS idx_referral_tx_type ON referral_transactions(type);

-- Generate referral codes for existing users who don't have one
-- Using a function to generate unique 8-character alphanumeric codes
CREATE OR REPLACE FUNCTION generate_referral_code() RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Backfill referral codes for existing users
DO $$
DECLARE
  user_record RECORD;
  new_code TEXT;
  attempts INTEGER;
BEGIN
  FOR user_record IN SELECT id FROM users WHERE referralCode IS NULL LOOP
    attempts := 0;
    LOOP
      new_code := generate_referral_code();
      BEGIN
        UPDATE users SET referralCode = new_code WHERE id = user_record.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique referral code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END LOOP;
END $$;
