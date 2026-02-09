-- Link sweep_rules to specific sweepstakes for per-giveaway entry rewards.
-- Rows with sweepstake_id IS NULL remain global (town-level) rules.
ALTER TABLE sweep_rules
  ADD COLUMN IF NOT EXISTS sweepstake_id INTEGER
  REFERENCES sweepstakes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sweep_rules_sweepstake
  ON sweep_rules(sweepstake_id);
