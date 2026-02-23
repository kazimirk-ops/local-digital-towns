const fs = require("fs");
const path = require("path");

const PAGES = [
  { url: "https://essentialorganicingredients.com/products.json?limit=250&page=1", out: path.join(__dirname, "supplier-page1.json") },
  { url: "https://essentialorganicingredients.com/products.json?limit=250&page=2", out: path.join(__dirname, "supplier-page2.json") },
];

async function main() {
  for (const { url, out } of PAGES) {
    console.log("Fetching", url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json();
    fs.writeFileSync(out, JSON.stringify(data, null, 2));
    const count = data.products ? data.products.length : 0;
    console.log(`Saved ${count} products to ${out}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
