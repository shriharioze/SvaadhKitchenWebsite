const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let c = fs.readFileSync(p, "utf8");
// find the actual variants of the missed strings
const probes = ["Pickup from:", "can go to a different address", "close at 7:00 AM", "fixed prices", "Shree laxmi vihar society, Hadapsar", "Shree Laxmi Vihar Society, Hadapsar"];
let out = [];
probes.forEach(pr => {
  let i = c.indexOf(pr);
  while (i !== -1 && out.length < 14) {
    out.push(JSON.stringify(c.slice(Math.max(0, i - 60), i + 130)));
    i = c.indexOf(pr, i + 1);
  }
});
fs.writeFileSync("scratch/probe.txt", out.join("\n\n"), "utf8");
console.log("found", out.length);
