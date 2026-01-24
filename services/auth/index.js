/**
 * Auth Service - Authentication & Authorization
 *
 * This private service handles:
 * - JWT token generation and validation
 * - Email/password authentication
 * - OAuth flows (Facebook, Google) - OPTIONAL
 * - Session management via Redis
 * - Permission checks
 *
 * Runs on internal network only (port 3002)
 */

require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const Redis = require('ioredis');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// CRITICAL: JWT_SECRET must be set in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET environment variable is required in production');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET not set - using insecure default for development only');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-secret-DO-NOT-USE-IN-PRODUCTION';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Redis connection (optional - graceful fallback)
let redis = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
  redis.on('error', (err) => console.error('Redis error:', err.message));
  redis.on('connect', () => console.log('Redis connected'));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'auth-service' });
});

// ============ JWT UTILITIES ============

function generateToken(payload) {
  return jwt.sign(payload, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, EFFECTIVE_JWT_SECRET);
  } catch (err) {
    return null;
  }
}

async function storeSession(userId, token, metadata = {}) {
  if (!redis) return true;
  const sessionKey = `session:${userId}:${token.slice(-16)}`;
  const sessionData = JSON.stringify({
    userId,
    createdAt: new Date().toISOString(),
    ...metadata
  });
  await redis.setex(sessionKey, 7 * 24 * 60 * 60, sessionData); // 7 days
  return true;
}

async function invalidateSession(userId, tokenSuffix) {
  if (!redis) return true;
  const sessionKey = `session:${userId}:${tokenSuffix}`;
  await redis.del(sessionKey);
  return true;
}

async function isSessionValid(userId, tokenSuffix) {
  if (!redis) return true; // No Redis = trust JWT
  const sessionKey = `session:${userId}:${tokenSuffix}`;
  const exists = await redis.exists(sessionKey);
  return exists === 1;
}

// ============ EMAIL/PASSWORD AUTH ============

// Register new user
app.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Check if user exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, passwordHash, displayName, createdAt, updatedAt)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id, email, displayName`,
      [email.toLowerCase(), passwordHash, displayName || null]
    );

    const user = result.rows[0];
    const token = generateToken({ userId: user.id, email: user.email });
    await storeSession(user.id, token, { authMethod: 'email' });

    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayname },
      token
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login with email/password
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, displayName, passwordHash FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.passwordhash) {
      return res.status(401).json({ error: 'Password login not available. Try social login.' });
    }

    const valid = await bcrypt.compare(password, user.passwordhash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken({ userId: user.id, email: user.email });
    await storeSession(user.id, token, { authMethod: 'email' });

    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayname },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.json({ ok: true });
    }

    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      await invalidateSession(payload.userId, token.slice(-16));
    }

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: true });
  }
});

// Verify token
app.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token required' });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ valid: false, error: 'Invalid token' });
    }

    // Check session in Redis
    const sessionValid = await isSessionValid(payload.userId, token.slice(-16));
    if (!sessionValid) {
      return res.status(401).json({ valid: false, error: 'Session expired' });
    }

    // Get user data
    const result = await pool.query(
      'SELECT id, email, displayName, trustTier, isAdmin FROM users WHERE id = $1',
      [payload.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ valid: false, error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayname,
        trustTier: user.trusttier,
        isAdmin: user.isadmin
      }
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ valid: false, error: 'Verification failed' });
  }
});

// ============ OAUTH FLOWS (OPTIONAL) ============

// Check if Facebook OAuth is configured
const facebookEnabled = !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// Get available auth methods
app.get('/methods', (req, res) => {
  res.json({
    email: true,
    facebook: facebookEnabled,
    google: googleEnabled
  });
});

// Facebook OAuth - initiate
app.get('/oauth/facebook', (req, res) => {
  if (!facebookEnabled) {
    return res.status(404).json({ error: 'Facebook login not configured' });
  }

  const redirectUri = process.env.FACEBOOK_CALLBACK_URL;
  const state = crypto.randomBytes(16).toString('hex');

  // Store state in Redis for validation
  if (redis) {
    redis.setex(`oauth:state:${state}`, 600, 'facebook'); // 10 min expiry
  }

  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${process.env.FACEBOOK_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&scope=email,public_profile`;

  res.json({ authUrl, state });
});

