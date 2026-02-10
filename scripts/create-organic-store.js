const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const readline = require("readline");

// --- Parse CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const townName = getArg("--town-name");
const dbUrl = getArg("--db-url");
const ownerUserId = Number(getArg("--owner-user-id") || 0);
const townId = Number(getArg("--town-id") || 1);
const districtId = Number(getArg("--district-id") || 1);

if (!townName || !dbUrl || !ownerUserId) {
  console.error("Usage: node create-organic-store.js --town-name \"Tampa Bay\" --db-url \"postgresql://...\" --owner-user-id 1");
  console.error("Optional: --town-id 1 --district-id 1");
  process.exit(1);
}

const storeName = `${townName} Organics`;
const description = `Your local source for organic ingredients at prices well below retail. We partner directly with certified organic suppliers to bring you nuts, seeds, grains, spices, teas, and more — all shipped directly to your door. Over 450 products, multiple sizes, $15 flat rate shipping.`;

const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
});

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim().toLowerCase()); }));
}

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
    // Ensure variantsJson column exists
    await client.query("ALTER TABLE listings ADD COLUMN IF NOT EXISTS variantsjson JSONB NOT NULL DEFAULT '[]'::jsonb");

    // Check if store already exists
    const existing = await client.query("SELECT id FROM places WHERE name = $1 AND townid = $2", [storeName, townId]);
    let placeId;

    if (existing.rowCount > 0) {
      placeId = existing.rows[0].id;
      console.log(`Store "${storeName}" already exists (place ID ${placeId}).`);
      const answer = await ask("Overwrite existing store and listings? (y/n): ");
      if (answer !== "y" && answer !== "yes") {
        console.log("Aborted.");
        return;
      }
      // Delete existing listings
      const del = await client.query("DELETE FROM listings WHERE placeid = $1", [placeId]);
      console.log(`Deleted ${del.rowCount} existing listings.`);
      // Update place record
      await client.query(
        `UPDATE places SET description = $1, storetype = 'managed', category = 'Food', status = 'active',
         sellertype = 'business', visibilitylevel = 'town_only', verifiedstatus = 'verified',
         isfeatured = 1, meetupinstructions = 'Delivery', owneruserid = $2 WHERE id = $3`,
        [description, ownerUserId, placeId]
      );
      console.log(`Updated place ${placeId}.`);
    } else {
      // Create new place
      const ins = await client.query(
        `INSERT INTO places (townid, districtid, name, description, category, status, sellertype,
         visibilitylevel, verifiedstatus, isfeatured, storetype, meetupinstructions, owneruserid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [townId, districtId, storeName, description, "Food", "active", "business",
         "town_only", "verified", 1, "managed", "Delivery", ownerUserId]
      );
      placeId = ins.rows[0].id;
      console.log(`Created store "${storeName}" (place ID ${placeId}).`);
    }

    // Import catalog
    let inserted = 0;
    for (const product of catalog) {
      const prodDesc = stripHtml(product.body_html);
      const category = product.product_type || "";
      const variants = product.variants.map((v) => ({
        title: v.title,
        price: parseFloat(v.price),
        sku: v.sku || "",
      }));
      const lowestPrice = Math.min(...variants.map((v) => v.price));
      const images = product.images || [];

      await client.query(
        `INSERT INTO listings (placeid, townid, title, description, quantity, price, status,
         listingtype, exchangetype, offercategory, photourlsjson, variantsjson, createdat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
        [placeId, townId, product.title, prodDesc, 999, lowestPrice, "active",
         "item", "money", category, JSON.stringify(images), JSON.stringify(variants)]
      );
      inserted++;
      if (inserted % 50 === 0) console.log(`  Inserted ${inserted} listings...`);
    }

    console.log(`\n=== Summary ===`);
    console.log(`Store: ${storeName}`);
    console.log(`Place ID: ${placeId}`);
    console.log(`Town ID: ${townId}`);
    console.log(`Listings inserted: ${inserted}`);
    console.log(`Owner user ID: ${ownerUserId}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
