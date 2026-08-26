const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let c = fs.readFileSync(p, "utf8");
const a = '    const LS_SOCIETY_NAME = "Liviano Serio";\n';
if (c.includes(a)) { c = c.replace(a, ""); fs.writeFileSync(p, c); console.log("const removed"); }
console.log("remaining LS_SOCIETY_NAME refs:", (c.match(/LS_SOCIETY_NAME/g) || []).length);
