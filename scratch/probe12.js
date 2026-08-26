const fs = require("fs");
const c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
const probes = ["Free Delivery</strong>", "Free Delivery (Current", "unlock your loyalty"];
let out = [];
probes.forEach(pr => {
  let i = -1, h = 0;
  while ((i = c.indexOf(pr, i + 1)) !== -1 && h < 10) {
    out.push("@" + i + ": " + c.slice(Math.max(0, i - 80), i + 140).replace(/\n/g, " | "));
    h++;
  }
});
fs.writeFileSync("scratch/probe12.txt", out.join("\n"), "utf8");
console.log("done");
