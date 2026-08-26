const fs = require("fs");
const c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
const i = c.indexOf("function readPerMealAddr");
fs.writeFileSync("scratch/probe7.txt", i === -1 ? "NOT FOUND" : c.slice(i, i + 700), "utf8");
console.log("ok");
