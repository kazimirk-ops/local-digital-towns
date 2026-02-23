const fs = require("fs");
const path = require("path");

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "catalog-final.json"), "utf8"));

let totalVariants = 0;

console.log("=== DRY RUN — First 3 products ===\n");

for (let i = 0; i < catalog.length; i++) {
  const product = catalog[i];
  const variants = product.variants.map((v) => ({
    title: v.title,
    price: parseFloat(v.price),
    sku: v.sku || "",
  }));
  const lowestPrice = Math.min(...variants.map((v) => v.price));
  totalVariants += variants.length;

  if (i < 3) {
    console.log(`${i + 1}. ${product.title}`);
    console.log(`   Category: ${product.product_type}`);
    console.log(`   Price (lowest): $${lowestPrice.toFixed(2)}`);
    console.log(`   Images: ${(product.images || []).length}`);
    console.log(`   Variants (${variants.length}):`);
    for (const v of variants) {
      console.log(`     - ${v.title}: $${v.price.toFixed(2)} (SKU: ${v.sku})`);
    }
    console.log();
  }
}

console.log(`Total listings to insert: ${catalog.length}`);
console.log(`Total variants across all listings: ${totalVariants}`);
