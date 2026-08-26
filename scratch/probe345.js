const fs = require("fs");
const c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
const i = c.indexOf("society pinned to the single drop location");
fs.writeFileSync("scratch/probe3.txt", i === -1 ? "NOT FOUND" : c.slice(i - 100, i + 700), "utf8");
const j = c.indexOf("S.profile.society = _fld");
fs.writeFileSync("scratch/probe4.txt", j === -1 ? "NOT FOUND" : c.slice(j - 80, j + 300), "utf8");
const k = c.indexOf('society: $(pfx');
fs.writeFileSync("scratch/probe5.txt", k === -1 ? "NOT FOUND" : c.slice(k - 120, k + 260), "utf8");
console.log("ok");
