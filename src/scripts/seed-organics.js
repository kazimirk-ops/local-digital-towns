const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : false
});

async function run() {
  const client = await pool.connect();
  try {
    // Check place 18
    const place = await client.query("SELECT id, name, status, isfeatured, verifiedstatus FROM places WHERE id=18");
    if (place.rows.length === 0) {
      console.log("Place id=18 not found. Aborting.");
      return;
    }
    console.log("Place 18:", place.rows[0]);

    // Ensure it's featured and verified
    if (place.rows[0].isfeatured !== 1 || place.rows[0].verifiedstatus !== "verified") {
      await client.query("UPDATE places SET isfeatured=1, verifiedstatus='verified', status='active' WHERE id=18");
      console.log("Updated place 18 to featured/verified/active");
    }

    const listings = [
      // Nuts & Seeds
      { title: "Organic Walnuts 1/4 lb", price: 6.75, category: "Nuts & Seeds", origin: "California, USA" },
      { title: "Organic Walnuts 1 lb", price: 21.75, category: "Nuts & Seeds", origin: "California, USA" },
      { title: "Organic Pumpkin Seeds 1 lb", price: 11.50, category: "Nuts & Seeds", origin: "Austria" },
      { title: "Organic Pumpkin Seeds 5 lb", price: 48.75, category: "Nuts & Seeds", origin: "Austria" },
      { title: "Organic Hemp Hearts 1/4 lb", price: 5.25, category: "Nuts & Seeds", origin: "Canada" },
      { title: "Organic Hemp Hearts 1 lb", price: 18.75, category: "Nuts & Seeds", origin: "Canada" },
      { title: "Organic Chia Seeds 1 lb", price: 11.25, category: "Nuts & Seeds", origin: "Mexico" },
      { title: "Organic Chia Seeds 5 lb", price: 43.75, category: "Nuts & Seeds", origin: "Mexico" },
      { title: "Organic Sunflower Seeds 1 lb", price: 6.25, category: "Nuts & Seeds", origin: "USA" },
      { title: "Organic Sunflower Seeds 5 lb", price: 25.75, category: "Nuts & Seeds", origin: "USA" },
      { title: "Organic Pecans 1/4 lb", price: 9.25, category: "Nuts & Seeds", origin: "Georgia, USA" },
      { title: "Organic Pecans 1 lb", price: 29.50, category: "Nuts & Seeds", origin: "Georgia, USA" },
      { title: "Organic Peanuts Roasted 1 lb", price: 9.25, category: "Nuts & Seeds", origin: "USA" },
      { title: "Organic Peanuts Roasted 5 lb", price: 37.75, category: "Nuts & Seeds", origin: "USA" },

      // Grains & Rice
      { title: "Organic Oats Thick Rolled 2.2 lb", price: 7.00, category: "Grains & Rice", origin: "Finland" },
      { title: "Organic Oats Thick Rolled 10 lb", price: 27.00, category: "Grains & Rice", origin: "Finland" },
      { title: "Organic Jasmine Rice 2.2 lb", price: 10.75, category: "Grains & Rice", origin: "Thailand" },
      { title: "Organic Jasmine Rice 5 lb", price: 23.25, category: "Grains & Rice", origin: "Thailand" },
      { title: "Organic Black Rice Ancient 1 lb", price: 5.50, category: "Grains & Rice", origin: "Indonesia" },
      { title: "Organic Black Rice Ancient 5 lb", price: 23.50, category: "Grains & Rice", origin: "Indonesia" },

      // Legumes & Lentils
      { title: "Organic Garbanzo Beans 1 lb", price: 7.50, category: "Legumes & Lentils", origin: "Turkey" },
      { title: "Organic Garbanzo Beans 5 lb", price: 29.25, category: "Legumes & Lentils", origin: "Turkey" },
      { title: "Organic Black Turtle Beans 1 lb", price: 5.50, category: "Legumes & Lentils", origin: "Mexico" },
      { title: "Organic Black Turtle Beans 5 lb", price: 22.50, category: "Legumes & Lentils", origin: "Mexico" },
      { title: "Organic French Lentils 1 lb", price: 7.75, category: "Legumes & Lentils", origin: "France" },
      { title: "Organic French Lentils 5 lb", price: 30.25, category: "Legumes & Lentils", origin: "France" },
      { title: "Organic Pinto Beans 1 lb", price: 6.25, category: "Legumes & Lentils", origin: "USA" },
      { title: "Organic Pinto Beans 5 lb", price: 23.50, category: "Legumes & Lentils", origin: "USA" },

      // Dried Fruit
      { title: "Organic Goji Berries 1/4 lb", price: 6.75, category: "Dried Fruit", origin: "China" },
      { title: "Organic Goji Berries 1 lb", price: 21.75, category: "Dried Fruit", origin: "China" },
      { title: "Organic Medjool Dates 1/4 lb", price: 4.75, category: "Dried Fruit", origin: "Israel" },
      { title: "Organic Medjool Dates 1 lb", price: 15.00, category: "Dried Fruit", origin: "Israel" },
      { title: "Organic Raisins Thompson 1 lb", price: 9.00, category: "Dried Fruit", origin: "California, USA" },
      { title: "Organic Raisins Thompson 5 lb", price: 36.00, category: "Dried Fruit", origin: "California, USA" },
      { title: "Organic Ginger Lightly Dusted 1/4 lb", price: 4.75, category: "Dried Fruit", origin: "Fiji" },
      { title: "Organic Ginger Lightly Dusted 1 lb", price: 15.00, category: "Dried Fruit", origin: "Fiji" },
      { title: "Organic Golden Berries 1/4 lb", price: 8.25, category: "Dried Fruit", origin: "Colombia" },
      { title: "Organic Golden Berries 1 lb", price: 27.00, category: "Dried Fruit", origin: "Colombia" },

      // Pantry Staples
      { title: "Himalayan Salt Pink 1 lb", price: 3.75, category: "Pantry Staples", origin: "Pakistan" },
      { title: "Himalayan Salt Pink 5 lb", price: 13.75, category: "Pantry Staples", origin: "Pakistan" },
      { title: "Nutritional Yeast Flakes 1/4 lb", price: 7.50, category: "Pantry Staples", origin: "USA" },
      { title: "Nutritional Yeast Flakes 1 lb", price: 24.25, category: "Pantry Staples", origin: "USA" },
      { title: "Organic Coconut Milk Powder 1/4 lb", price: 6.00, category: "Pantry Staples", origin: "Sri Lanka" },
      { title: "Organic Coconut Milk Powder 1 lb", price: 18.00, category: "Pantry Staples", origin: "Sri Lanka" },
      { title: "Baking Soda Food Grade 1 lb", price: 4.50, category: "Pantry Staples", origin: "USA" },
      { title: "Baking Soda Food Grade 5 lb", price: 16.00, category: "Pantry Staples", origin: "USA" },

      // Cacao
      { title: "Organic Cacao Powder 1 lb", price: 20.25, category: "Cacao", origin: "Peru" },
      { title: "Organic Cacao Powder 5 lb", price: 87.00, category: "Cacao", origin: "Peru" },
    ];

    console.log(`Inserting ${listings.length} listings...`);

    let inserted = 0;
    for (const item of listings) {
      await client.query(
        `INSERT INTO listings (placeId, townId, title, description, quantity, price, status, listingType, exchangeType, offerCategory, photoUrlsJson, createdAt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [18, 1, item.title, `Origin: ${item.origin}`, 50, item.price, "active", "item", "money", item.category, "[]"]
      );
      inserted++;
    }

    console.log(`Done. Inserted ${inserted} listings for place 18.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