// Facebook OAuth - callback
app.post('/oauth/facebook/callback', async (req, res) => {
  if (!facebookEnabled) {
    return res.status(404).json({ error: 'Facebook login not configured' });
  }

  try {
    const { code, state } = req.body;

    // Validate state
    if (redis) {
      const storedState = await redis.get(`oauth:state:${state}`);
      if (storedState !== 'facebook') {
        return res.status(400).json({ error: 'Invalid state' });
      }
      await redis.del(`oauth:state:${state}`);
    }

    // Exchange code for access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${process.env.FACEBOOK_APP_ID}` +
      `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(process.env.FACEBOOK_CALLBACK_URL)}` +
      `&code=${code}`;

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      return res.status(400).json({ error: 'Facebook auth failed' });
    }

    // Get user profile
    const profileRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${tokenData.access_token}`
    );
    const profile = await profileRes.json();

    if (!profile.id) {
      return res.status(400).json({ error: 'Failed to get profile' });
    }

    // Find or create user
    let user;
    const existing = await pool.query(
      'SELECT id, email, displayName FROM users WHERE facebookId = $1 OR (email IS NOT NULL AND LOWER(email) = LOWER($2))',
      [profile.id, profile.email || '']
    );

    if (existing.rows.length > 0) {
      user = existing.rows[0];
      // Update facebookId if not set
      await pool.query(
        'UPDATE users SET facebookId = $1, facebookVerified = true, updatedAt = NOW() WHERE id = $2',
        [profile.id, user.id]
      );
    } else {
      // Create new user
      const result = await pool.query(
        `INSERT INTO users (email, displayName, facebookId, facebookVerified, createdAt, updatedAt)
         VALUES ($1, $2, $3, true, NOW(), NOW())
         RETURNING id, email, displayName`,
        [profile.email?.toLowerCase() || null, profile.name, profile.id]
      );
      user = result.rows[0];
    }

    const token = generateToken({ userId: user.id, email: user.email });
    await storeSession(user.id, token, { authMethod: 'facebook' });

    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayname },
      token
    });
  } catch (err) {
    console.error('Facebook callback error:', err);
    res.status(500).json({ error: 'Facebook auth failed' });
  }
});

// Google OAuth - initiate
app.get('/oauth/google', (req, res) => {
  if (!googleEnabled) {
    return res.status(404).json({ error: 'Google login not configured' });
  }

  const redirectUri = process.env.GOOGLE_CALLBACK_URL || `${process.env.PUBLIC_BASE_URL}/auth/google/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  if (redis) {
    redis.setex(`oauth:state:${state}`, 600, 'google');
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=email%20profile` +
    `&state=${state}`;

  res.json({ authUrl, state });
});

// ============ PERMISSIONS ============

app.post('/permissions', async (req, res) => {
  try {
    const { userId, permission } = req.body;

    if (!userId) {
      return res.status(400).json({ allowed: false });
    }

    const result = await pool.query(
      'SELECT trustTier, isAdmin, isBuyerVerified, isSellerVerified FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ allowed: false });
    }

    const user = result.rows[0];
    const trustTier = user.trusttier || 0;
    const isAdmin = user.isadmin === true;

    // Permission checks
    const permissions = {
      'ADMIN': isAdmin,
      'VIEW_TOWN': trustTier >= 0,
      'VIEW_MARKET': trustTier >= 0,
      'BUY_MARKET': trustTier >= 1,
      'SELL_MARKET': trustTier >= 2 || user.issellerverified,
      'POST_CHANNEL': trustTier >= 1,
      'CREATE_LISTING': trustTier >= 2,
      'VIEW_ARCHIVE': trustTier >= 0
    };

    const allowed = permissions[permission] ?? false;
    res.json({ allowed, trustTier, isAdmin });
  } catch (err) {
    console.error('Permission check error:', err);
    res.status(500).json({ allowed: false });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
  console.log(`Facebook OAuth: ${facebookEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Google OAuth: ${googleEnabled ? 'enabled' : 'disabled'}`);
});
