// REPLAY batch 1 — texts/SEO (all UTF-8-safe via node fs)
const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let c = fs.readFileSync(p, "utf8");
let n = 0, miss = [];
function rep(a, b) {
  if (c.includes(a)) { c = c.replace(a, b); n++; }
  else miss.push(a.slice(0, 60));
}

// meta / title / og
rep('<meta name="description" content="Svaadh Kitchen meals for the Liviano Serio community - fresh homemade vegetarian lunch &amp; dinner.">',
    '<meta name="description" content="Svaadh Kitchen meals for Ganga Serio, Kharadi residents — fresh homemade vegetarian Lunch & Dinner, always-free delivery, order in under 2 minutes.">');
rep('<meta property="og:description" content="Build your own meal — Chapati, Sabji, Dal, Rice & more. Fresh homemade food delivered to your door in Hadapsar, Pune. Free delivery above ₹106. No app needed!">',
    '<meta property="og:description" content="Fresh homemade Lunch & Dinner for Ganga Serio, Kharadi residents — always-free delivery, build your own meal. No app needed!">');

// JSON-LD description + address
rep('"description": "Homemade vegetarian cloud kitchen in Hadapsar, Pune. Fresh breakfast, lunch and dinner delivered daily. Make-your-own-meal — no fixed thali."',
    '"description": "Svaadh Kitchen meals for Ganga Serio, Kharadi — fresh homemade vegetarian Lunch & Dinner, always-free delivery, make-your-own-meal."');
rep(`  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Bhosale Nagar",
    "addressLocality": "Hadapsar",
    "addressRegion": "Pune, Maharashtra",
    "postalCode": "411028",
    "addressCountry": "IN"
  },`, `  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Ganga Serio, Kharadi",
    "addressLocality": "Kharadi",
    "addressRegion": "Pune, Maharashtra",
    "postalCode": "411014",
    "addressCountry": "IN"
  },`);

// How-it-works steps
rep('<p data-i18n-html="how_step2_desc">Wing, flat number, society, and area. Each meal can go to a\n            <strong>different address</strong> — breakfast at home, lunch at the office, dinner back home.\n          </p>',
    '<p>Select your Wing (A–G2), Flat No. and Floor. Your Society is set automatically —\n            Wings A–D are <strong>Liviano</strong>, E1–G2 are <strong>Serio</strong>.\n            One address for all your meals.</p>');
rep('<p data-i18n="how_step4_desc">Pick items for Breakfast, Lunch, and Dinner. Today\'s fresh sabji is displayed\n            for each meal. Type a quantity or tap + / −.</p>',
    '<p>Pick items for <strong>Lunch and Dinner</strong>. Today\'s fresh sabji is displayed\n            for each meal. Type a quantity or tap + / −.</p>');
rep('<div class="hi-val">🌅 Breakfast: 7:00 AM<br>☀️ Lunch: 9:00 AM<br>🌙 Dinner: 4:30 PM</div>\n          <p class="mr-note">नाश्ता: सकाळी ७:०० पूर्वी · दुपारचे जेवण: ९:०० पूर्वी · रात्रीचे जेवण: सायं ४:३० पूर्वी</p>',
    '<div class="hi-val">☀️ Lunch: 9:00 AM<br>🌙 Dinner: 4:30 PM</div>\n          <p class="mr-note">दुपारचे जेवण: ९:०० पूर्वी · रात्रीचे जेवण: सायं ४:३० पूर्वी</p>');

// cutoff strip near calendar
rep('🌅 Breakfast: before 7:00 AM &nbsp;|&nbsp; ☀️ Lunch: before 9:00 AM &nbsp;|&nbsp; 🌙 Dinner: before 4:30 PM',
    '☀️ Lunch: before 9:00 AM &nbsp;|&nbsp; 🌙 Dinner: before 4:30 PM');

