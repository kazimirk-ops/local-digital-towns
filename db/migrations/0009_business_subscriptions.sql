CREATE TABLE IF NOT EXISTS business_subscriptions (
  id SERIAL PRIMARY KEY,
  placeId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free_trial',
  status TEXT NOT NULL DEFAULT 'active',
  trialEndsAt TIMESTAMPTZ,
  currentPeriodStart TIMESTAMPTZ,
  currentPeriodEnd TIMESTAMPTZ,
  canceledAt TIMESTAMPTZ,
  stripeCustomerId TEXT,
  stripeSubscriptionId TEXT,
  createdAt TIMESTAMPTZ NOT NULL,
  updatedAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaway_offers (
  id SERIAL PRIMARY KEY,
  placeId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  estimatedValue INTEGER NOT NULL DEFAULT 0,
  imageUrl TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  rewardType TEXT NOT NULL DEFAULT 'free_month',
  reviewedAt TIMESTAMPTZ,
  reviewedByUserId INTEGER,
  adminNotes TEXT,
  createdAt TIMESTAMPTZ NOT NULL
);
