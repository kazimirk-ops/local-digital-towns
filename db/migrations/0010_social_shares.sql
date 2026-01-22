CREATE TABLE IF NOT EXISTS social_shares (
  id SERIAL PRIMARY KEY,
  userId INTEGER,
  shareType TEXT NOT NULL,
  itemType TEXT NOT NULL,
  itemId INTEGER NOT NULL,
  platform TEXT NOT NULL DEFAULT 'facebook',
  createdAt TIMESTAMPTZ NOT NULL
);
