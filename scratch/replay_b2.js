// REPLAY batch 2 — delivery/menu guide cards, FAQ, addresses, pickup links
const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let c = fs.readFileSync(p, "utf8");
let n = 0, miss = [];
function rep(a, b) { if (c.includes(a)) { c = c.split(a).join(b); n++; } else miss.push(a.slice(0, 70)); }

// ── delivery guide cards ──
rep(`<b>Bhosale Nagar</b> · <b>Triveni Nagar</b> · <b>Self Pickup</b><br>
              These areas never have a delivery charge regardless of order amount.`,
    `<b>Every order on this page ships free</b> — no minimum amount, no delivery fee. Doorstep delivery to Ganga Serio is <b>launching soon</b>; we'll notify you when it starts.`);
rep(`Magarpatta · Amanora · DP Road · Malwadi · SadeSatraNali · Kirtane Baug · Tupe Patil Road · BG Shirke Road · Pune-Solapur Road (Magarpatta Bridge to Gadital only) · Vihar Chowk · Mandai · Gadital<br><br>
              <b>₹11 delivery charge</b> per meal applies for these areas if your day's food total is below the free threshold (₹106 for 1 meal, ₹159 for 2 meals, ₹190 for 3 meals).`,
    `<b>Ganga Serio, Kharadi</b> — Wings A · B · C · D · E1 · E2 · F1 · F2 · G1 · G2<br>
              Wings A–D = <b>Liviano</b> · Wings E1–G2 = <b>Serio</b>`);
rep(`<b>Breakfast:</b> ~8:30 AM – 9:45 AM<br>
              <b>Lunch:</b> ~10:30 AM – 1:30 PM<br>
              <b>Dinner:</b> ~6:00 PM – 9:00 PM<br><br>
              Exact timing may vary slightly by area. Once your order is dispatched, you'll see <b>Out for Delivery</b> in Manage Orders.`,
    `<b>Lunch:</b> ~10:30 AM – 1:30 PM<br>
              <b>Dinner:</b> ~6:00 PM – 9:00 PM<br><br>
              Once doorstep delivery starts, you'll see <b>Out for Delivery</b> in Manage Orders.`);
rep(`Pickup from: <b>A 104, Shree laxmi vihar society</b><br>
              Select "Self Pickup" as your area when ordering — no delivery charge applies.<br>
              Collect at the same delivery timings as above.`,
    `Pickup from: <b>G2 804, Ganga Serio, Kharadi</b><br>
              Available right now — collect during the meal timings above. Free, no charges.`);
rep(`❌ We do <b>not</b> deliver outside the listed Hadapsar areas (e.g., Kothrud, Baner, Viman Nagar, Koregaon Park, etc.)`,
    `ℹ️ This page is <b>exclusively for Ganga Serio residents</b>. Live elsewhere in Hadapsar? Order from our main site <b>svaadhkitchen.in/order.html</b>`);

// ── menu section: breakfast card → L&D card ──
rep(`<div style="font-size:0.82rem;font-weight:700;color:#1a252f;margin-bottom:8px;">🌅 Breakfast (Rotating Daily)</div>
            <div style="font-size:0.78rem;color:#444;line-height:1.7;">
              Breakfast items rotate daily — ₹35 to ₹70 per serving.<br>
              Includes: Kanda Poha, Ghee Upma, Sabudana Khichdi, Sheera, Dadpe Pohe, Methi Thepla, Thalipeeth, Idli Chutney, Masala Dosa, and more.<br>
              Made with <b>Pure Ghee</b>. <b>Curd (50g ₹12)</b> available as an add-on.<br>
              Check the order form for today's breakfast options.
            </div>`,
    `<div style="font-size:0.82rem;font-weight:700;color:#1a252f;margin-bottom:8px;">🥘 Lunch &amp; Dinner Only</div>
            <div style="font-size:0.78rem;color:#444;line-height:1.7;">
              The dry sabji and curry sabji change daily based on what's fresh and in season.<br>
              Today's sabji is <b>shown live</b> on the order form when you pick Lunch or Dinner.<br>
              You can also check the <b>This Week's Menu</b> button for upcoming sabjis.
            </div>`);

// ── FAQ JSON ──
rep('"text": "Visit svaadhkitchen.in/order.html, enter your phone number, add your delivery address, pick your dates, choose your meals à la carte (Breakfast, Lunch, Dinner), and pay via UPI or Svaadh Wallet. No app download needed."',
    '"text": "On this Ganga Serio page, enter your phone number, select your Wing and Flat (Society auto-sets: A-D = Liviano, E1-G2 = Serio), pick your dates, choose Lunch and Dinner items à la carte, and pay via UPI or Svaadh Wallet. No app download needed."');
rep('"text": "Breakfast orders must be placed before 7:00 AM, Lunch before 9:00 AM, and Dinner before 4:30 PM."',
    '"text": "Lunch orders must be placed before 9:00 AM and Dinner before 4:30 PM. This page serves Lunch and Dinner only."');
rep('"name": "Which areas in Hadapsar do you deliver to?"',
    '"name": "Where do you deliver from this page?"');
rep('"text": "We deliver to 14 areas in Hadapsar: Bhosale Nagar (free delivery), Triveni Nagar (free delivery), Magarpatta, Amanora, DP Road, Malwadi, SadeSatraNali, Kirtane Baug, Tupe Patil Road, BG Shirke Road, Pune-Solapur Road (Magarpatta Bridge to Gadital only), Vihar Chowk, Mandai, and Gadital. Self Pickup is also available free of charge."',
    '"text": "This page serves Ganga Serio, Kharadi — Wings A, B, C, D, E1, E2, F1, F2, G1 and G2 (A-D = Liviano, E1-G2 = Serio). Doorstep delivery is launching soon; until then Self Pickup from G2 804, Ganga Serio is available. Live elsewhere in Hadapsar? Order from svaadhkitchen.in/order.html."');
