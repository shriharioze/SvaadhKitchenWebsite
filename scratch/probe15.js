const fs = require("fs");
const c = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const probes = ["Customer_Name", "profile.name"];
let out = [];
probes.forEach(pr => {
  let i = -1, h = 0;
  while ((i = c.indexOf(pr, i + 1)) !== -1 && h < 10) {
    const line = c.slice(Math.max(0, c.lastIndexOf("\n", i)) + 1, c.indexOf("\n", i));
    if (line.includes("set(")) { out.push("@" + i + ": " + line.trim()); h++; }
  }
});
fs.writeFileSync("scratch/probe15.txt", out.join("\n"), "utf8");
console.log("done");
