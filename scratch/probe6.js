const fs = require("fs");
const c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
// find syncSingleAddr society line + per-meal society line with looser probes
const probes = ["S.profile.society =", "society: $(", "_societyInput"];
let out = [];
probes.forEach(pr => {
  let i = -1, hits = 0;
  while ((i = c.indexOf(pr, i + 1)) !== -1 && hits < 6) {
    out.push("=== " + pr + " @ " + i + " ===\n" + c.slice(Math.max(0, i - 120), i + 160));
    hits++;
  }
  if (hits === 0) out.push("=== " + pr + " === NOT FOUND");
});
fs.writeFileSync("scratch/probe6.txt", out.join("\n\n"), "utf8");
console.log("ok");
