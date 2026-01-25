-- Add subscriptionTier column to users table for quick access to subscription level
-- Tier 0 = no subscription, Tier 1 = User ($5/mo), Tier 2 = Business ($10/mo)
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscriptionTier INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripeCustomerId TEXT;

-- Update existing users with subscriptions to have correct tier
UPDATE users u SET subscriptionTier =
  CASE
    WHEN (SELECT plan FROM user_subscriptions WHERE userId = u.id AND status IN ('active', 'trialing') ORDER BY createdAt DESC LIMIT 1) = 'business' THEN 2
    WHEN (SELECT plan FROM user_subscriptions WHERE userId = u.id AND status IN ('active', 'trialing') ORDER BY createdAt DESC LIMIT 1) = 'user' THEN 1
    ELSE 0
  END;

-- Update stripeCustomerId from user_subscriptions
UPDATE users u SET stripeCustomerId = (
  SELECT stripeCustomerId FROM user_subscriptions WHERE userId = u.id ORDER BY createdAt DESC LIMIT 1
) WHERE stripeCustomerId IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_subscription_tier ON users(subscriptionTier);
