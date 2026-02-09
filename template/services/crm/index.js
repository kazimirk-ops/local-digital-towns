/**
 * CRM Service - Customer Relationship Management
 *
 * This private service handles:
 * - HubSpot CRM integration
 * - Lead management
 * - Contact synchronization
 * - Business contact management
 *
 * Runs on internal network only (port 3001)
 */

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Redis connection (optional)
let redis = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
  redis.on('error', (err) => console.error('Redis error:', err.message));
}

// Check if HubSpot is configured
const hubspotEnabled = !!(HUBSPOT_API_KEY);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'crm-service',
    hubspot: hubspotEnabled ? 'enabled' : 'disabled'
  });
});

// ============ HUBSPOT API UTILITIES ============

async function hubspotRequest(endpoint, method = 'GET', body = null) {
  if (!hubspotEnabled) {
    throw new Error('HubSpot not configured');
  }

  const url = `https://api.hubapi.com${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'HubSpot API error');
  }

  return data;
}

// ============ CONTACT MANAGEMENT ============

// Sync user to HubSpot as contact
app.post('/contacts/sync', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    // Get user from database
    const result = await pool.query(
      `SELECT id, email, displayName, phone, createdAt, trustTier,
              isBuyerVerified, isSellerVerified
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    if (!hubspotEnabled) {
      // Just log locally if HubSpot not configured
      console.log('CRM sync (local):', { userId, email: user.email });
      return res.json({ synced: false, reason: 'HubSpot not configured', userId });
    }

    // Create or update contact in HubSpot
    const contactData = {
      properties: {
        email: user.email,
        firstname: user.displayname?.split(' ')[0] || '',
        lastname: user.displayname?.split(' ').slice(1).join(' ') || '',
        phone: user.phone || '',
        digital_towns_user_id: String(user.id),
        digital_towns_trust_tier: String(user.trusttier || 0),
        digital_towns_buyer_verified: user.isbuyerverified ? 'true' : 'false',
        digital_towns_seller_verified: user.issellerverified ? 'true' : 'false',
        lifecyclestage: user.issellerverified ? 'customer' : 'lead'
      }
    };

    // Search for existing contact
    const searchResult = await hubspotRequest('/crm/v3/objects/contacts/search', 'POST', {
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: 'EQ',
          value: user.email
        }]
      }]
    });

    let hubspotContactId;
    if (searchResult.total > 0) {
      // Update existing contact
      hubspotContactId = searchResult.results[0].id;
      await hubspotRequest(`/crm/v3/objects/contacts/${hubspotContactId}`, 'PATCH', contactData);
    } else {
      // Create new contact
      const createResult = await hubspotRequest('/crm/v3/objects/contacts', 'POST', contactData);
      hubspotContactId = createResult.id;
    }

    // Store HubSpot ID in our database
    await pool.query(
      'UPDATE users SET hubspotContactId = $1, updatedAt = NOW() WHERE id = $2',
      [hubspotContactId, userId]
    );

    res.json({ synced: true, hubspotContactId, userId });
  } catch (err) {
    console.error('Contact sync error:', err);
    res.status(500).json({ error: 'Sync failed', message: err.message });
  }
});

// Get contact from HubSpot
app.get('/contacts/:userId', async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    // Get user's HubSpot ID from database
    const result = await pool.query(
      'SELECT hubspotContactId FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hubspotContactId = result.rows[0].hubspotcontactid;

    if (!hubspotContactId || !hubspotEnabled) {
      return res.json({ contact: null, synced: false });
    }

    const contact = await hubspotRequest(`/crm/v3/objects/contacts/${hubspotContactId}`);
    res.json({ contact, synced: true });
  } catch (err) {
    console.error('Get contact error:', err);
    res.status(500).json({ error: 'Failed to get contact' });
  }
});

// ============ BUSINESS/DEAL MANAGEMENT ============

