const fs = require("fs");
const path = require("path");

async function run() {
  console.log("Fetching The Soap House catalog...");
  const res = await fetch("https://thesoaphousellc.com/products.json?limit=250");
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const products = data.products || [];

  // Save raw response
  const rawPath = path.join(__dirname, "soap-house-products.json");
  fs.writeFileSync(rawPath, JSON.stringify(data, null, 2));
  console.log(`Saved raw response: ${rawPath} (${products.length} products)`);

  // Strip HTML
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

  // Process catalog
  const catalog = products.map((p) => {
    const variants = (p.variants || []).map((v) => ({
      title: v.title,
      price: parseFloat(v.price),
      sku: v.sku || "",
    }));
    const images = (p.images || []).map((img) => img.src);
    return {
      title: p.title,
      description: stripHtml(p.body_html),
      price: variants.length ? variants[0].price : 0,
      productType: p.product_type || "",
      tags: p.tags || [],
      images,
      shopifyUrl: `https://thesoaphousellc.com/products/${p.handle}`,
      variants,
    };
  });

  const catalogPath = path.join(__dirname, "soap-house-catalog.json");
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  console.log(`Saved clean catalog: ${catalogPath}`);

  // Summary
  const types = {};
  let minPrice = Infinity;
  let maxPrice = 0;
  catalog.forEach((p) => {
    const t = p.productType || "(none)";
    types[t] = (types[t] || 0) + 1;
    p.variants.forEach((v) => {
      if (v.price < minPrice) minPrice = v.price;
      if (v.price > maxPrice) maxPrice = v.price;
    });
  });

  console.log(`\n=== Summary ===`);
  console.log(`Total products: ${catalog.length}`);
  console.log(`Price range: $${minPrice.toFixed(2)} — $${maxPrice.toFixed(2)}`);
  console.log(`\nProduct types:`);
  Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .forEach(([t, c]) => console.log(`  ${t}: ${c}`));
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
