const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : false
});

const updates = [
  // Nuts & Butters
  { keyword: "Walnut", category: "Nuts & Butters", description: "Origin: USA. Raw, domestic. Rich in omega-3s and antioxidants." },
  { keyword: "Pecan", category: "Nuts & Butters", description: "Origin: Mexico. Fancy large halves. Perfect for baking and snacking." },
  { keyword: "Peanut", category: "Nuts & Butters", description: "Origin: Mexico. Dry roasted. Classic snack, rich in protein." },

  // Seeds
  { keyword: "Pumpkin Seeds", category: "Seeds", description: "Origin: China. Grade AA, mechanically shelled. Rich in iron, potassium, magnesium, and zinc." },
  { keyword: "Hemp Hearts", category: "Seeds", description: "Origin: Canada. #1 grade, hulled raw. High in protein and essential fatty acids." },
  { keyword: "Chia Seeds", category: "Seeds", description: "Origin: Paraguay/Argentina. Rich in fiber, omega-3s, and minerals." },
  { keyword: "Sunflower Seeds", category: "Seeds", description: "Origin: China. Raw, shelled. Hulled and cleaned. Great for snacking and salads." },

  // Grains & Rices
  { keyword: "Oats", category: "Grains & Rices", description: "Origin: Canada. Regular/thick rolled. Lightly steamed, rolled, and kiln-dried." },
  { keyword: "Jasmine Rice", category: "Grains & Rices", description: "Origin: Thailand. Thai fragrant rice. Aromatic long-grain variety." },
  { keyword: "Black Rice", category: "Grains & Rices", description: "Origin: China. Also known as Forbidden Rice. Turns deep purple when cooked. High in antioxidants." },

  // Legumes & Lentils
  { keyword: "Garbanzo", category: "Legumes & Lentils", description: "Origin: Argentina. Versatile legume for hummus, soups, and salads." },
  { keyword: "Black Turtle Beans", category: "Legumes & Lentils", description: "Origin: Canada. Great for soups, rice bowls, and Latin dishes." },
  { keyword: "French Lentils", category: "Legumes & Lentils", description: "Origin: Canada. Firm texture, earthy flavor with subtle peppery notes." },
  { keyword: "Pinto Beans", category: "Legumes & Lentils", description: "Origin: USA. A staple for chili, refried beans, and stews." },

  // Dried Fruit
  { keyword: "Goji Berries", category: "Dried Fruit", description: "Origin: China. Superfood berry rich in beta-carotene, iron, and antioxidants." },
  { keyword: "Medjool Dates", category: "Dried Fruit", description: "Origin: USA. Sweet and rich. A dietary staple for over 6,000 years." },
  { keyword: "Raisins", category: "Dried Fruit", description: "Origin: USA. Thompson seedless, oil-free. Packed with B vitamins, iron, and potassium." },
  { keyword: "Ginger", category: "Dried Fruit", description: "Origin: China. Lightly dusted, sweet and spicy chunks. Great for snacking and baking." },
  { keyword: "Golden Berries", category: "Dried Fruit", description: "Origin: Peru. High in antioxidants, protein, and dietary fiber." },

  // Pantry Staples
  { keyword: "Himalayan Salt", category: "Pantry Staples", description: "Origin: Pakistan. Natural pink, fine ground. Contains 80+ essential minerals. OMRI certified." },
  { keyword: "Nutritional Yeast", category: "Pantry Staples", description: "Origin: USA. Red Star large flakes. Rich in B vitamins. Cheesy flavor for plant-based cooking." },
  { keyword: "Coconut Milk", category: "Pantry Staples", description: "Origin: Sri Lanka. Creamy and slightly sweet. Great for smoothies and curries." },
  { keyword: "Baking Soda", category: "Pantry Staples", description: "Origin: USA. Food grade, OMRI certified. Sodium bicarbonate for baking and cleaning." },

  // Cacao
  { keyword: "Cacao Powder", category: "Cacao", description: "Origin: Peru. Premium fermented, roasted, and finely milled cacao." },
];

async function run() {
  const client = await pool.connect();
  try {
    console.log("Starting updates for placeid=18...\n");

    let totalUpdated = 0;

    for (const u of updates) {
      // First, get current rows to log the change
      const before = await client.query(
        `SELECT id, title, offercategory FROM listings WHERE placeid = 18 AND title LIKE $1`,
        [`%${u.keyword}%`]
      );

      if (before.rows.length === 0) {
        console.log(`⚠️  No matches for keyword "${u.keyword}"`);
        continue;
      }

      // Update
      const result = await client.query(
        `UPDATE listings SET description = $1, offercategory = $2 WHERE placeid = 18 AND title LIKE $3`,
        [u.description, u.category, `%${u.keyword}%`]
      );

      // Log each matched row
      for (const row of before.rows) {
        console.log(`✓ "${row.title}" | ${row.offercategory} → ${u.category}`);
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
