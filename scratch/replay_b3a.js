// REPLAY batch 3 — address page HTML + JS (wing/society/area rebuild)
const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let c = fs.readFileSync(p, "utf8");
let n = 0, miss = [];
function rep(a, b) { if (c.includes(a)) { c = c.split(a).join(b); n++; } else miss.push(a.slice(0, 70)); }

// ── HTML: banner + same-addr toggle ──
rep(`        <!-- Same for all toggle -->
        <label class="same-addr-row" id="sameAddrToggleRow" style="margin-bottom:16px;">`,
`        <!-- LS storefront notice: pickup now, doorstep delivery coming soon -->
        <div style="display:flex;gap:10px;align-items:flex-start;background:#eef6ff;border:1.5px solid #bcd9f7;border-radius:12px;padding:12px 14px;margin-bottom:16px;">
          <span style="font-size:1.15rem;line-height:1;">🛵</span>
          <div style="font-size:0.82rem;color:#1c4d80;line-height:1.55;">
            <strong>Doorstep delivery is launching here soon!</strong><br>
            For now, <strong>📦 Self Pickup</strong> is available. We're saving your wing &amp; flat details below so you're all set from day one — we'll notify you the moment doorstep delivery starts.
          </div>
        </div>

        <!-- Same for all toggle (hidden on LS — one fixed drop location) -->
        <label class="same-addr-row" id="sameAddrToggleRow" style="margin-bottom:16px;display:none;">`);

// ── HTML: delivery-mode toggle hide ──
rep(`        <div id="singleAddrBlock">
          <div class="delivery-mode-toggle">
            <button type="button" class="dm-btn active" id="dm_delivery_single"
              onclick="setDeliveryMode('single','delivery')"><span>🚚</span> Delivery</button>
            <button type="button" class="dm-btn" id="dm_pickup_single"
              onclick="setDeliveryMode('single','pickup')"><span>📦</span> Self Pickup</button>
          </div>`,
`        <div id="singleAddrBlock">
          <!-- LS storefront: Delivery/Pickup toggle removed — single fixed zone (Kharadi) -->
          <div class="delivery-mode-toggle" style="display:none;">
            <button type="button" class="dm-btn active" id="dm_delivery_single"
              onclick="setDeliveryMode('single','delivery')"><span>🚚</span> Delivery</button>
            <button type="button" class="dm-btn" id="dm_pickup_single"
              onclick="setDeliveryMode('single','pickup')"><span>📦</span> Self Pickup</button>
          </div>`);

// ── HTML: area select → Kharadi locked ──
rep(`<label data-i18n="label_area">Delivery Area *</label>
              <select id="areaSelect" onchange="syncSingleAddr()">
                <option value="" data-i18n="select_area_ph">— Select area —</option>
                <option value="Bhosale Nagar">Bhosale Nagar (Free Delivery)</option>
                <option value="Magarpatta">Magarpatta</option>
                <option value="Amanora">Amanora Town</option>
                <option value="DP Road">DP Road</option>
                <option value="Self Pickup">📦 Self Pickup (No Charges)</option>
              </select>`,
`<label>Delivery Area</label>
              <!-- LS storefront: single fixed area (Kharadi), read-only -->
              <select id="areaSelect" onchange="syncSingleAddr()" disabled style="background:#f4f4f2;color:#555;">
                <option value="Kharadi" selected>Kharadi</option>
              </select>`);

// ── HTML: wing dropdown + flat label ──
rep(`<label data-i18n="label_wing">Wing / Block</label>
                <input type="text" id="wingInput" placeholder="A / B1" oninput="syncSingleAddr()">`,
`<label>Wing</label>
                <!-- LS storefront: fixed wing list -->
                <select id="wingInput" onchange="syncSingleAddr(); _lsSyncSociety('')">
                  <option value="">— Select wing —</option>
                  <option value="A">A</option><option value="B">B</option>
                  <option value="C">C</option><option value="D">D</option>
                  <option value="E1">E1</option><option value="E2">E2</option>
                  <option value="F1">F1</option><option value="F2">F2</option>
                  <option value="G1">G1</option><option value="G2">G2</option>
                </select>`);
rep('<label data-i18n="label_flat">Flat / Office No.</label>\n                <input type="text" id="flatInput" placeholder="e.g. 104, Office 5" oninput="syncSingleAddr()">',
    '<label>Flat No.</label>\n                <input type="text" id="flatInput" placeholder="e.g. 104" oninput="syncSingleAddr()">');

// ── HTML: society readonly + label ──
rep(`<label data-i18n="label_society">Society / Building / Office Park *</label>
              <input type="text" id="societyInput" placeholder="e.g. Pentagon 1, Magarpatta" oninput="syncSingleAddr()">`,
`<label>Society</label>
              <!-- LS storefront: auto-set from wing — A/B/C/D → Liviano, E1–G2 → Serio -->
              <input type="text" id="societyInput" placeholder="" readonly style="background:#f4f4f2;color:#555;" oninput="syncSingleAddr()">`);

// ── HTML: maps + landmark groups hidden ──
rep(`<div class="form-group">
              <label><span data-i18n="label_maps">📍 Google Maps Pin Link</span> <span
                  style="font-size:0.7rem;color:#aaa;" data-i18n="label_optional">(optional)</span></label>
              <input type="url" id="mapsInput" placeholder="Paste your Google Maps link here…"
                oninput="syncSingleAddr(); _mapsLinkFeedback(this)">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label><span data-i18n="label_landmark">🏷️ Landmark / Directions</span> <span
                  style="font-size:0.7rem;color:#aaa;" data-i18n="label_optional">(optional)</span></label>
              <input type="text" id="landmarkInput" placeholder="e.g. Opposite Reliance Fresh, Gate no. 2"
                oninput="syncSingleAddr()">
            </div>`,
`<!-- LS storefront: Maps pin + Landmark removed (single known location) -->
            <div class="form-group" style="display:none;">
              <label><span data-i18n="label_maps">📍 Google Maps Pin Link</span> <span
                  style="font-size:0.7rem;color:#aaa;" data-i18n="label_optional">(optional)</span></label>
              <input type="url" id="mapsInput" placeholder="Paste your Google Maps link here…"
                oninput="syncSingleAddr(); _mapsLinkFeedback(this)">
            </div>
            <div class="form-group" style="display:none;margin-bottom:0;">
              <label><span data-i18n="label_landmark">🏷️ Landmark / Directions</span> <span
                  style="font-size:0.7rem;color:#aaa;" data-i18n="label_optional">(optional)</span></label>
              <input type="text" id="landmarkInput" placeholder="e.g. Opposite Reliance Fresh, Gate no. 2"
                oninput="syncSingleAddr()">
            </div>`);

fs.writeFileSync(p, c);
console.log("batch3a applied " + n + ", missed " + miss.length);
miss.forEach(m => console.log("  MISS: " + m));
