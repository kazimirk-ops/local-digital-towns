const fs = require("fs");
const path = require("path");

const catalogPath = path.join(__dirname, "soap-house-catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

function categorize(title) {
  const t = title.toLowerCase();
  if (t.includes("air & body mist") || t.includes("air and body mist")) return "Body Mist";
  if (t.includes("goat milk soap") || t.includes("aromatic goat milk")) return "Goat Milk Soap";
  if (t.includes("mineral clay soap") || t.includes("clay soap")) return "Clay Soap";
  if (t.includes("coconut milk") && t.includes("soap")) return "Coconut Milk Soap";
  if (t.includes("african black soap")) return "Clay Soap";
  if (t.includes("oil diffuser") || t.includes("hanging oil")) return "Oil Diffuser";
  if (t.includes("potpourri") || t.includes("sachet")) return "Potpourri Sachet";
  if (t.includes("hand sanitizer")) return "Hand Sanitizer";
  if (t.includes("soap saver")) return "Accessories";
  if (t.includes("candle") || t.includes("beeswax")) return "Candles";
  if (t.includes("lotion") || t.includes("body butter")) return "Body Care";
  if (t.includes("gift") || t.includes("set") || t.includes("bundle")) return "Gift Sets";
  if (t.includes("loofah bar")) return "Clay Soap";
  if (t.includes(" x ")) return "Clay Soap";
  if (t.includes("powder x")) return "Clay Soap";
  if (t.includes("bath tea") || t.includes("herbal bath")) return "Bath Tea";
  if (t.includes("room spray")) return "Body Mist";
  if (t.includes("soap")) return "Soap";
  return "Other";
}

const counts = {};
catalog.forEach((p) => {
  p.productType = categorize(p.title);
  const t = p.productType;
  counts[t] = (counts[t] || 0) + 1;
});

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log("Updated soap-house-catalog.json\n");
console.log("=== Categories ===");
Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([t, c]) => console.log(`  ${t}: ${c}`));
console.log(`\n  Total: ${catalog.length}`);
