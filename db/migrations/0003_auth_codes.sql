CREATE TABLE IF NOT EXISTS auth_codes (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_codes_email_created ON auth_codes(email, created_at DESC);
