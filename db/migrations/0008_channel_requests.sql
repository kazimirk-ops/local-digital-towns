-- Channel request system and per-channel moderators

-- Table for users to request new channels
CREATE TABLE IF NOT EXISTS channel_requests (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  userId INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewedByUserId INTEGER,
  reviewedAt TIMESTAMPTZ,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_requests_status ON channel_requests(townId, status, createdAt);
CREATE INDEX IF NOT EXISTS idx_channel_requests_user ON channel_requests(userId, createdAt);

-- Add moderator role support to channel_memberships (role already exists, just documenting)
-- Roles: 'member', 'moderator', 'admin'
