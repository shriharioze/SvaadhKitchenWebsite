const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let c = fs.readFileSync(p, "utf8");
// find the OTHER threshold banner (preview bill version, ~351371 area uses _dynTh)
const i = c.indexOf("_dynTh");
const seg = c.slice(i - 100, i + 3000);
// find the banner emit for _dynTh
const m = seg.match(/_dynTh[^]{0,80}?Add /);
fs.writeFileSync("scratch/probe10.txt", seg, "utf8");
console.log("dumped");
