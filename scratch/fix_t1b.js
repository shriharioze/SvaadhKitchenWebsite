const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_e2e.js", "utf8");
const a = 'T("schema cloned from SK_Orders (" + skWs.headers.length + " cols)", lsW && lsW.headers.length === skWs.headers.length && lsW.headers[0] === "Submission_ID");';
const b = 'T("schema = SK minus Maps_Link/Landmark (60 cols)", lsW && lsW.headers.length === 60 && lsW.headers.indexOf("Maps_Link") === -1 && lsW.headers.indexOf("Landmark") === -1, lsW ? ("cols=" + lsW.headers.length) : "no tab");';
if (c.includes(a)) { c = c.replace(a, b); fs.writeFileSync("scratch/test_ls_e2e.js", c); console.log("test1 updated"); }
else { console.log("MISS — line content:"); const lines = c.split("\n"); console.log(lines[291]); }
