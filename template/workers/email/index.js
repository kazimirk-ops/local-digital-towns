/**
 * Email Worker - Transactional Email Processing
 *
 * This worker handles:
 * - Processing email queue from Redis
 * - Sending transactional emails via SMTP
 * - Email templates
 * - Retry logic with exponential backoff
 * - Email logging
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const Redis = require('ioredis');
const { Pool } = require('pg');

// Configuration
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@digitaltowns.com';
const POLL_INTERVAL = parseInt(process.env.EMAIL_POLL_INTERVAL || '5000');
const MAX_RETRIES = 3;

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

// SMTP transporter
let transporter = null;
const smtpEnabled = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

if (smtpEnabled) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

console.log('Email Worker Starting...');
console.log(`SMTP: ${smtpEnabled ? 'enabled' : 'disabled (emails will be logged only)'}`);
console.log(`Redis: ${redis ? 'connected' : 'not configured'}`);

// ============ EMAIL TEMPLATES ============

const templates = {
  welcome: {
    subject: 'Welcome to Digital Towns!',
    html: (data) => `
      <h1>Welcome to Digital Towns, ${data.name || 'friend'}!</h1>
      <p>Thank you for joining our community. We're excited to have you!</p>
      <p>Get started by exploring local businesses and connecting with your neighbors.</p>
      <p><a href="${data.baseUrl}/ui">Explore Your Town</a></p>
    `
  },

  order_confirmation: {
    subject: 'Order Confirmation - #{orderId}',
    html: (data) => `
      <h1>Order Confirmed!</h1>
      <p>Thank you for your order #${data.orderId}.</p>
      <p><strong>Total:</strong> $${(data.totalCents / 100).toFixed(2)}</p>
      <p><strong>Store:</strong> ${data.storeName}</p>
      <hr>
      <p>Please contact the seller directly to arrange pickup or delivery.</p>
      <p><a href="${data.baseUrl}/orders/${data.orderId}">View Order Details</a></p>
    `
  },

  payment_received: {
    subject: 'Payment Received - Order #{orderId}',
    html: (data) => `
      <h1>Payment Received!</h1>
      <p>We've received your payment for order #${data.orderId}.</p>
      <p><strong>Amount:</strong> $${(data.amountCents / 100).toFixed(2)}</p>
      <p>The seller has been notified and will be in touch soon.</p>
    `
  },

  new_order_seller: {
    subject: 'New Order Received - #{orderId}',
    html: (data) => `
      <h1>You Have a New Order!</h1>
      <p>Order #${data.orderId} has been placed at your store.</p>
      <p><strong>Buyer:</strong> ${data.buyerName || 'A customer'}</p>
      <p><strong>Total:</strong> $${(data.totalCents / 100).toFixed(2)}</p>
      <hr>
      <p>Please contact the buyer to arrange fulfillment.</p>
      <p><a href="${data.baseUrl}/seller/orders">View Order</a></p>
    `
  },

  giveaway_approved: {
    subject: 'Your Giveaway Offer Has Been Approved!',
    html: (data) => `
      <h1>Great News!</h1>
      <p>Your giveaway offer "${data.title}" has been approved!</p>
      <p>Your store will be featured on our homepage during the giveaway period.</p>
      ${data.startsAt ? `<p><strong>Start Date:</strong> ${new Date(data.startsAt).toLocaleDateString()}</p>` : ''}
      ${data.endsAt ? `<p><strong>End Date:</strong> ${new Date(data.endsAt).toLocaleDateString()}</p>` : ''}
      <p>As a thank you, you've also earned one FREE month on your subscription!</p>
    `
  },

  password_reset: {
    subject: 'Password Reset Request',
    html: (data) => `
      <h1>Password Reset</h1>
      <p>You requested a password reset for your Digital Towns account.</p>
      <p><a href="${data.resetUrl}">Reset Your Password</a></p>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `
  },

  auth_code: {
    subject: 'Your Login Code',
    html: (data) => `
      <h1>Your Login Code</h1>
      <p>Your verification code is:</p>
      <h2 style="font-size: 32px; letter-spacing: 8px; font-family: monospace;">${data.code}</h2>
      <p>This code expires in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `
  }
};

// ============ EMAIL SENDING ============

async function sendEmail(to, template, data) {
  const emailTemplate = templates[template];
  if (!emailTemplate) {
    throw new Error(`Unknown template: ${template}`);
  }

  const subject = emailTemplate.subject.replace(/\{(\w+)\}/g, (_, key) => data[key] || '');
  const html = emailTemplate.html(data);

  const mailOptions = {
    from: EMAIL_FROM,
    to,
    subject,
    html
  };

  if (!smtpEnabled) {
    console.log('Email (not sent - SMTP disabled):', { to, subject });
    return { sent: false, logged: true };
  }

  try {
    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent:', { to, subject, messageId: result.messageId });
    return { sent: true, messageId: result.messageId };
  } catch (err) {
    console.error('Email send error:', err);
    throw err;
  }
}

// ============ QUEUE PROCESSING ============

async function processEmailJob(job) {
  const { to, template, data, retries = 0 } = job;

  try {
    await sendEmail(to, template, data);

    // Log success to database
    await pool.query(
      `INSERT INTO email_logs (recipient, template, status, sentAt)
       VALUES ($1, $2, $3, NOW())`,
      [to, template, 'sent']
    ).catch(() => {}); // Ignore if table doesn't exist

    return { success: true };
  } catch (err) {
    if (retries < MAX_RETRIES) {
      // Re-queue with exponential backoff
      const delay = Math.pow(2, retries) * 1000;
      console.log(`Retrying email in ${delay}ms (attempt ${retries + 1}/${MAX_RETRIES})`);

      setTimeout(async () => {
        if (redis) {
          await redis.lpush('email:queue', JSON.stringify({
            ...job,
            retries: retries + 1
          }));
        }
      }, delay);
    } else {
      console.error(`Email failed after ${MAX_RETRIES} retries:`, to, template);

      // Log failure
      await pool.query(
        `INSERT INTO email_logs (recipient, template, status, error, sentAt)
         VALUES ($1, $2, $3, $4, NOW())`,
        [to, template, 'failed', err.message]
      ).catch(() => {});
    }

    return { success: false, error: err.message };
  }
}

async function pollQueue() {
  if (!redis) {
    console.log('No Redis - queue polling disabled');
    return;
  }

  try {
    // Blocking pop with 5 second timeout
    const result = await redis.brpop('email:queue', 5);

    if (result) {
      const [, jobData] = result;
      const job = JSON.parse(jobData);
      await processEmailJob(job);
    }
  } catch (err) {
    console.error('Queue poll error:', err);
  }

  // Continue polling
  setImmediate(pollQueue);
}

// ============ API FOR DIRECT SENDS ============

// Simple HTTP server for internal API calls
const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'email-worker',
    smtp: smtpEnabled,
    redis: !!redis
  });
});

// Queue an email
app.post('/queue', async (req, res) => {
  try {
    const { to, template, data } = req.body;

    if (!to || !template) {
      return res.status(400).json({ error: 'to and template required' });
    }

    if (redis) {
      await redis.lpush('email:queue', JSON.stringify({ to, template, data }));
      res.json({ queued: true });
    } else {
      // Send immediately if no Redis
      const result = await processEmailJob({ to, template, data });
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send email immediately (bypasses queue)
app.post('/send', async (req, res) => {
  try {
    const { to, template, data } = req.body;

    if (!to || !template) {
      return res.status(400).json({ error: 'to and template required' });
    }

    const result = await sendEmail(to, template, data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ START ============

const PORT = process.env.PORT || 3003;

app.listen(PORT, () => {
  console.log(`Email worker API running on port ${PORT}`);
});

// Start queue polling
if (redis) {
  console.log('Starting queue polling...');
  pollQueue();
} else {
  console.log('Redis not configured - running in direct-send mode only');
}

// Verify SMTP connection
if (transporter) {
  transporter.verify((err) => {
    if (err) {
      console.error('SMTP verification failed:', err.message);
    } else {
      console.log('SMTP connection verified');
    }
  });
}
