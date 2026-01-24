/**
 * Analytics Worker - Event Processing and Aggregation
 *
 * This worker handles:
 * - Processing analytics events from Redis
 * - Daily/weekly/monthly aggregations
 * - Report generation
 * - Metrics computation
 * - Data cleanup
 */

require('dotenv').config();
const Redis = require('ioredis');
const { Pool } = require('pg');
const cron = require('node-cron');

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

console.log('Analytics Worker Starting...');
console.log(`Redis: ${redis ? 'connected' : 'not configured'}`);

// ============ EVENT PROCESSING ============

async function processAnalyticsEvent(event) {
  const { eventType, userId, metadata, timestamp } = event;

  try {
    // Store in events table
    await pool.query(
      `INSERT INTO events (type, userId, meta, createdAt)
       VALUES ($1, $2, $3, $4)`,
      [eventType, userId || null, JSON.stringify(metadata || {}), timestamp || new Date().toISOString()]
    );

    // Update real-time counters in Redis
    if (redis) {
      const today = new Date().toISOString().split('T')[0];
      const counterKey = `analytics:${today}:${eventType}`;
      await redis.incr(counterKey);
      await redis.expire(counterKey, 7 * 24 * 60 * 60); // 7 days

      // User activity tracking
      if (userId) {
        await redis.sadd(`analytics:${today}:active_users`, String(userId));
        await redis.expire(`analytics:${today}:active_users`, 7 * 24 * 60 * 60);
      }
    }
  } catch (err) {
    console.error('Event processing error:', err);
  }
}

async function processEventQueue() {
  if (!redis) return;

  try {
    const eventData = await redis.rpop('analytics:events');
    if (eventData) {
      const event = JSON.parse(eventData);
      await processAnalyticsEvent(event);
    }
  } catch (err) {
    console.error('Event queue error:', err);
  }
}

// ============ DAILY AGGREGATION ============

async function generateDailyReport(date = null) {
  const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`Generating daily report for ${targetDate}...`);

  try {
    // Get event counts
    const eventCounts = await pool.query(`
      SELECT type, COUNT(*) as count
      FROM events
      WHERE DATE(createdAt) = $1
      GROUP BY type
    `, [targetDate]);

    // Get user stats
    const userStats = await pool.query(`
      SELECT
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE DATE(createdAt) = $1) as new_users
      FROM users
    `, [targetDate]);

    // Get order stats
    const orderStats = await pool.query(`
      SELECT
        COUNT(*) as order_count,
        COALESCE(SUM(totalCents), 0) as total_revenue
      FROM orders
      WHERE DATE(createdAt) = $1 AND status = 'paid'
    `, [targetDate]);

    // Get listing stats
    const listingStats = await pool.query(`
      SELECT COUNT(*) as new_listings
      FROM listings
      WHERE DATE(createdAt) = $1
    `, [targetDate]);

    // Get message stats
    const messageStats = await pool.query(`
      SELECT COUNT(*) as message_count
      FROM channel_messages
      WHERE DATE(createdAt) = $1
    `, [targetDate]);

    // Get active users from Redis
    let activeUsers = 0;
    if (redis) {
      activeUsers = await redis.scard(`analytics:${targetDate}:active_users`);
    }

    const report = {
      date: targetDate,
      events: Object.fromEntries(eventCounts.rows.map(r => [r.type, Number(r.count)])),
      users: {
        total: Number(userStats.rows[0]?.total_users || 0),
        new: Number(userStats.rows[0]?.new_users || 0),
        active: activeUsers
      },
      orders: {
        count: Number(orderStats.rows[0]?.order_count || 0),
        revenue: Number(orderStats.rows[0]?.total_revenue || 0)
      },
      listings: {
        new: Number(listingStats.rows[0]?.new_listings || 0)
      },
      messages: {
        count: Number(messageStats.rows[0]?.message_count || 0)
      },
      generatedAt: new Date().toISOString()
    };

    // Store report
    await pool.query(`
      INSERT INTO analytics_reports (reportType, reportDate, data, createdAt)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (reportType, reportDate) DO UPDATE
      SET data = $3, createdAt = NOW()
    `, ['daily', targetDate, JSON.stringify(report)]);

    console.log(`Daily report generated:`, report);
    return report;
  } catch (err) {
    console.error('Daily report error:', err);
    throw err;
  }
}

// ============ WEEKLY AGGREGATION ============

