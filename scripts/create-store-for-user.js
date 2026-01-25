const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const userId = 11;

    const user = await pool.query('SELECT id, displayname, email FROM users WHERE id = $1', [userId]);
    if (!user.rows[0]) {
      console.log('User not found');
      return;
    }
    const u = user.rows[0];
    console.log('Creating store for user:', u.email, 'name:', u.displayname);

    const existing = await pool.query('SELECT id FROM places WHERE owneruserid = $1', [userId]);
    if (existing.rows.length > 0) {
      console.log('Store already exists:', existing.rows[0].id);
      return;
    }

    const result = await pool.query(
      `INSERT INTO places (name, owneruserid, sellertype, category, status, townid, districtid, isfeatured)
       VALUES ($1, $2, 'individual', '', 'approved', 1, 1, 0) RETURNING id`,
      [u.displayname || 'My Store', userId]
    );
    console.log('Created store id:', result.rows[0].id);

    const sub = await pool.query('SELECT * FROM user_subscriptions WHERE userid = $1', [userId]);
    if (sub.rows[0]) {
      const s = sub.rows[0];
      await pool.query(
        `INSERT INTO business_subscriptions
         (placeid, userid, plan, status, stripecustomerid, stripesubscriptionid, currentperiodstart, currentperiodend, createdat, updatedat)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, NOW(), NOW())`,
        [result.rows[0].id, userId, 'user', s.status, s.stripecustomerid, s.stripesubscriptionid, s.currentperiodend]
      );
      console.log('Created business_subscriptions link');
    }
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
}

main();
