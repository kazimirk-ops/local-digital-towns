/**
 * Sync Worker - CRM and Third-Party Integration Sync
 *
 * This worker handles:
 * - Processing sync queue from Redis
 * - CRM contact/company sync
 * - Data enrichment
 * - Third-party integration webhooks
 * - Scheduled sync jobs
 */

require('dotenv').config();
const Redis = require('ioredis');
const { Pool } = require('pg');
const cron = require('node-cron');

// Configuration
const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://crm-service:3001';
const POLL_INTERVAL = parseInt(process.env.SYNC_POLL_INTERVAL || '5000');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Redis connection
let redis = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
  redis.on('error', (err) => console.error('Redis error:', err.message));
  redis.on('connect', () => console.log('Redis connected'));
}

console.log('Sync Worker Starting...');
console.log(`CRM Service: ${CRM_SERVICE_URL}`);
console.log(`Redis: ${redis ? 'connected' : 'not configured'}`);

// ============ CRM SYNC ============

async function syncContactToCRM(userId) {
  try {
    const response = await fetch(`${CRM_SERVICE_URL}/contacts/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });

    const result = await response.json();
    console.log(`Contact sync: user ${userId}`, result.synced ? 'success' : 'skipped');
    return result;
  } catch (err) {
    console.error(`Contact sync error: user ${userId}`, err.message);
    return { synced: false, error: err.message };
  }
}

async function syncBusinessToCRM(placeId) {
  try {
    const response = await fetch(`${CRM_SERVICE_URL}/businesses/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId })
    });

    const result = await response.json();
    console.log(`Business sync: place ${placeId}`, result.synced ? 'success' : 'skipped');
    return result;
  } catch (err) {
    console.error(`Business sync error: place ${placeId}`, err.message);
    return { synced: false, error: err.message };
  }
}

// ============ QUEUE PROCESSING ============

async function processContactSyncQueue() {
  if (!redis) return;

  try {
    const userId = await redis.rpop('crm:sync:contacts');
    if (userId) {
      await syncContactToCRM(Number(userId));
    }
  } catch (err) {
    console.error('Contact sync queue error:', err);
  }
}

async function processBusinessSyncQueue() {
  if (!redis) return;

  try {
    const placeId = await redis.rpop('crm:sync:businesses');
    if (placeId) {
      await syncBusinessToCRM(Number(placeId));
    }
  } catch (err) {
    console.error('Business sync queue error:', err);
  }
}

async function processEventQueue() {
  if (!redis) return;

  try {
    const eventData = await redis.rpop('crm:events');
    if (eventData) {
      const event = JSON.parse(eventData);
      await processEvent(event);
    }
  } catch (err) {
    console.error('Event queue error:', err);
  }
}

async function processEvent(event) {
  const { userId, eventType, metadata } = event;

  console.log(`Processing event: ${eventType}`, { userId, metadata });

  // Handle different event types
  switch (eventType) {
    case 'user_signup':
      await syncContactToCRM(userId);
      break;

    case 'order_completed':
      // Sync both buyer and seller
      if (metadata?.buyerUserId) {
        await syncContactToCRM(metadata.buyerUserId);
      }
      if (metadata?.sellerUserId) {
        await syncContactToCRM(metadata.sellerUserId);
      }
      break;

    case 'business_created':
      if (metadata?.placeId) {
        await syncBusinessToCRM(metadata.placeId);
      }
      break;

    case 'subscription_started':
      if (metadata?.placeId) {
        await syncBusinessToCRM(metadata.placeId);
      }
      break;

    default:
      console.log(`Unhandled event type: ${eventType}`);
  }
}

// ============ SCHEDULED SYNC JOBS ============

// Sync all contacts every 6 hours
cron.schedule('0 */6 * * *', async () => {
  console.log('Starting scheduled contact sync...');

  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE updatedAt > NOW() - INTERVAL \'6 hours\''
    );

    for (const row of result.rows) {
      if (redis) {
        await redis.lpush('crm:sync:contacts', String(row.id));
      } else {
        await syncContactToCRM(row.id);
      }
    }

    console.log(`Queued ${result.rows.length} contacts for sync`);
  } catch (err) {
    console.error('Scheduled contact sync error:', err);
  }
});

// Sync all businesses daily at 3 AM
cron.schedule('0 3 * * *', async () => {
  console.log('Starting scheduled business sync...');

  try {
    const result = await pool.query(
      'SELECT id FROM places WHERE updatedAt > NOW() - INTERVAL \'24 hours\''
    );

    for (const row of result.rows) {
      if (redis) {
        await redis.lpush('crm:sync:businesses', String(row.id));
      } else {
        await syncBusinessToCRM(row.id);
      }
    }

    console.log(`Queued ${result.rows.length} businesses for sync`);
  } catch (err) {
    console.error('Scheduled business sync error:', err);
  }
});

// ============ MAIN POLL LOOP ============

async function pollQueues() {
  await Promise.all([
    processContactSyncQueue(),
    processBusinessSyncQueue(),
    processEventQueue()
  ]);

  // Continue polling
  setTimeout(pollQueues, POLL_INTERVAL);
}

// ============ SIMPLE API ============

const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'sync-worker',
    redis: !!redis
  });
});

// Manual sync triggers
app.post('/sync/contact/:userId', async (req, res) => {
  const result = await syncContactToCRM(Number(req.params.userId));
  res.json(result);
});

app.post('/sync/business/:placeId', async (req, res) => {
  const result = await syncBusinessToCRM(Number(req.params.placeId));
  res.json(result);
});

// Queue status
app.get('/queue/status', async (req, res) => {
  if (!redis) {
    return res.json({ error: 'Redis not configured' });
  }

  const contacts = await redis.llen('crm:sync:contacts');
  const businesses = await redis.llen('crm:sync:businesses');
  const events = await redis.llen('crm:events');

  res.json({ contacts, businesses, events });
});

// ============ START ============

const PORT = process.env.PORT || 3004;

app.listen(PORT, () => {
  console.log(`Sync worker API running on port ${PORT}`);
});

// Start queue polling
if (redis) {
  console.log('Starting queue polling...');
  pollQueues();
} else {
  console.log('Redis not configured - scheduled jobs only');
}

console.log('Sync worker ready');
