-- Add trialEnd column to user_subscriptions for tracking trial periods
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS trialEnd TIMESTAMPTZ;
