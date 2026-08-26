const fs = require("fs");
const c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
const probes = ["toast_area", '_fld("societyInput"', '_societyInput"]');
let out = [];
probes.forEach(pr => {
  let i = c.indexOf(pr);
  if (i === -1) { out.push("NOT FOUND: " + pr); return; }
  out.push(JSON.stringify(c.slice(Math.max(0, i - 160), i + 160)));
});
fs.writeFileSync("scratch/probe2.txt", out.join("\n\n---\n\n"), "utf8");
console.log("done");
