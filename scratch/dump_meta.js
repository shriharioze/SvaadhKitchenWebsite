const fs = require("fs");
const c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
const i = c.indexOf('meta name="description"');
fs.writeFileSync("scratch/metadump.txt", c.slice(i - 5, i + 220), "utf8");
console.log("dumped");
