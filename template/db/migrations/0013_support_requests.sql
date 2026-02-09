-- Support Requests table for bug reports and feature requests
CREATE TABLE IF NOT EXISTS support_requests (
  id SERIAL PRIMARY KEY,
  userId INTEGER REFERENCES users(id),
  type VARCHAR(50) DEFAULT 'bug',
  name VARCHAR(255),
  email VARCHAR(255),
  subject VARCHAR(500) NOT NULL,
  details TEXT NOT NULL,
  page VARCHAR(255),
  device VARCHAR(255),
  userAgent TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  adminNotes TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_support_requests_userid ON support_requests(userId);
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status);
CREATE INDEX IF NOT EXISTS idx_support_requests_createdat ON support_requests(createdAt DESC);
