const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const dbUrl = process.argv[2];
const placeId = Number(process.argv[3]);

if (!dbUrl || !placeId) {
  console.error("Usage: node import-soap-house.js <db-url> <placeId>");
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
});

async function run() {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "soap-house-catalog.json"), "utf8"));
  const client = await pool.connect();

  try {
    // Check place exists
    const place = await client.query("SELECT id, name FROM places WHERE id = $1", [placeId]);
    if (!place.rowCount) {
      console.error(`Place ${placeId} not found`);
      return;
    }
    console.log(`Importing to: ${place.rows[0].name} (place ID ${placeId})`);

    // Delete existing listings for this place
    const del = await client.query("DELETE FROM listings WHERE placeid = $1", [placeId]);
    if (del.rowCount > 0) console.log(`Deleted ${del.rowCount} existing listings.`);

    let inserted = 0;
    for (const product of catalog) {
      const desc = product.shopifyUrl
        ? (product.description ? product.description + "\n\nShop online: " + product.shopifyUrl : "Shop online: " + product.shopifyUrl)
        : product.description;

      await client.query(
        `INSERT INTO listings (placeid, townid, title, description, quantity, price, status,
         listingtype, exchangetype, offercategory, photourlsjson, variantsjson, createdat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
        [placeId, 1, product.title, desc, 999, product.price, "active",
         "item", "money", product.productType, JSON.stringify(product.images), "[]"]
      );
      inserted++;
      if (inserted % 25 === 0) console.log(`  Inserted ${inserted} listings...`);
    }

    console.log(`\n=== Summary ===`);
    console.log(`Store: ${place.rows[0].name}`);
    console.log(`Place ID: ${placeId}`);
    console.log(`Listings inserted: ${inserted}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
