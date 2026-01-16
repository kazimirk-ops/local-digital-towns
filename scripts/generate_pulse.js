const data = require("../data");

const dayKey = process.argv[2] || "";
const pulse = data.generateDailyPulse(1, dayKey || undefined);
console.log(JSON.stringify(pulse, null, 2));
