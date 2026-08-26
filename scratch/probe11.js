const fs = require("fs");
const c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
// search for the second banner emit: "Add ₹... more" variants
const probes = ["more to this day's order for <strong>Free Delivery", "more to this day&#39;s order", "more to unlock Free Delivery", "Add ₹${"];
let out = [];
probes.forEach(pr => {
  let i = -1, h = 0;
  while ((i = c.indexOf(pr, i + 1)) !== -1 && h < 8) {
    out.push("=== @" + i + " ===\n" + c.slice(Math.max(0, i - 260), i + 160));
    h++;
  }
});
fs.writeFileSync("scratch/probe11.txt", out.join("\n\n"), "utf8");
console.log("segments:", out.length);
