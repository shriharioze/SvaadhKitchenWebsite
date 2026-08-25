const fs = require("fs");
let c = fs.readFileSync("scratch/test_labels_breakfast.js", "utf8");
const a = 'bfMeal.items["Curd"] === 3';
const b = 'bfMeal.items["Curd"] === 2';
if (c.includes(a)) { c = c.replace(a, b); }
c = c.replace("Breakfast counts (Poha 2, Upma 2, Curd 3)", "Breakfast counts (Poha 2, Upma 2, Curd 2)");
fs.writeFileSync("scratch/test_labels_breakfast.js", c);
console.log("fixed");
