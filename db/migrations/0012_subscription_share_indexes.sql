-- Indexes for business_subscriptions
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_placeid ON business_subscriptions(placeId);
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_userid ON business_subscriptions(userId);
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_status ON business_subscriptions(status);

-- Indexes for giveaway_offers
CREATE INDEX IF NOT EXISTS idx_giveaway_offers_placeid ON giveaway_offers(placeId);
CREATE INDEX IF NOT EXISTS idx_giveaway_offers_userid ON giveaway_offers(userId);
CREATE INDEX IF NOT EXISTS idx_giveaway_offers_status ON giveaway_offers(status);
CREATE INDEX IF NOT EXISTS idx_giveaway_offers_createdat ON giveaway_offers(createdAt DESC);

-- Indexes for social_shares
CREATE INDEX IF NOT EXISTS idx_social_shares_userid ON social_shares(userId);
CREATE INDEX IF NOT EXISTS idx_social_shares_itemtype_itemid ON social_shares(itemType, itemId);
CREATE INDEX IF NOT EXISTS idx_social_shares_createdat ON social_shares(createdAt DESC);

-- Indexes for pulse_exports
CREATE INDEX IF NOT EXISTS idx_pulse_exports_townid ON pulse_exports(townId);
CREATE INDEX IF NOT EXISTS idx_pulse_exports_exportedat ON pulse_exports(exportedAt DESC);