// fee cards
rep(`<div style="font-size:0.82rem;font-weight:700;color:#1a252f;margin-bottom:8px;">🎁 When Delivery Becomes Free</div>
            <div style="font-size:0.78rem;color:#444;line-height:1.7;">
              <b>1 meal that day</b> → free delivery if food total ≥ ₹106<br>
              <b>2 meals that day</b> → free delivery if combined food total ≥ ₹159<br>
              <b>3 meals that day</b> → free delivery if combined food total ≥ ₹190<br><br>
              <span style="background:#e8f8f0;border-radius:6px;padding:6px 10px;display:block;font-size:0.75rem;color:#1e8449;">
                💡 <b>Example:</b> You order Breakfast (₹80) and pay ₹11 delivery. Later that day you add Dinner (₹90). Combined = ₹170 ≥ ₹159 — delivery becomes free, and the ₹11 you already paid is <b>credited back</b> on your next order that day.
              </span>
            </div>`,
    `<div style="font-size:0.82rem;font-weight:700;color:#1a252f;margin-bottom:8px;">🎁 Delivery — Always FREE Here</div>
            <div style="font-size:0.78rem;color:#444;line-height:1.7;">
              Every order on this page gets <b>FREE delivery</b> — no minimum amount, no delivery fee, ever.<br><br>
              <span style="background:#e8f8f0;border-radius:6px;padding:6px 10px;display:block;font-size:0.75rem;color:#1e8449;">
                💡 <b>Note:</b> Doorstep delivery to Ganga Serio is launching soon. Until then, <b>Self Pickup</b> from G2 804, Ganga Serio is available — we'll notify you the moment delivery starts.
              </span>
            </div>`);
rep('An extra <b>₹11</b> is added if your <b>Lunch or Dinner</b> subtotal is below <b>₹53</b>.<br>\n              This does not apply to Breakfast, free delivery areas, or Pickup orders.<br>\n              It is also waived once your day total crosses the free delivery threshold.',
    '<b>No small-order fee, no delivery charge, no hidden costs on this page.</b> You pay only for the food.\n              Order a full meal (₹53+) or a small one — the price you see is what you pay.');
rep('💡 <b>Example:</b> You order Breakfast ₹160 + Lunch ₹170 = ₹330 combined → 5% discount applied to the whole day automatically.',
    '💡 <b>Example:</b> Lunch ₹170 + Dinner ₹160 = ₹330 combined → 5% discount applied to the whole day automatically.');

// guide modal (steps + cutoffs + delivery cards + menu cards)
rep('["2","Add Your Delivery Address","Enter your Wing, Flat number, Society, and Area. You can set different addresses for Breakfast, Lunch, and Dinner if needed — or use the same address for all."]',
    '["2","Add Your Address","Select your Wing (A–G2), enter your Flat No. and Floor — your Society is set automatically (A–D = Liviano, E1–G2 = Serio). One address for all meals."]');
rep('["4","Build Your Meal","For each date, choose your meals — Breakfast, Lunch, and/or Dinner. Pick exactly what you want à la carte: Chapati, Sabji, Dal, Rice, etc. Today\'s sabji is shown live."]',
    '["4","Build Your Meal","For each date, choose <b>Lunch and/or Dinner</b>. Pick exactly what you want à la carte: Chapati, Sabji, Dal, Rice, etc. Today\'s sabji is shown live."]');
rep('📌 <b>Cutoff times to remember:</b><br>\n              Breakfast — before <b>7:00 AM</b><br>\n              Lunch — before <b>9:00 AM</b><br>\n              Dinner — before <b>4:30 PM</b><br>\n              Kitchen is <b>closed on Sundays</b>.',
    '📌 <b>Cutoff times to remember:</b><br>\n              Lunch — before <b>9:00 AM</b><br>\n              Dinner — before <b>4:30 PM</b><br>\n              Kitchen is <b>closed on Sundays</b>.');
rep('<b>Breakfast</b> → before 7:00 AM<br>\n              <b>Lunch</b> → before 9:00 AM<br>\n              <b>Dinner</b> → before 4:30 PM<br><br>',
    '<b>Lunch</b> → before 9:00 AM<br>\n              <b>Dinner</b> → before 4:30 PM<br><br>');

fs.writeFileSync(p, c);
console.log("batch1 applied " + n + ", missed " + miss.length);
miss.forEach(m => console.log("  MISS: " + m));
