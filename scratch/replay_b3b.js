// REPLAY batch 3b — JS address logic (replaces v1 _lsPinSocietyInputs)
const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let c = fs.readFileSync(p, "utf8");
let n = 0, miss = [];
function rep(a, b) { if (c.includes(a)) { c = c.split(a).join(b); n++; } else miss.push(a.slice(0, 70)); }

// ── v1 pin function → full suite ──
rep(`    // ══ LS STOREFRONT: pin the society inputs to the drop location ═════════
    // Prefills + locks all four society fields; runs at boot and re-asserts
    // after any address prefill (saved profile / archived-address restore).
    function _lsPinSocietyInputs() {
      ["societyInput", "bf_societyInput", "l_societyInput", "d_societyInput"].forEach(function (id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = LS_SOCIETY_NAME;
        el.readOnly = true;
        el.style.background = "#f4f4f2";
      });
      if (S.profile) S.profile.society = LS_SOCIETY_NAME;
    }`,
`    // ══ LS STOREFRONT: fixed-address logic ══════════════════════════════════
    // Area locked to Kharadi; Wing is a dropdown (A–G2); Society auto-set from
    // wing (A/B/C/D → Liviano, E1/E2/F1/F2/G1/G2 → Serio); Maps + Landmark and
    // the per-meal/same-address toggle are removed (single delivery zone).
    const LS_WING_OPTS = ["A","B","C","D","E1","E2","F1","F2","G1","G2"];
    const LS_LIVIANO_WINGS = ["A","B","C","D"];
    function _lsSocietyForWing(w) {
      w = String(w || "").trim().toUpperCase();
      if (!w) return "";
      return LS_LIVIANO_WINGS.indexOf(w) !== -1 ? "Liviano" : "Serio";
    }
    function _lsSyncSociety(prefix) {
      const wingEl = document.getElementById(prefix + "wingInput");
      const socEl  = document.getElementById(prefix + "societyInput");
      if (!socEl) return;
      socEl.value = _lsSocietyForWing(wingEl ? wingEl.value : "");
      socEl.readOnly = true;
      socEl.style.background = "#f4f4f2";
      socEl.style.color = "#555";
    }
    function _lsPinSocietyInputs() {
      ["", "bf_", "l_", "d_"].forEach(pfx => {
        const el = document.getElementById(pfx + "areaSelect");
        if (!el) return;
        if (!el.querySelector('option[value="Kharadi"]')) {
          el.innerHTML = '<option value="Kharadi">Kharadi</option>';
        }
        el.value = "Kharadi";
        el.disabled = true;
        el.style.background = "#f4f4f2";
        el.style.color = "#555";
      });
      ["", "bf_", "l_", "d_"].forEach(pfx => {
        const el = document.getElementById(pfx + "wingInput");
        if (!el || el.tagName !== "INPUT") return;
        const sel = document.createElement("select");
        sel.id = el.id;
        sel.className = el.className;
        sel.style.cssText = el.style.cssText;
        sel.onchange = el.oninput;
        el.parentNode.replaceChild(sel, el);
      });
      ["", "bf_", "l_", "d_"].forEach(pfx => {
        const el = document.getElementById(pfx + "wingInput");
        if (!el || el.tagName !== "SELECT" || el.options.length) return;
        el.innerHTML = '<option value="">— Select wing —</option>' +
          LS_WING_OPTS.map(w => '<option value="' + w + '">' + w + '</option>').join("");
      });
      ["", "bf_", "l_", "d_"].forEach(pfx => _lsSyncSociety(pfx));
      ["", "bf_", "l_", "d_"].forEach(pfx => {
        ["mapsInput", "landmarkInput"].forEach(f => {
          const el = document.getElementById(pfx + f);
          if (el && el.closest(".form-group")) el.closest(".form-group").style.display = "none";
        });
      });
      const toggleRow = document.getElementById("sameAddrToggleRow");
      if (toggleRow) toggleRow.style.display = "none";
      const chk = document.getElementById("sameAddrCheck");
      if (chk) chk.checked = true;
      if (typeof S !== "undefined") {
        S.sameAddr = true;
        const pm = document.getElementById("perMealAddrBlock");
        const sa = document.getElementById("singleAddrBlock");
        if (pm) pm.style.display = "none";
        if (sa) sa.style.display = "block";
      }
    }`);

// ── validate: wing required + society from wing + area fallback ──
rep(`          const area = $("areaSelect").value;
          if (!area) { toast(t('toast_area')); return false; }
          const isPickup = (area === "Self Pickup");
          const society = $("societyInput").value.trim();`,
`          // LS storefront: area is a locked single zone — never block on it
          const area = $("areaSelect").value || "Kharadi";
          const isPickup = false; // LS: toggle removed; delivery rules handled by storefront
          // LS storefront: society auto-set from the selected wing
          const _lsWing = $("wingInput").value;
          if (!_lsWing) { toast("Please select your Wing"); try { $("wingInput").focus(); } catch (_) {} return false; }
          const society = _lsSocietyForWing(_lsWing);`);

// ── syncSingleAddr: society from wing ──
rep(`      S.profile.society = _fld("societyInput", S.profile.society);`,
`      // LS storefront: society auto-set from the selected wing (A–D → Liviano, rest → Serio)
      S.profile.society = _lsSocietyForWing($("wingInput") ? $("wingInput").value : "");`);

// ── readPerMealAddr: society from wing ──
rep(`        society: $(pfx + "_societyInput")?.value.trim() || "",`,
`        // LS storefront: society auto-set from the wing of that block
        society: _lsSocietyForWing($(pfx + "_wingInput")?.value),`);

// ── remove LS_SOCIETY_NAME const (no longer used) ──
rep(`    const LS_SOCIETY_NAME = "Liviano Serio";
    const LS_FREE_DELIVERY = true; // mirrors backend LS_FREE_DELIVERY — keep in sync`,
`    const LS_FREE_DELIVERY = true; // mirrors backend LS_FREE_DELIVERY — keep in sync`);

fs.writeFileSync(p, c);
console.log("batch3b applied " + n + ", missed " + miss.length);
miss.forEach(m => console.log("  MISS: " + m));
