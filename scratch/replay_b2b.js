const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let c = fs.readFileSync(p, "utf8");
let n = 0, miss = [];
function rep(a, b) { if (c.includes(a)) { c = c.split(a).join(b); n++; } else miss.push(a.slice(0, 70)); }

// pickup card in guide (uses PICKUP_ADDRESS already — fine); fix remaining card variant
rep('Pickup from: <b>G2 804, Ganga Serio, Kharadi</b><br>\n              Select "Self Pickup" as your area when ordering — no delivery charge applies.<br>\n              Collect at the same delivery timings as above.',
    'Pickup from: <b>G2 804, Ganga Serio, Kharadi</b><br>\n              Available right now — collect during the meal timings above. Free, no charges.');

// i18n strings (em-dash variants)
rep('"Each meal (Breakfast, Lunch, Dinner) can go to a different address — breakfast at home, lunch at the office."',
    '"One address for all your meals — Wing, Flat and Society at Ganga Serio."');
rep('"Breakfast orders close at 7:00 AM — order the night before to be safe.",',
    '"Lunch orders close at 9:00 AM and Dinner at 4:30 PM — order the night before to be safe.",');
rep('"Breakfast items have fixed prices — mix and match Poha, Upma, Idli, and more.",',
    '"Lunch and Dinner items have fixed prices — mix and match Chapati, Sabji, Dal, Rice, and more.",');

fs.writeFileSync(p, c);
console.log("batch2b applied " + n + ", missed " + miss.length);
miss.forEach(m => console.log("  MISS: " + m));
