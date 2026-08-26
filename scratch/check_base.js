const fs = require("fs");
const c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
const count = (re) => (c.match(re) || []).length;
console.log("CLEAN BASE CHECK:");
console.log("  ₹:", count(/₹/g), "| emoji:", count(/[\u{1F300}-\u{1FAFF}]/gu), "| devanagari:", count(/[\u0900-\u097F]/gu), "| em-dash:", count(/—/g));
console.log("  mojibake â€:", count(/â€/g), "ð:", count(/ð/g), "à¤:", count(/à¤/g));
const m = c.match(/APP_VERSION = "([^"]+)"/);
console.log("  APP_VERSION:", m ? m[1] : "?");
console.log("  length:", c.length);
