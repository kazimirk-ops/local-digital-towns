-- User subscriptions table for personal user tiers ($5/mo user, $10/mo business)
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id SERIAL PRIMARY KEY,
  userId INTEGER NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'user',  -- 'user' ($5/mo) or 'business' ($10/mo)
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'canceled', 'expired', 'trialing'
  stripeCustomerId TEXT,
  stripeSubscriptionId TEXT,
  currentPeriodStart TIMESTAMPTZ,
  currentPeriodEnd TIMESTAMPTZ,
  canceledAt TIMESTAMPTZ,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups by userId and stripeCustomerId
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_userid ON user_subscriptions(userId);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe ON user_subscriptions(stripeCustomerId);
