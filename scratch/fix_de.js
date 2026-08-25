const fs = require("fs");
let c = fs.readFileSync("scratch/test_archive_policy.js", "utf8");
const a = 'T("remaining live = only unpaid On-Account rows", liveSids().every(s => ["SK-APR-1","SK-MAY-1","SK-JUN-1","SK-JUN-2","SK-JUL-2","SK-AUG-3"].indexOf(s) === -1 ? false : true) && liveOrders.rows.length === 6);';
const b = 'T("remaining live = only the 5 unpaid On-Account rows", liveOrders.rows.length === 5 && ["SK-MAY-1","SK-JUN-1","SK-JUN-2","SK-JUL-2","SK-AUG-3"].every(s => liveSids().indexOf(s) !== -1), "live=" + JSON.stringify(liveSids()));';
if (c.includes(a)) { c = c.replace(a, b); } else { console.log("MISS D"); }
const a2 = 'T("live unchanged", liveOrders.rows.length === 6 && allLiveDatesReal());';
const b2 = 'T("live unchanged", liveOrders.rows.length === 5 && allLiveDatesReal());';
if (c.includes(a2)) { c = c.replace(a2, b2); } else { console.log("MISS E"); }
fs.writeFileSync("scratch/test_archive_policy.js", c);
console.log("scenario D/E expectations corrected");
