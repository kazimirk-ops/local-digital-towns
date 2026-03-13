-- Moderation module migration (L4)
-- Content reports, moderation queue, word filters, audit log

-- Content reports (user-submitted reports on listings, messages, users, etc.)
CREATE TABLE IF NOT EXISTS content_reports (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  reporter_user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  target_user_id INTEGER REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  details TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  resolution TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Moderation audit log
CREATE TABLE IF NOT EXISTS moderation_log (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Word filters (banned/flagged words)
CREATE TABLE IF NOT EXISTS word_filters (
  id SERIAL PRIMARY KEY,
  word TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL DEFAULT 'flag',
  active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports(reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_target ON content_reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_moderation_log_admin ON moderation_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_log_target ON moderation_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_word_filters_active ON word_filters(active) WHERE active = true;
