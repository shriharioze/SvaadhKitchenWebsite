const fs = require("fs");
const c = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const i = c.indexOf('set("Customer_Name"');
fs.writeFileSync("scratch/probe14.txt", c.slice(i, i + 100), "utf8");
console.log("ok");
