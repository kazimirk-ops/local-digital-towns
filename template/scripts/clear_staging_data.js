/**
 * Clear all user data from staging database
 * Run with: DATABASE_URL="..." node scripts/clear_staging_data.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

console.log('Connecting to database...');
console.log('Host:', DATABASE_URL.split('@')[1]?.split('/')[0] || 'local');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }  // Required for Render databases
});

// Tables ordered to avoid foreign key violations (dependencies first)
const TABLES_TO_CLEAR = [
  // Dependent tables first (reference other tables)
  'sweep_award_events',
  'sweep_draws',
  'sweepstake_entries',
  'sweep_ledger',
  'prize_awards',
  'prize_offers',
  'event_rsvps',
  'live_show_bookmarks',
  'live_show_schedule',
  'live_rooms',
  'social_shares',
  'store_follows',
  'media_objects',
  'channel_messages',
  'channel_memberships',
  'channel_mutes',
  'channel_requests',
  'message_threads',
  'direct_messages',
  'direct_conversations',
  'messages',
  'conversations',
  'ghost_reports',
  'giveaway_offers',
  'reviews',
  'disputes',
  'trust_events',
  'trust_applications',
  'town_memberships',
  'payments',
  'order_items',
  'bids',
  'cart_items',
  'orders',
  'business_subscriptions',
  'listings',
  'places',
  'support_requests',
  'resident_verification_requests',
  'local_business_applications',
  'resident_applications',
  'business_applications',
  'waitlist_signups',
  'signups',
  'magic_links',
  'auth_codes',
  'sessions',

  // Admin content
  'pulse_exports',
  'daily_pulses',
  'archive_entries',
  'events_v1',
  'events',
  'sweepstakes',

  // Users last (most things reference this)
  'users',
];

async function clearData() {
  const client = await pool.connect();

  try {
    console.log('\n========================================');
    console.log('CLEARING STAGING DATABASE');
    console.log('========================================\n');

    let totalDeleted = 0;

    for (const table of TABLES_TO_CLEAR) {
      try {
        // Get row count before
        const countResult = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
        const count = parseInt(countResult.rows[0].count);

        if (count > 0) {
          // Delete all rows
          await client.query(`DELETE FROM ${table}`);

          // Reset sequence if table has one
          try {
            await client.query(`ALTER SEQUENCE ${table}_id_seq RESTART WITH 1`);
            console.log(`✓ ${table}: ${count} rows deleted, sequence reset`);
          } catch (seqErr) {
            console.log(`✓ ${table}: ${count} rows deleted (no sequence)`);
          }
          totalDeleted += count;
        } else {
          console.log(`- ${table}: already empty`);
        }
      } catch (err) {
        if (err.message.includes('does not exist')) {
          console.log(`- ${table}: table does not exist (skipped)`);
        } else if (err.message.includes('violates foreign key')) {
          console.error(`✗ ${table}: foreign key violation - ${err.detail || err.message}`);
        } else {
          console.error(`✗ ${table}: ${err.message}`);
        }
      }
    }

    console.log('\n========================================');
    console.log('VERIFICATION');
    console.log('========================================\n');

    // Verify key tables are empty
    const verifyTables = ['users', 'orders', 'listings', 'places', 'giveaway_offers'];
    for (const table of verifyTables) {
      try {
        const result = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`${table}: ${result.rows[0].count} rows`);
      } catch (err) {
        console.log(`${table}: error checking`);
      }
    }

    // Verify config tables preserved
    console.log('\nConfig tables preserved:');
    const configTables = ['towns', 'districts', 'channels', 'sweep_rules'];
    for (const table of configTables) {
      try {
        const result = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`${table}: ${result.rows[0].count} rows`);
      } catch (err) {
        console.log(`${table}: error checking`);
      }
    }

    console.log('\n========================================');
    console.log(`DATABASE CLEARED: ${totalDeleted} total rows deleted`);
    console.log('========================================\n');

  } finally {
    client.release();
    await pool.end();
  }
}

clearData().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
