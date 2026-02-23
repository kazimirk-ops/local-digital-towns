const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
});

const PLACE_ID = 18;
const TOWN_ID = 1;

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function run() {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "catalog-final.json"), "utf8"));
  const client = await pool.connect();

  try {
    // Delete existing listings for Sebastian Organics
    const del = await client.query("DELETE FROM listings WHERE placeid = $1", [PLACE_ID]);
    console.log(`Deleted ${del.rowCount} existing listings for place ${PLACE_ID}`);

    let inserted = 0;
    for (const product of catalog) {
      const description = stripHtml(product.body_html);
      const category = product.product_type || "";
      const variants = product.variants.map((v) => ({
        title: v.title,
        price: parseFloat(v.price),
        sku: v.sku || "",
      }));
      const lowestPrice = Math.min(...variants.map((v) => v.price));
      const images = product.images || [];

      await client.query(
        `INSERT INTO listings (placeid, townid, title, description, quantity, price, status, listingtype, exchangetype, offercategory, photourlsjson, variantsjson, createdat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
        [PLACE_ID, TOWN_ID, product.title, description, 999, lowestPrice, "active", "item", "money", category, JSON.stringify(images), JSON.stringify(variants)]
      );
      inserted++;
      if (inserted % 50 === 0) console.log(`  Inserted ${inserted} listings...`);
    }

    console.log(`\nDone. Inserted ${inserted} total listings for place ${PLACE_ID}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