rep('"text": "Delivery is free when your day\'s food total reaches ₹106 (1 meal), ₹159 (2 meals) or ₹190 (3 meals); otherwise a nominal ₹11 per meal applies. Bhosale Nagar and Triveni Nagar always have free delivery, and Self Pickup is free."',
    '"text": "Every order on this page is FREE of delivery charges — no minimum amount. Doorstep delivery to Ganga Serio is launching soon; Self Pickup from G2 804, Ganga Serio is available right now."');
rep(' Breakfast rotates daily — Kanda Poha [175g], Upma [200g], Sabudana Khichdi [200g], Sheera [200g] and more."',
    ' This page serves Lunch and Dinner only."');
rep('"text": "You can cancel before the cutoff time (Breakfast: 7 AM, Lunch: 9:00 AM, Dinner: 4:30 PM) through the Manage Orders section. Editing is not available — delete and re-place with changes instead."',
    '"text": "You can cancel before the cutoff time (Lunch: 9:00 AM, Dinner: 4:30 PM) through the Manage Orders section. Editing is not available — delete and re-place with changes instead."');

// ── visible FAQs ──
rep("{ q: \"What's included in your thali / meals?\", a: \"We follow a <strong>Make Your Own Meal</strong> model — pick exactly what you want:<br>🫓 <strong>Breads</strong>: Chapati ₹10 · Without Oil Chapati ₹9 · Phulka ₹8 · Ghee Phulka ₹11 · Jowar/Bajra Bhakri ₹22<br>🥘 <strong>Sabji</strong>: Mini 100ml ₹24 · Full 250ml ₹48 (changes daily)<br>🍲 <strong>Dal</strong> 200ml ₹24 · <strong>Dal Fry</strong> 200ml ₹40 · <strong>Rice</strong> 100g ₹13 · <strong>Salad</strong> 40g ₹8 · <strong>Curd</strong> 50g ₹13<br>🌅 <strong>Breakfast</strong>: Rotating daily items (₹35–₹70) — Poha, Upma, Paratha &amp; more.\" }",
    "{ q: \"What's included in your meals?\", a: \"We follow a <strong>Make Your Own Meal</strong> model — pick exactly what you want (Lunch &amp; Dinner):<br>🫓 <strong>Breads</strong>: Chapati ₹10 · Without Oil Chapati ₹9 · Phulka ₹8 · Ghee Phulka ₹11 · Jowar/Bajra Bhakri ₹22<br>🥘 <strong>Sabji</strong>: Mini 100ml ₹24 · Full 250ml ₹48 (changes daily)<br>🍲 <strong>Dal</strong> 200ml ₹24 · <strong>Dal Fry</strong> 200ml ₹40 · <strong>Rice</strong> 100g ₹13 · <strong>Salad</strong> 40g ₹8 · <strong>Curd</strong> 50g ₹13.\" }");
rep('{ q: "What are the order cutoff times?", a: "Breakfast: before 7:00 AM · Lunch: before 9:00 AM · Dinner: before 4:30 PM. Cutoff times are strictly for same-day delivery. Kitchen is closed on Sundays." }',
    '{ q: "What are the order cutoff times?", a: "Lunch: before 9:00 AM · Dinner: before 4:30 PM. Cutoff times are strictly for same-day orders. Kitchen is closed on Sundays." }');

// ── i18n strings ──
rep('"Each meal (Breakfast, Lunch, Dinner) can go to a different address - breakfast at home, lunch at the office."',
    '"One address for all your meals — Wing, Flat and Society at Ganga Serio."');
rep('"Breakfast orders close at 7:00 AM - order the night before to be safe."',
    '"Lunch orders close at 9:00 AM and Dinner at 4:30 PM - order the night before to be safe."');
rep('"Breakfast items have fixed prices - mix and match Poha, Upma, Idli, and more."',
    '"Lunch and Dinner items have fixed prices - mix and match Chapati, Sabji, Dal, Rice, and more."');

// ── addresses & pickup links ──
rep('<p><strong>Address:</strong> A 104, Shree laxmi vihar society</p>',
    '<p><strong>Address:</strong> G2 804, Ganga Serio, Kharadi</p>');
rep('https://maps.app.goo.gl/FnkeWh9KbaQkstrW8', 'https://maps.app.goo.gl/fLcdt8qMhm6VhnLXA');
rep('A 104, Shree Laxmi Vihar Society, Bhosale Nagar, Hadapsar, Pune 411028', 'G2 804, Ganga Serio, Kharadi, Pune 411014');
rep('const PICKUP_ADDRESS = "A 104, Shree Laxmi Vihar Society, Hadapsar";', 'const PICKUP_ADDRESS = "G2 804, Ganga Serio, Kharadi";');
rep('"Self Pickup (A 104, Shree laxmi vihar society)"', '"Self Pickup (G2 804, Ganga Serio, Kharadi)"');
rep('Pickup from: <b>A 104, Shree Laxmi Vihar Society, Bhosale Nagar, Hadapsar</b>', 'Pickup from: <b>G2 804, Ganga Serio, Kharadi</b>');
rep('"Self Pickup (A 104, Shree laxmi vihar society, Hadapsar)"', '"Self Pickup (G2 804, Ganga Serio, Kharadi)"');

fs.writeFileSync(p, c);
console.log("batch2 applied " + n + ", missed " + miss.length);
miss.forEach(m => console.log("  MISS: " + m));
