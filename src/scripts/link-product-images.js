const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : false
});

const mappings = [
  { keyword: "Walnut", image: "organic-walnuts.jpg" },
  { keyword: "Pumpkin Seeds", image: "organic-pumpkin-seeds.jpg" },
  { keyword: "Hemp Hearts", image: "organic-hemp-hearts.jpg" },
  { keyword: "Chia Seeds", image: "organic-chia-seeds.jpg" },
  { keyword: "Sunflower Seeds", image: "organic-sunflower-seeds.jpg" },
  { keyword: "Pecans", image: "organic-pecans.jpg" },
  { keyword: "Peanuts", image: "organic-peanuts-roasted.jpg" },
  { keyword: "Oats", image: "organic-oats-thick-rolled.jpg" },
  { keyword: "Jasmine Rice", image: "organic-jasmine-rice.jpg" },
  { keyword: "Black Rice", image: "organic-black-rice.jpg" },
  { keyword: "Garbanzo", image: "organic-garbanzo-beans.jpg" },
  { keyword: "Black Turtle Beans", image: "organic-black-turtle-beans.jpg" },
  { keyword: "French Lentils", image: "organic-french-lentils.jpg" },
  { keyword: "Pinto Beans", image: "organic-pinto-beans.jpg" },
  { keyword: "Goji Berries", image: "organic-goji-berries.jpg" },
  { keyword: "Medjool Dates", image: "organic-medjool-dates.jpg" },
  { keyword: "Raisins", image: "organic-raisins-thompson.jpg" },
  { keyword: "Ginger", image: "organic-ginger-dusted.jpg" },
  { keyword: "Golden Berries", image: "organic-golden-berries.jpg" },
  { keyword: "Himalayan Salt", image: "himalayan-salt-pink.jpg" },
  { keyword: "Nutritional Yeast", image: "nutritional-yeast-flakes.jpg" },
  { keyword: "Coconut Milk", image: "organic-coconut-milk-powder.jpg" },
  { keyword: "Baking Soda", image: "baking-soda-food-grade.jpg" },
  { keyword: "Cacao Powder", image: "organic-cacao-powder.jpg" },
];

async function run() {
  const client = await pool.connect();
  try {
    console.log("Linking product images for placeid=18...\n");

    let totalUpdated = 0;

    for (const m of mappings) {
      const photoJson = JSON.stringify([`/images/products/${m.image}`]);

      // Get matching rows
      const before = await client.query(
        `SELECT id, title FROM listings WHERE placeid = 18 AND title LIKE $1`,
        [`%${m.keyword}%`]
      );

      if (before.rows.length === 0) {
        console.log(`⚠️  No match for "${m.keyword}"`);
        continue;
      }

      // Update
      const result = await client.query(
        `UPDATE listings SET photourlsjson = $1 WHERE placeid = 18 AND title LIKE $2`,
        [photoJson, `%${m.keyword}%`]
      );

      for (const row of before.rows) {
        console.log(`✓ "${row.title}" → ${m.image}`);
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
