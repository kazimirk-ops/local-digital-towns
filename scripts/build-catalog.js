const fs = require("fs");
const path = require("path");

const page1 = JSON.parse(fs.readFileSync(path.join(__dirname, "supplier-page1.json"), "utf8"));
const page2 = JSON.parse(fs.readFileSync(path.join(__dirname, "supplier-page2.json"), "utf8"));

const allProducts = [...(page1.products || []), ...(page2.products || [])];

const catalog = allProducts.map((p) => ({
  title: p.title,
  body_html: p.body_html,
  product_type: p.product_type,
  tags: p.tags || [],
  vendor: p.vendor,
  variants: (p.variants || []).map((v) => ({
    title: v.title,
    price: (Math.ceil(parseFloat(v.price) * 1.20 * 100) / 100).toFixed(2),
    sku: v.sku,
    available: v.available,
  })),
  images: (p.images || []).map((img) => img.src),
}));

const OUT = path.join(__dirname, "catalog-final.json");
fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2));

const totalVariants = catalog.reduce((sum, p) => sum + p.variants.length, 0);
const typeCounts = {};
for (const p of catalog) {
  const t = p.product_type || "(none)";
  typeCounts[t] = (typeCounts[t] || 0) + 1;
}

console.log(`Total products: ${catalog.length}`);
console.log(`Total variants: ${totalVariants}`);
console.log(`\nProduct types:`);
for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type}: ${count}`);
}
console.log(`\nSaved to ${OUT}`);
