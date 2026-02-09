-- Migration: signup_login_tokens
-- Creates table for one-time login tokens generated during signup

CREATE TABLE IF NOT EXISTS signup_login_tokens (
  id SERIAL PRIMARY KEY,
  userId INTEGER NOT NULL UNIQUE,
  token TEXT NOT NULL,
  expiresAt TIMESTAMPTZ NOT NULL,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  usedAt TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signup_tokens_token ON signup_login_tokens(token);
CREATE INDEX IF NOT EXISTS idx_signup_tokens_expires ON signup_login_tokens(expiresAt);