// Sync business as company + deal in HubSpot
app.post('/businesses/sync', async (req, res) => {
  try {
    const { placeId } = req.body;

    if (!placeId) {
      return res.status(400).json({ error: 'placeId required' });
    }

    // Get place from database
    const result = await pool.query(
      `SELECT p.id, p.name, p.category, p.description, p.ownerUserId,
              p.status, p.createdAt, u.email as ownerEmail
       FROM places p
       LEFT JOIN users u ON u.id = p.ownerUserId
       WHERE p.id = $1`,
      [placeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const place = result.rows[0];

    if (!hubspotEnabled) {
      console.log('CRM business sync (local):', { placeId, name: place.name });
      return res.json({ synced: false, reason: 'HubSpot not configured', placeId });
    }

    // Create or update company in HubSpot
    const companyData = {
      properties: {
        name: place.name,
        description: place.description || '',
        industry: place.category || 'Local Business',
        digital_towns_place_id: String(place.id),
        digital_towns_status: place.status || 'pending'
      }
    };

    // Search for existing company
    const searchResult = await hubspotRequest('/crm/v3/objects/companies/search', 'POST', {
      filterGroups: [{
        filters: [{
          propertyName: 'digital_towns_place_id',
          operator: 'EQ',
          value: String(place.id)
        }]
      }]
    });

    let hubspotCompanyId;
    if (searchResult.total > 0) {
      hubspotCompanyId = searchResult.results[0].id;
      await hubspotRequest(`/crm/v3/objects/companies/${hubspotCompanyId}`, 'PATCH', companyData);
    } else {
      const createResult = await hubspotRequest('/crm/v3/objects/companies', 'POST', companyData);
      hubspotCompanyId = createResult.id;
    }

    // Store HubSpot company ID
    await pool.query(
      'UPDATE places SET hubspotCompanyId = $1, updatedAt = NOW() WHERE id = $2',
      [hubspotCompanyId, placeId]
    );

    res.json({ synced: true, hubspotCompanyId, placeId });
  } catch (err) {
    console.error('Business sync error:', err);
    res.status(500).json({ error: 'Sync failed', message: err.message });
  }
});

// ============ LEAD TRACKING ============

// Track a lead event
app.post('/leads/event', async (req, res) => {
  try {
    const { userId, eventType, metadata } = req.body;

    // Log to local database
    await pool.query(
      `INSERT INTO crm_events (userId, eventType, metadata, createdAt)
       VALUES ($1, $2, $3, NOW())`,
      [userId || null, eventType, JSON.stringify(metadata || {})]
    );

    // Queue for HubSpot sync
    if (redis && hubspotEnabled) {
      await redis.lpush('crm:events', JSON.stringify({
        userId,
        eventType,
        metadata,
        timestamp: new Date().toISOString()
      }));
    }

    res.json({ tracked: true });
  } catch (err) {
    console.error('Lead event error:', err);
    res.status(500).json({ error: 'Failed to track event' });
  }
});

// Get lead score for user
app.get('/leads/:userId/score', async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    // Calculate score based on activity
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE buyerUserId = $1) as orders,
        (SELECT COUNT(*) FROM reviews WHERE reviewerUserId = $1) as reviews,
        (SELECT COUNT(*) FROM channel_messages WHERE userId = $1) as messages,
        (SELECT COUNT(*) FROM listings WHERE ownerUserId = $1) as listings
    `, [userId]);

    const stats = result.rows[0];
    const score = (
      (Number(stats.orders) * 10) +
      (Number(stats.reviews) * 5) +
      (Number(stats.messages) * 1) +
      (Number(stats.listings) * 15)
    );

    res.json({
      userId,
      score,
      breakdown: {
        orders: Number(stats.orders),
        reviews: Number(stats.reviews),
        messages: Number(stats.messages),
        listings: Number(stats.listings)
      }
    });
  } catch (err) {
    console.error('Lead score error:', err);
    res.status(500).json({ error: 'Failed to calculate score' });
  }
});

// ============ BULK SYNC ============

// Queue all users for sync
app.post('/sync/all-contacts', async (req, res) => {
  try {
    if (!redis) {
      return res.status(400).json({ error: 'Redis required for bulk sync' });
    }

    const result = await pool.query('SELECT id FROM users WHERE email IS NOT NULL');
    const userIds = result.rows.map(r => r.id);

    for (const userId of userIds) {
      await redis.lpush('crm:sync:contacts', String(userId));
    }

    res.json({ queued: userIds.length });
  } catch (err) {
    console.error('Bulk sync error:', err);
    res.status(500).json({ error: 'Failed to queue sync' });
  }
});

// Queue all businesses for sync
app.post('/sync/all-businesses', async (req, res) => {
  try {
    if (!redis) {
      return res.status(400).json({ error: 'Redis required for bulk sync' });
    }

    const result = await pool.query('SELECT id FROM places');
    const placeIds = result.rows.map(r => r.id);

    for (const placeId of placeIds) {
      await redis.lpush('crm:sync:businesses', String(placeId));
    }

    res.json({ queued: placeIds.length });
  } catch (err) {
    console.error('Bulk sync error:', err);
    res.status(500).json({ error: 'Failed to queue sync' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`CRM service running on port ${PORT}`);
  console.log(`HubSpot integration: ${hubspotEnabled ? 'enabled' : 'disabled'}`);
});
