CREATE TABLE IF NOT EXISTS channel_mutes (
  id SERIAL PRIMARY KEY,
  channel_id INT NOT NULL,
  user_id INT NOT NULL,
  muted_by_user_id INT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, user_id)
);
