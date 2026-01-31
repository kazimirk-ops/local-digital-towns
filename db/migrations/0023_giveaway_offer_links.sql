-- Link giveaway_offers to the prize_offers and sweepstakes rows
-- created by the bridge code on approval.
ALTER TABLE giveaway_offers
  ADD COLUMN IF NOT EXISTS sweepstake_id INTEGER
  REFERENCES sweepstakes(id) ON DELETE SET NULL;

ALTER TABLE giveaway_offers
  ADD COLUMN IF NOT EXISTS prize_offer_id INTEGER
  REFERENCES prize_offers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_giveaway_offers_sweepstake
  ON giveaway_offers(sweepstake_id);

CREATE INDEX IF NOT EXISTS idx_giveaway_offers_prize_offer
  ON giveaway_offers(prize_offer_id);
