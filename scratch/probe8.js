const fs = require("fs");
const c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
// probe the checkout small-fee block + upsertProfile raw fetch variants
const probes = ["Small Order Fee", "upsertProfile"];
let out = [];
probes.forEach(pr => {
  let i = -1, hits = 0;
  while ((i = c.indexOf(pr, i + 1)) !== -1 && hits < 8) {
    out.push("=== " + pr + " @" + i + " ===\n" + c.slice(Math.max(0, i - 130), i + 200));
    hits++;
  }
});
fs.writeFileSync("scratch/probe8.txt", out.join("\n\n"), "utf8");
console.log("ok", out.length);