async function generateWeeklyReport() {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekKey = `${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}`;

  console.log(`Generating weekly report for ${weekKey}...`);

  try {
    // Aggregate daily reports
    const dailyReports = await pool.query(`
      SELECT data
      FROM analytics_reports
      WHERE reportType = 'daily'
        AND reportDate >= $1
        AND reportDate <= $2
    `, [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]);

    const aggregated = {
      period: weekKey,
      totalOrders: 0,
      totalRevenue: 0,
      totalNewUsers: 0,
      totalMessages: 0,
      totalNewListings: 0,
      avgActiveUsers: 0,
      dailyBreakdown: []
    };

    let activeUserSum = 0;
    for (const row of dailyReports.rows) {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      aggregated.totalOrders += data.orders?.count || 0;
      aggregated.totalRevenue += data.orders?.revenue || 0;
      aggregated.totalNewUsers += data.users?.new || 0;
      aggregated.totalMessages += data.messages?.count || 0;
      aggregated.totalNewListings += data.listings?.new || 0;
      activeUserSum += data.users?.active || 0;
      aggregated.dailyBreakdown.push({
        date: data.date,
        orders: data.orders?.count || 0,
        revenue: data.orders?.revenue || 0
      });
    }

    if (dailyReports.rows.length > 0) {
      aggregated.avgActiveUsers = Math.round(activeUserSum / dailyReports.rows.length);
    }

    // Store weekly report
    await pool.query(`
      INSERT INTO analytics_reports (reportType, reportDate, data, createdAt)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (reportType, reportDate) DO UPDATE
      SET data = $3, createdAt = NOW()
    `, ['weekly', weekKey, JSON.stringify(aggregated)]);

    console.log(`Weekly report generated`);
    return aggregated;
  } catch (err) {
    console.error('Weekly report error:', err);
    throw err;
  }
}

// ============ DATA CLEANUP ============

async function cleanupOldData() {
  console.log('Running data cleanup...');

  try {
    // Delete events older than 90 days
    const eventsDeleted = await pool.query(`
      DELETE FROM events
      WHERE createdAt < NOW() - INTERVAL '90 days'
    `);
    console.log(`Deleted ${eventsDeleted.rowCount} old events`);

    // Delete old daily reports (keep 90 days)
    const reportsDeleted = await pool.query(`
      DELETE FROM analytics_reports
      WHERE reportType = 'daily' AND createdAt < NOW() - INTERVAL '90 days'
    `);
    console.log(`Deleted ${reportsDeleted.rowCount} old daily reports`);

    // Clean up Redis counters
    if (redis) {
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const keys = await redis.keys(`analytics:${oldDate}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`Deleted ${keys.length} old Redis keys`);
      }
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

// ============ SCHEDULED JOBS ============

// Generate daily report at 1 AM
cron.schedule('0 1 * * *', async () => {
  await generateDailyReport();
});

// Generate weekly report on Sundays at 2 AM
cron.schedule('0 2 * * 0', async () => {
  await generateWeeklyReport();
});

// Run cleanup daily at 4 AM
cron.schedule('0 4 * * *', async () => {
  await cleanupOldData();
});

// ============ MAIN POLL LOOP ============

async function pollQueue() {
  await processEventQueue();
  setTimeout(pollQueue, 1000);
}

// ============ SIMPLE API ============

const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'analytics-worker',
    redis: !!redis
  });
});

// Get today's stats
app.get('/stats/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    let stats = {};
    if (redis) {
      const keys = await redis.keys(`analytics:${today}:*`);
      for (const key of keys) {
        const type = await redis.type(key);
        if (type === 'string') {
          stats[key.replace(`analytics:${today}:`, '')] = await redis.get(key);
        } else if (type === 'set') {
          stats[key.replace(`analytics:${today}:`, '')] = await redis.scard(key);
        }
      }
    }

    res.json({ date: today, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get report
app.get('/reports/:type/:date', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT data FROM analytics_reports
      WHERE reportType = $1 AND reportDate = $2
    `, [req.params.type, req.params.date]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(result.rows[0].data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger report generation
app.post('/reports/generate/:type', async (req, res) => {
  try {
    if (req.params.type === 'daily') {
      const report = await generateDailyReport(req.body.date);
      res.json(report);
    } else if (req.params.type === 'weekly') {
      const report = await generateWeeklyReport();
      res.json(report);
    } else {
      res.status(400).json({ error: 'Invalid report type' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Queue status
app.get('/queue/status', async (req, res) => {
  if (!redis) {
    return res.json({ error: 'Redis not configured' });
  }

  const pending = await redis.llen('analytics:events');
  res.json({ pending });
});

// ============ START ============

const PORT = process.env.PORT || 3005;

app.listen(PORT, () => {
  console.log(`Analytics worker API running on port ${PORT}`);
});

// Start queue polling
if (redis) {
  console.log('Starting queue polling...');
  pollQueue();
}

console.log('Analytics worker ready');
