const fs = require("fs");
const path = require("path");

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "catalog-final.json"), "utf8"));

let totalImages = 0;
let noImages = 0;

for (const product of catalog) {
  const count = product.images ? product.images.length : 0;
  totalImages += count;
  if (count === 0) noImages++;
}

console.log(`Total products: ${catalog.length}`);
console.log(`Total image URLs: ${totalImages}`);
console.log(`Products with zero images: ${noImages}`);
console.log(`Products with images: ${catalog.length - noImages}`);
