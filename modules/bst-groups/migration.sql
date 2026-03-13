-- BST Groups module migration
-- Buy/Sell/Trade groups with mod system, join requests, applications.
-- Extracted from DT bst_groups + PP pp_bst_groups

CREATE TABLE IF NOT EXISTS bst_groups (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  rules TEXT,
  facebook_group_url VARCHAR(500),
  banner_color VARCHAR(20) DEFAULT '#10b981',
  is_private BOOLEAN DEFAULT false,
  group_type VARCHAR(20) DEFAULT 'seller',
  mod_user_id INTEGER REFERENCES users(id),
  member_count INTEGER DEFAULT 0,
  featured BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bst_group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES bst_groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member',
  approved BOOLEAN DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS bst_group_applications (
  id SERIAL PRIMARY KEY,
  applicant_name VARCHAR(200),
  applicant_email VARCHAR(200),
  group_name VARCHAR(200),
  facebook_group_url VARCHAR(500),
  facebook_group_size INTEGER,
  why_apply TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bst_join_requests (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES bst_groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bst_groups_place ON bst_groups(place_id);
CREATE INDEX IF NOT EXISTS idx_bst_group_members_group ON bst_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_bst_group_members_user ON bst_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_bst_join_requests_group ON bst_join_requests(group_id);
