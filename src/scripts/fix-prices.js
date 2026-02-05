const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : false
});

const updates = [
  { keyword: "Pumpkin Seeds 1 lb", price: 11.75 },
  { keyword: "Chia Seeds 5 lb", price: 44.00 },
  { keyword: "Sunflower Seeds 1 lb", price: 6.50 },
  { keyword: "Sunflower Seeds 5 lb", price: 26.00 },
  { keyword: "Pecans 1/4 lb", price: 9.50 },
  { keyword: "Pecans 1 lb", price: 29.75 },
  { keyword: "Peanuts Roasted 1 lb", price: 9.50 },
  { keyword: "Peanuts Roasted 5 lb", price: 38.00 },
  { keyword: "Oats Thick Rolled 2.2 lb", price: 7.25 },
  { keyword: "Jasmine Rice 2.2 lb", price: 11.00 },
  { keyword: "Black Rice Ancient 1 lb", price: 5.75 },
  { keyword: "Black Rice Ancient 5 lb", price: 23.75 },
  { keyword: "Black Turtle Beans 1 lb", price: 5.75 },
  { keyword: "French Lentils 1 lb", price: 8.00 },
  { keyword: "French Lentils 5 lb", price: 30.50 },
  { keyword: "Pinto Beans 1 lb", price: 6.50 },
  { keyword: "Pinto Beans 5 lb", price: 23.75 },
  { keyword: "Medjool Dates 1/4 lb", price: 5.00 },
  { keyword: "Ginger Lightly Dusted 1/4 lb", price: 5.00 },
  { keyword: "Himalayan Salt Pink 5 lb", price: 14.00 },
  { keyword: "Nutritional Yeast Flakes 1 lb", price: 24.50 },
  { keyword: "Baking Soda Food Grade 5 lb", price: 16.25 },
];

async function run() {
  const client = await pool.connect();
  try {
    console.log("Updating prices for placeid=18...\n");

    let totalUpdated = 0;

    for (const u of updates) {
      // Get current price
      const before = await client.query(
        `SELECT id, title, price FROM listings WHERE placeid = 18 AND title LIKE $1`,
        [`%${u.keyword}%`]
      );

      if (before.rows.length === 0) {
        console.log(`⚠️  No match for "${u.keyword}"`);
        continue;
      }

      // Update
      const result = await client.query(
        `UPDATE listings SET price = $1 WHERE placeid = 18 AND title LIKE $2`,
        [u.price, `%${u.keyword}%`]
      );

      for (const row of before.rows) {
        console.log(`✓ "${row.title}" | $${row.price} → $${u.price}`);
      }

      totalUpdated += result.rowCount;
    }

    console.log(`\nDone. Updated ${totalUpdated} rows total.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
