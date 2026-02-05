const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const products = [
  { url: "https://essentialorganicingredients.com/collections/foods/products/nuts-nut-butters-organic-walnuts-raw-halves-pieces", name: "organic-walnuts" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/seeds-seed-butters-organic-pumpkin-seeds-grade-aa", name: "organic-pumpkin-seeds" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/seeds-seed-butters-organic-hemp-hearts-1-grade-hulled-raw", name: "organic-hemp-hearts" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/seeds-seed-butters-organic-chia-seeds-black", name: "organic-chia-seeds" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/seeds-grains-legumes-seeds-seed-butters-organic-sunflower-seeds-raw-shelled-imported", name: "organic-sunflower-seeds" },
  { url: "https://essentialorganicingredients.com/products/nuts-fruits-cacao-nuts-nut-butters-organic-pecans-fancy-large-halves", name: "organic-pecans" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/nuts-nut-butters-organic-peanuts-roasted", name: "organic-peanuts-roasted" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/grains-organic-oats-regular-thick-rolled", name: "organic-oats-thick-rolled" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/seeds-grains-legumes-whole-grains-rices-jasmine-rice-white", name: "organic-jasmine-rice" },
  { url: "https://essentialorganicingredients.com/products/seeds-grains-legumes-whole-grains-black-rice-ancient", name: "organic-black-rice" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/legumes-organic-garbanzo-beans-chick-peas", name: "organic-garbanzo-beans" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/legumes-organic-black-turtle-beans", name: "organic-black-turtle-beans" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/legumes-organic-lentils-french", name: "organic-french-lentils" },
  { url: "https://essentialorganicingredients.com/products/legumes-organic-pinto-beans", name: "organic-pinto-beans" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/nuts-fruits-cacao-dried-fruits-organic-goji-berries", name: "organic-goji-berries" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/dried-fruits-organic-dates-medjool-whole-large", name: "organic-medjool-dates" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/dried-fruits-organic-raisins-thompsons-oil-free", name: "organic-raisins-thompson" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/dried-fruits-organic-ginger-lightly-dusted", name: "organic-ginger-dusted" },
  { url: "https://essentialorganicingredients.com/products/dried-fruits-organic-golden-berries", name: "organic-golden-berries" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/culinary-ingredients-salt-himalayan-natural-pink-fine-ground", name: "himalayan-salt-pink" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/culinary-ingredients-nutritional-yeast-red-star-large-flakes", name: "nutritional-yeast-flakes" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/herbs-spices-boosters-teas-organic-coconut-milk-powder", name: "organic-coconut-milk-powder" },
  { url: "https://essentialorganicingredients.com/products/culinary-ingredients-baking-soda-food-grade", name: "baking-soda-food-grade" },
  { url: "https://essentialorganicingredients.com/collections/foods/products/organic-cacao-powder", name: "organic-cacao-powder" },
];

const outputDir = path.join(__dirname, "../../public/images/products");

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        const redirectUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchPage(redirectUrl).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function extractOgImage(html) {
  // Look for og:image meta tag
  const match = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (match) return match[1];

  // Fallback: look for main product image
  const imgMatch = html.match(/src=["'](https:\/\/cdn\.shopify\.com\/[^"']+)["']/i);
  return imgMatch ? imgMatch[1] : null;
}

function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    // Clean up URL (remove query params for cleaner download, but keep for fetch)
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return downloadImage(redirectUrl, filepath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(filepath);
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
      file.on("error", reject);
    }).on("error", reject);
  });
}

async function run() {
  console.log(`Fetching ${products.length} product images...\n`);

  let success = 0, failed = 0;

  for (const product of products) {
    try {
      console.log(`Fetching page: ${product.name}`);
      const html = await fetchPage(product.url);

      const imageUrl = extractOgImage(html);
      if (!imageUrl) {
        console.log(`  ⚠️  No image found for ${product.name}`);
        failed++;
        continue;
      }

      // Determine extension from URL
      let ext = ".jpg";
      if (imageUrl.includes(".png")) ext = ".png";
      else if (imageUrl.includes(".webp")) ext = ".webp";

      const filepath = path.join(outputDir, product.name + ext);

      console.log(`  Downloading: ${imageUrl.substring(0, 80)}...`);
      await downloadImage(imageUrl, filepath);
      console.log(`  ✓ Saved: ${product.name}${ext}`);
      success++;

      // Small delay to be polite
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`  ✗ Error for ${product.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
}

run().catch(err => { console.error(err); process.exit(1); });
