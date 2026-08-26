
    const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W/exec";
    const APP_VERSION = "v26.07.31.03";
    (function() {
      const savedVer = localStorage.getItem("sk_admin_ver");
      if (savedVer !== APP_VERSION) {
        localStorage.setItem("sk_admin_ver", APP_VERSION);
        location.reload(true);
      }
    })();
    setInterval(async function() {
      try {
        const res = await fetch(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
        const html = await res.text();
        const m = html.match(/const APP_VERSION = "([^"]+)"/);
        if (m && m[1] !== APP_VERSION) location.reload(true);
      } catch (e) {}
    }, 15 * 60 * 1000);
    document.addEventListener("visibilitychange", async function() {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
          const html = await res.text();
          const m = html.match(/const APP_VERSION = "([^"]+)"/);
          if (m && m[1] !== APP_VERSION) location.reload(true);
        } catch (e) {}
      }
    });
    
    // ── FETCH WITH TIMEOUT (Timeout removed per user request: let request take whatever time it needs) ──
    async function fetchWithTimeout(url, options = {}, timeoutMs) {
      const fetchOpts = typeof options === 'number' ? {} : options;
      return fetch(url, fetchOpts);
    }

    let K = { pin: "", sessionPin: "" };
    let _lastData = null;
    let _lastCutoffs = {};
    let _currentTab = "Summary";
    let _manualMeal = null; // null means auto-detect based on time

    // ── RATE LIMITING ──
    let attempts = 0;
    let lockoutEnd = 0;
    function isLocked() {
      if (Date.now() < lockoutEnd) {
        const s = Math.ceil((lockoutEnd - Date.now()) / 1000);
        document.getElementById("kErr").textContent = `Too many attempts. Wait ${s}s.`;
        return true;
      }
      if (lockoutEnd !== 0) {
        lockoutEnd = 0; attempts = 0;
        document.getElementById("kErr").textContent = "";
      }
      return false;
    }

    // ── PIN ──
    let pinAuthInProgress = false;
    function kp(n) {
      if (isLocked() || pinAuthInProgress) return;
      if (K.pin.length >= 4) return;
      K.pin += String(n);
      renderDots();
      if (K.pin.length === 4) verifyPin();
    }
    function kd() {
      if (pinAuthInProgress) return;
      K.pin = K.pin.slice(0, -1);
      renderDots();
      document.getElementById("kErr").textContent = "";
    }
    function renderDots() {
      for (let i = 0; i < 4; i++) document.getElementById("kd" + i).classList.toggle("filled", i < K.pin.length);
    }

    async function logout() {
      if (!await sConfirm("Are you sure you want to logout?", "Logout", "🔐")) return;
      localStorage.removeItem('sk-kitchen-pin');
      window.location.reload();
    }

    async function verifyPin(autoPin) {
      if (isLocked()) return;
      if (!autoPin) {
        document.getElementById("kErr").textContent = "Logging you in...";
        pinAuthInProgress = true;
        sLoading(true, "Logging you in...");
      }

      const pinToVerify = autoPin || K.pin;
      try {
        const fetchDate = document.getElementById("datePicker").value || todayIST();
        const res = await fetchWithTimeout(`${APPS_SCRIPT_URL}?action=getKitchenSummary&date=${fetchDate}&pin=${pinToVerify}&_t=${Date.now()}`);
        const data = await res.json();
        if (data.error) {
          if (!autoPin) {
            K.pin = ""; renderDots();
            document.getElementById("kErr").textContent = "Incorrect PIN";
          } else {
            localStorage.removeItem('sk-kitchen-pin');
          }
          return;
        }
        // PIN valid
        attempts = 0;
        K.sessionPin = pinToVerify;
        localStorage.setItem('sk-kitchen-pin', pinToVerify);

        K.pin = ""; renderDots();
        document.getElementById("loginWrap").style.display = "none";
        document.getElementById("shell").style.display = "block";
        _lastData = data;
        _lastCutoffs = data.cutoffs || {};
        switchKTab(_currentTab);
        _lastUpdated = new Date();
        startAutoRefresh();
        // Pull the global label-gap value (shared across all kitchen devices)
        // so the Labels tab uses the same spacing everyone else is using.
        try { fetchLabelGap(); } catch(_) {}
      } catch (e) {
        if (autoPin) {
          localStorage.removeItem('sk-kitchen-pin');
          document.getElementById("kErr").textContent = "Auto-login failed — please enter PIN manually";
        } else {
          document.getElementById("kErr").textContent = e.name === 'AbortError'
            ? "Connection timed out — please try again"
            : "Incorrect PIN";
        }
        K.pin = ""; renderDots();
      } finally {
        pinAuthInProgress = false;
        sLoading(false);
      }
    }

    function todayIST() {
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 3600000);
      const h = ist.getUTCHours();
      if (h >= 21) {
        ist.setUTCDate(ist.getUTCDate() + 1);
      }
      return ist.toISOString().slice(0, 10);
    }

    async function loadKitchen() {
      const date = document.getElementById("datePicker").value;
      if (!date) { await sAlert("Please select a date first.", "Date Required", "📅"); return; }
      sLoading(true, "Fetching data...");
      try {
        const res = await fetchWithTimeout(`${APPS_SCRIPT_URL}?action=getKitchenSummary&date=${date}&pin=${K.sessionPin}&_t=${Date.now()}`, { redirect: "follow", cache: "no-store" });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        _lastData = data;
        _lastCutoffs = data.cutoffs || {};
        renderView();
        _lastUpdated = new Date();
        // Re-schedule auto-label fires now that we have today's cutoffs.
        try { scheduleAutoLabels(); } catch(_) {}
      } catch (e) {
        document.getElementById("kbody").innerHTML = `<div class="no-orders" style="color:#c0392b;">${e.message}</div>`;
      } finally {
        sLoading(false);
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // AUTO LABEL TRIGGER — fires 5 min after Lunch / Dinner cutoff
    // ════════════════════════════════════════════════════════════════════
    // Reads today's cutoffs from _lastCutoffs (admin-set per day in Daily
    // Menu, falling back to defaults Breakfast=7 / Lunch=9 / Dinner=16.5)
    // and schedules timers to auto-fire the label-generate + save-to-drive
    // flow exactly the same way staff do manually. Same Drive folder, same
    // PDF format. localStorage keeps track of "already fired today" so a
    // page refresh after the fire doesn't trigger a duplicate.
    //
    // Catches up automatically: if the kitchen tab is opened AFTER the
    // trigger time but the labels haven't been fired today yet, fires
    // immediately. Plays a small chime + toast so staff know it ran.
    const AUTO_LABEL_MEALS = ["Lunch", "Dinner"]; // Breakfast skipped per spec
    const AUTO_LABEL_DELAY_MIN = 5;               // fire N min after cutoff
    let _autoLabelTimers = {};

    function _autoLabelKey(date, meal) { return "sk_autolabel_" + date + "_" + meal; }
    function _autoLabelFiredAlready(date, meal) {
      try { return !!localStorage.getItem(_autoLabelKey(date, meal)); } catch(_) { return false; }
    }
    function _autoLabelMarkFired(date, meal) {
      try { localStorage.setItem(_autoLabelKey(date, meal), String(Date.now())); } catch(_) {}
    }

    // Returns the local Date object for today @ (cutoffHours + 5min) IST.
    // Assumes the kitchen device's local time is IST (which it always is).
    function _autoLabelTriggerAt(cutoffHours) {
      const total = cutoffHours + (AUTO_LABEL_DELAY_MIN / 60);
      const h = Math.floor(total);
      const m = Math.round((total - h) * 60);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d;
    }

    function scheduleAutoLabels() {
      // Clear any existing timers (we may be called multiple times per day)
      Object.values(_autoLabelTimers).forEach(t => { try { clearTimeout(t); } catch(_) {} });
      _autoLabelTimers = {};

      const today = todayIST();
      const datePicker = document.getElementById("datePicker");
      // Only auto-fire if the kitchen view is on TODAY. If staff is browsing
      // a future or past date, leave them alone — they're inspecting.
      if (datePicker && datePicker.value && datePicker.value !== today) {
        console.log("[AutoLabel] Date picker on " + datePicker.value + " (not today) — skipping schedule");
        return;
      }

      const cutoffs = {
        Lunch:  Number(_lastCutoffs.Lunch)  || 9,
        Dinner: Number(_lastCutoffs.Dinner) || 16.5
      };
      const now = new Date();

      AUTO_LABEL_MEALS.forEach(meal => {
        if (_autoLabelFiredAlready(today, meal)) {
          console.log("[AutoLabel] " + meal + " already fired today — skipping");
          return;
        }
        const triggerAt = _autoLabelTriggerAt(cutoffs[meal]);
        const delay = triggerAt - now;
        if (delay <= 0) {
          // Trigger time has already passed today but we haven't fired yet —
          // catch up immediately (e.g., kitchen device was off at cutoff).
          console.log("[AutoLabel] " + meal + " trigger past (was at "
            + triggerAt.toTimeString().slice(0,5) + ") — firing now");
          autoFireLabel(today, meal);
        } else {
          _autoLabelTimers[meal] = setTimeout(() => autoFireLabel(today, meal), delay);
          console.log("[AutoLabel] " + meal + " scheduled at "
            + triggerAt.toTimeString().slice(0,5) + " (in " + Math.round(delay/60000) + " min)");
        }
      });
    }

    async function autoFireLabel(date, meal) {
      if (_autoLabelFiredAlready(date, meal)) return;  // double-guard
      _autoLabelMarkFired(date, meal);                  // claim slot first to prevent races

      console.log("[AutoLabel] Firing " + meal + " for " + date);

      // Remember where staff was BEFORE we hijack the view. We restore
      // this tab once the auto-save finishes (success, no-orders, or
      // failure) so a page refresh / scheduled fire doesn't leave them
      // stranded on the Labels tab.
      const _prevTab = _currentTab;
      let _switchedAway = false;

      try {
        // Switch to Labels tab so the form is rendered.
        if (typeof switchKTab === "function" && _currentTab !== "Labels") {
          switchKTab("Labels");
          _switchedAway = true;
          // Let the tab finish rendering before we poke its inputs.
          await new Promise(r => setTimeout(r, 700));
        }

        const dEl    = document.getElementById("bulkLabelDate");
        const mEl    = document.getElementById("bulkLabelMeal");
        const modeEl = document.getElementById("bulkLabelMode");
        if (!dEl || !mEl) {
          console.warn("[AutoLabel] Labels tab form not rendered — clearing fire flag for retry");
          try { localStorage.removeItem(_autoLabelKey(date, meal)); } catch(_) {}
          return;
        }

        dEl.value = date;
        mEl.value = meal;
        if (modeEl) modeEl.value = "Actual"; // never auto-fire Test mode

        // Generate (fetches orders + renders preview + populates _bulkLabelOrders)
        await generateBulkLabels();

        if (!_bulkLabelOrders || !_bulkLabelOrders.length) {
          console.log("[AutoLabel] No " + meal + " orders for " + date + " — nothing to save");
          if (typeof toast === "function") toast("Auto-label: no " + meal + " orders today, nothing to save", 5000);
          return;
        }

        // Save (builds PDF + uploads to Drive — same flow as the Save button)
        await saveBulkLabelsToDrive();

        // Audible chime + visible toast
        try {
          // Short pleasant beep (data-URI generated tone)
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 880;
          g.gain.value = 0.15;
          o.connect(g); g.connect(ctx.destination);
          o.start(); o.stop(ctx.currentTime + 0.18);
          setTimeout(() => { try { ctx.close(); } catch(_){} }, 400);
        } catch(_) { /* audio blocked — fine, toast still shows */ }
        if (typeof toast === "function") toast("✅ " + meal + " labels auto-generated and saved to Drive", 7000);
      } catch (e) {
        console.error("[AutoLabel] Failed for " + date + " " + meal + ": " + (e && e.message));
        // Clear the fired flag so the next loadKitchen tick (5-min auto-refresh)
        // tries again. Staff also see a toast prompting manual generation.
        try { localStorage.removeItem(_autoLabelKey(date, meal)); } catch(_) {}
        if (typeof toast === "function") toast("⚠️ Auto-label failed for " + meal + " — please generate manually", 9000);
      } finally {
        // Restore the tab staff was on before we hijacked the view.
        // Without this, a refresh after lunch/dinner cutoff would leave
        // staff stranded on Labels even if they were viewing Summary.
        if (_switchedAway && _prevTab && _prevTab !== "Labels" && typeof switchKTab === "function") {
          try { switchKTab(_prevTab); } catch(_) {}
        }
      }
    }

    // ── Marathi display names ──
    const MR = {
      // Rotis
      "Chapati": "चपाती", "Without Oil Chapati": "विना तेल चपाती", "Without_Oil_Chapati": "विना तेल चपाती",
      "Phulka": "फुलका", "Ghee Phulka": "तूप फुलका", "Ghee_Phulka": "तूप फुलका",
      "Jowar Bhakri": "ज्वारी भाकरी", "Jowar_Bhakri": "ज्वारी भाकरी", "Bajra Bhakri": "बाजरी भाकरी", "Bajra_Bhakri": "बाजरी भाकरी",
      "Dry Sabji": "सुकी भाजी", "Curry Sabji": "रस्सा भाजी",
      "Sabji (Dry)": "सुकी भाजी", "Sabji (Curry)": "रस्सा भाजी",
      "Dal": "वरण", "Dal Fry": "दाल फ्राय", "Dal_Fry": "दाल फ्राय", "Dal [200ml]": "वरण (२००ml)", "Dal Fry [200ml]": "दाल फ्राय (२००ml)", "Rice": "भात", "Rice [100g]": "भात (१००g)", "Salad": "सलाड", "Salad [40g]": "सलाड (४०g)", "Curd": "दही", "Curd [50g]": "दही (५०g)", 
      "Kanda Poha": "कांदा पोहे", "Kanda Poha [175g]": "कांदा पोहे [१७५g]", 
      "Sabudana Khichdi": "साबुदाणा खिचडी", "Sabudana Khichdi [200g]": "साबुदाणा खिचडी [२००g]",
      "Ghee Upma": "तुपातील उपमा", "Ghee Upma [200g]": "तुपातील उपमा [२००g]",
      "Upma": "उपमा", "Poha": "पोहे",
      "Thalipeeth": "थालीपीठ", "Aloo Paratha": "आलू पराठा", "Tikhi Puri": "तिखी पुरी", 
      "5 x Tikhi Pudi with 100 ml coriander chutney": "५ x तििख पुरी आणि १००ml चटणी",
      "Paneer Paratha": "पनीर पराठा",
      "Ghee Sheera": "घी शिरा", "Ghee Sheera [200g]": "घी शिरा [२००g]",
      "Palak Paratha (2 peices)": "पालक पराठा (२ पीसेस)", "Methi Paratha (2 pieces)": "मेथी पराठा (२ पीसेस)",
      "4 x Idli & 100ml Chutney": "४ x इडली आणि १००ml चटणी",
      "4 x Idli and 100ml Chutney": "४ x इडली आणि १००ml चटणी", "Chutney": "चटणी",
      "orders": "ऑर्डर",
      // Specific Sabjis
      "Cauliflower": "फ्लॉवर", "flower": "फ्लॉवर", "French Beans": "फरसबी", "Cabbage": "कोबी", "Bhindi": "भेंडी",
      "Bhendi Fry": "भेंडी", "Potato": "बटाटा", "Aloo": "बटाटा", "Matki": "मटकी", "bata": "बटाटा",
      "Mataki": "मटकी", "Matki (Dry)": "मटकी सुकी", "Matki (Curry)": "मटकी रस्सा", "Matki masala": "मटकी मसाला",
      "Soyabean": "सोयाबीन", "soyabean": "सोयाबीन", "Gavari": "गवार", "gavar": "गवार", "Pithla": "पिठलं", "Akha Masoor": "अख्खा मसूर",
      "Dal kanda": "डाळ कांदा", "Dal Kanda": "डाळ कांदा", "Sev tomato": "शेव टोमॅटो", "Shev tomato": "शेव टोमॅटो",
      "Shimla Besan": "ढोबळी बेसन", "Shimla besan": "ढोबळी बेसन", "Palak corn": "पालक कॉर्न", "Green moong": "हिरवा मूग",
      "Green Moong": "हिरवा मूग", "hirva moong": "हिरवा मूग", "Kofta": "कोफ्ता", "kofta": "कोफ्ता", "Methi": "मेथी", "Aloo Matar": "बटाटा मटार",
      "Batata": "बटाटा", "Shepu": "शेपू", "Tondli": "तोंडली", "Vatana": "वटाणा",
      "Mix Veg": "मिक्सव्हेज", "Mix veg": "मिक्सव्हेज", "Paneer": "पनीर", "Chavali": "चवळी", "Chowli": "चवळी", "Ghee": "तूप", "Kanda besan": "कांदा बेसन",
      "Kala chana": "काळा चणा", "Kala Chana": "काळा चणा",
      // Items for summary
      "Standard Tiffin": "साधी थाळी",
      "No ring the bell": "बेल वाजवू नका",
      "None": "-", "-": "-", "": "-"
    };
    function mr(name) { return MR[name] || name; }

    const SABJI_WEIGHTS = {
      // Dry Sabjis
      "Cauliflower": { "फ्लॉवर": 90, "टोमॅटो": 20, "मटार": 10 },
      "Cabbage": 70, "Bhindi": 100,
      "French Beans": 80, "French_Beans": 80,
      "Beans": 80, "Matki masala": 55,
      "Shimla Besan": { "ढोबळी": 75 }, "Sev tomato": { "टोमॅटो": 80, "कांदा": 20 },
      "Dal kanda": { "डाळ": 34, "कांदा": 21, "टोमॅटो": 21 },
      "Green Moong Masala(Dry)": 30, "Green Moong": 30,

      // Curry Sabjis
      "Soyabean": 10, "Gavari": 42, "Matki (Curry)": 34, "Pithla": { "बेसन": 23 },
      "Akha Masoor": 27, "Kofta": { "दुधी": 100, "कोफ्ता गोळे": 10 },
      "Green moong (Curry)": 27
    };
    function normalizeName(n) { return (n || "").trim().toLowerCase().replace(/_/g, " "); }

    function getWeight(name, mini, full) {
      const normalized = normalizeName(name);
      const totalUnits = ((mini || 0) * 0.6) + ((full || 0) * 1.4);

      // ── KOFTA: special per-size kofta-count model (not the generic unit-weight) ──
      // Each mini portion = 1.5 koftas, each full = 3 koftas (round each size, then sum).
      // 100 g दुधी yields 10 koftas → 10 g दुधी per kofta.
      //   e.g. 11 mini, 9 full → round(11×1.5)=17 + round(9×3)=27 = 44 koftas → 440 g दुधी.
      if (normalized === "kofta") {
        const koftas = Math.round((mini || 0) * 1.5) + Math.round((full || 0) * 3);
        const dudhiG = koftas * 10;
        const rows = [
          `<div style="font-size:1.6rem; line-height:1.2; margin-bottom:4px; white-space:nowrap;">
            <span style="color:#aaa; font-size:1.1rem; display:block; margin-bottom:-5px;">दुधी:</span>
            <span style="font-weight:700;">${dudhiG} g</span>
          </div>`,
          `<div style="font-size:1.6rem; line-height:1.2; margin-bottom:4px; white-space:nowrap;">
            <span style="color:#aaa; font-size:1.1rem; display:block; margin-bottom:-5px;">कोफ्ता गोळे:</span>
            <span style="font-weight:700;">${koftas} नग</span>
          </div>`
        ];
        return { val: rows.join(""), unit: "एकूण वजन (तयार करण्यासाठी)" };
      }

      let w = null;
      for (let key in SABJI_WEIGHTS) {
        if (normalizeName(key) === normalized) {
          w = SABJI_WEIGHTS[key];
          break;
        }
      }

      const fmtWeight = (g) => Math.round(g) + " g";

      if (!w || w === 0) {
        // No gram data — just show unit count so staff can manage
        return { val: totalUnits.toFixed(1), unit: "युनिट (मोजणी)" };
      }

      if (typeof w === "number") {
        return { val: fmtWeight(totalUnits * w), unit: "एकूण वजन (तयार करण्यासाठी)" };
      } else {
        // Multi-ingredient breakdown
        let rows = [];
        for (let ing in w) {
          rows.push(`<div style="font-size:1.6rem; line-height:1.2; margin-bottom:4px; white-space:nowrap;">
            <span style="color:#aaa; font-size:1.1rem; display:block; margin-bottom:-5px;">${ing}:</span>
            <span style="font-weight:700;">${fmtWeight(totalUnits * w[ing])}</span>
          </div>`);
        }
        return { val: rows.join(""), unit: "एकूण वजन (तयार करण्यासाठी)" };
      }
    }

    // ── RENDER ──
    function getCurrentMeal() {
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 3600000);
      const h = ist.getUTCHours();
      const m = ist.getUTCMinutes();
      const timeInMins = h * 60 + m;

      // Breakfast: 00:00 to 8:45 (525)
      if (timeInMins < 525) return "Breakfast";
      // Lunch: 8:45 (525) to 14:00 (840)
      if (timeInMins >= 525 && timeInMins < 840) return "Lunch";
      // Dinner: 14:00 (840) to 21:00 (1260)
      if (timeInMins >= 840 && timeInMins < 1260) return "Dinner";

      // Post-21:00 (prep for tomorrow's Breakfast)
      return "Breakfast";
    }

    let _showAllMeals = false;

    function switchKTab(tab) {
      document.querySelectorAll(".ktab").forEach(el => el.classList.remove("active"));
      document.getElementById("tab_" + tab).classList.add("active");
      _currentTab = tab;

      if (_currentTab === "Summary") renderKitchen(_lastData);
      else if (_currentTab === "Packing") renderPacking(_lastData);
      else if (_currentTab === "Labels") renderLabelsTab();
      else if (_currentTab === "PrintLabel") renderPrintLabelsTab();
    }

    function renderView() {
      if (!_lastData) return;
      if (_currentTab === "Summary") renderKitchen(_lastData);
      else if (_currentTab === "Packing") renderPacking(_lastData);
      else if (_currentTab === "Labels") renderLabelsTab();
      else if (_currentTab === "PrintLabel") renderPrintLabelsTab();
    }

    let _dismissedCutoff = null;
    function getCutoffAlertHtml() {
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 3600000);
      const h = ist.getUTCHours();
      const m = ist.getUTCMinutes();
      const mins = h * 60 + m;
      const mmdd = `${ist.getUTCMonth()+1}${ist.getUTCDate()}`;

      let currentCutoff = null;
      if (mins >= 570 && mins <= 575) currentCutoff = `Lunch_${mmdd}`; // 9:30 AM - 9:35 AM
      else if (mins >= 1020 && mins <= 1025) currentCutoff = `Dinner_${mmdd}`; // 5:00 PM - 5:05 PM
      
      if (!currentCutoff || _dismissedCutoff === currentCutoff) return "";

      return `
        <div id="kitchenCutoffAlert" style="position:relative;background:linear-gradient(135deg,#fff8e1,#ffecb3);border:1px solid #ffe082;border-radius:12px;padding:16px;margin-bottom:16px;color:#d35400;box-shadow:0 4px 12px rgba(211,84,0,0.15);text-align:center;animation: pulseAlert 2s infinite;">
          <button onclick="dismissCutoffAlert('${currentCutoff}')" style="position:absolute;top:10px;right:12px;background:none;border:none;font-size:1.4rem;color:#d35400;cursor:pointer;line-height:1;">✕</button>
          <div style="font-size:1.8rem;margin-bottom:6px;">🔔</div>
          <div style="font-size:1.1rem;font-weight:900;">अंतिम मोजणी तयार आहे, तयारी पूर्ण करा आणि स्वयंपाक सुरू करा</div>
        </div>
        <style>
          @keyframes pulseAlert {
            0% { box-shadow: 0 0 0 0 rgba(211,84,0, 0.4); }
            70% { box-shadow: 0 0 0 12px rgba(211,84,0, 0); }
            100% { box-shadow: 0 0 0 0 rgba(211,84,0, 0); }
          }
        </style>
      `;
    }

    function dismissCutoffAlert(id) {
      _dismissedCutoff = id;
      const el = document.getElementById("kitchenCutoffAlert");
      if (el) el.style.display = "none";
    }

    function renderKitchen(data) {
      const meals = data.meals || {};
      let html = getCutoffAlertHtml();

      if (!Object.keys(meals).length) {
        html += `<div class="no-orders" style="display:flex;flex-direction:column;align-items:center;padding:40px;">
      <div style="font-size:3rem;margin-bottom:10px;">😴</div>
      No orders set for ${data.date}</div>`;
        document.getElementById("kbody").innerHTML = html;
        return;
      }

      const fmtDate = d => { const p = d.split("-"); return `${p[2]}/${p[1]}/${p[0]}`; };
      html += `<div style="text-align:center;font-size:0.78rem;color:#666;margin-bottom:14px;">📅 ${fmtDate(data.date)}</div>`;

      const MEAL_META = {
        Breakfast: { icon: "🌅", label: "न्याहारी" },
        Lunch: { icon: "☀️", label: "दुपारचे जेवण" },
        Dinner: { icon: "🌙", label: "रात्रीचे जेवण" },
      };

      const currentMeal = _manualMeal || getCurrentMeal();

      // Update meal tab UI
      document.querySelectorAll(".m-tab").forEach(el => {
        el.classList.remove("active", "auto");
        if (el.id === "mtab_" + currentMeal) {
          el.classList.add("active");
          if (!_manualMeal) el.classList.add("auto");
        }
      });

      if (!meals[currentMeal]) {
        document.getElementById("kbody").innerHTML = `<div class="no-orders" style="padding:40px; text-align:center;">🎉 No ${currentMeal} orders found for this date.</div>`;
        return;
      }

      const current_m = meals[currentMeal];
      const { icon, label } = MEAL_META[currentMeal];

      if (currentMeal === "Breakfast") {
        const bfEntries = Object.entries(current_m.items || {}).filter(([, q]) => q > 0);
        const bfHtml = bfEntries.length
          ? bfEntries.map(([name, qty]) =>
            `<div class="item-card"><span class="iname">${mr(name)}</span><span class="inum">${qty}</span></div>`
          ).join("")
          : `<div style="color:#555;font-size:0.82rem;padding:8px;">माहिती नाही</div>`;
        html += `<div class="meal-block">
        <div class="meal-head">
          <span class="meal-icon">${icon}</span>
          <span class="meal-title">${label}</span>
          <span class="meal-count">${current_m.count} ${mr('orders')}</span>
        </div>
        <div class="meal-body">
          <div class="item-grid">${bfHtml}</div>
        </div>
      </div>`;
      } else {
        const s = current_m.sabji;
        const rotiEntries = Object.entries(current_m.rotis).filter(([, q]) => q > 0);
        const rotiHtml = rotiEntries.length
          ? rotiEntries.map(([name, qty]) =>
            `<div class="item-card"><span class="iname">${mr(name)}</span><span class="inum">${qty}</span></div>`
          ).join("")
          : `<div class="item-card zero"><span class="iname">—</span><span class="inum">0</span></div>`;

        const showDry = (s.dry_name && s.dry_name !== "none") && ((s.dry_mini || 0) + (s.dry_full || 0) > 0);
        const showCurry = (s.curry_name && s.curry_name !== "none") && ((s.curry_mini || 0) + (s.curry_full || 0) > 0);

        const dRes = getWeight(s.dry_name, s.dry_mini, s.dry_full);
        const cRes = getWeight(s.curry_name, s.curry_mini, s.curry_full);

        const dryDisplayName = mr(s.dry_name);
        const curryDisplayName = mr(s.curry_name);

        const sabjiHtml = `
      <div class="sabji-cook-grid">
        ${showDry ? `
        <div class="sabji-cook-card">
          <div class="cook-label">🍴 <strong>${dryDisplayName}</strong></div>
          <div class="cook-val">${dRes.val}</div>
          <div class="cook-unit">${dRes.unit}</div>
          <div class="cook-breakdown">${s.dry_mini || 0}×0.6 + ${s.dry_full || 0}×1.4 = ${((s.dry_mini||0)*0.6+(s.dry_full||0)*1.4).toFixed(1)}</div>
        </div>` : ""}
        ${showCurry ? `
        <div class="sabji-cook-card">
          <div class="cook-label">🍲 <strong>${curryDisplayName}</strong></div>
          <div class="cook-val">${cRes.val}</div>
          <div class="cook-unit">${cRes.unit}</div>
          <div class="cook-breakdown">${s.curry_mini || 0}×0.6 + ${s.curry_full || 0}×1.4 = ${((s.curry_mini||0)*0.6+(s.curry_full||0)*1.4).toFixed(1)}</div>
        </div>` : ""}
      </div>`;

        function _customKitchenRound(val) {
          if (val == null || isNaN(val)) return 0;
          const intPart = Math.floor(val);
          const decPart = val - intPart;
          return (decPart >= 0.35 - 1e-9) ? intPart + 1 : intPart;
        }

        const dal = current_m.other["Dal"];
        const dalFry = current_m.other["Dal_Fry"] || { count: 0, kg: 0 };
        const otherHtml = `
      <div class="item-card ${dal.kg === 0 ? "zero" : ""}">
        <span class="iname">${mr("Dal")}</span>
        <span class="inum">${_customKitchenRound(dal.kg)}</span>
      </div>
      <div class="item-card ${dalFry.kg === 0 ? "zero" : ""}">
        <span class="iname">${mr("Dal_Fry")}</span>
        <span class="inum">${_customKitchenRound(dalFry.kg)}</span>
      </div>` +
          ["Rice", "Salad", "Curd"].map(name => {
            const o = current_m.other[name];
            return `<div class="item-card ${o.count === 0 ? "zero" : ""}">
          <span class="iname">${mr(name)}</span>
          <span class="inum">${o.count}</span>
        </div>`;
          }).join("");

        // Extras — breakfast-style items placed in lunch/dinner via backend
        // (e.g. Kanda Poha, Ghee Upma). Hidden unless something is present.
        const extraEntries = Object.entries(current_m.extras || {}).filter(([, q]) => q > 0);
        const extrasHtml = extraEntries.length
          ? `<hr class="divider">
             <div class="sec-label">अतिरिक्त (Extras)</div>
             <div class="item-grid">${extraEntries.map(([name, qty]) =>
               `<div class="item-card"><span class="iname">${mr(name)}</span><span class="inum">${qty}</span></div>`
             ).join("")}</div>`
          : "";

        html += `<div class="meal-block">
      <div class="meal-head">
        <span class="meal-icon">${icon}</span>
        <span class="meal-title">${label}</span>
        <span class="meal-count">${current_m.count} ${mr('orders')}</span>
      </div>
      <div class="meal-body">
        <div class="sec-label">पोळी / भाकरी</div>
        <div class="item-grid">${rotiHtml}</div>
        <hr class="divider">
        <div class="sec-label">भाजी</div>
        <div class="item-grid">${sabjiHtml}</div>
        <hr class="divider">
        <div class="sec-label">इतर</div>
        <div class="item-grid">${otherHtml}</div>
        ${extrasHtml}
      </div>
    </div>`;
      }
      document.getElementById("kbody").innerHTML = html;
    }

    function renderPacking(data) {
      const meals = data.meals || {};
      let html = getCutoffAlertHtml();

      if (!Object.keys(meals).length) {
        html += `<div class="no-orders">No orders set for ${data.date}</div>`;
        document.getElementById("kbody").innerHTML = html;
        return;
      }
      const MEAL_META = {
        Breakfast: { icon: "🌅", label: "न्याहारी" },
        Lunch: { icon: "☀️", label: "दुपारचे जेवण" },
        Dinner: { icon: "🌙", label: "रात्रीचे जेवण" },
      };

      const currentMeal = _manualMeal || getCurrentMeal();
      if (meals[currentMeal]) {
        const m = meals[currentMeal];
        const { icon, label } = MEAL_META[currentMeal];

        const packs = [];
        if (currentMeal === "Breakfast") {
          const curd = (m.items || {})["Curd"] || 0;
          if (curd > 0) packs.push({ count: curd, name: "50ml plastic container for curd" });
        } else {
          const s = m.sabji || { dry_mini: 0, curry_mini: 0, dry_full: 0, curry_full: 0 };
          const o = m.other || { Dal: { count: 0 }, Dal_Fry: { count: 0 }, Curd: { count: 0 }, Rice: { count: 0 } };

          if (s.dry_mini > 0) packs.push({ count: s.dry_mini, name: "100ml plastic container for mini dry" });
          if (s.curry_mini > 0) packs.push({ count: s.curry_mini, name: "100ml plastic container for mini curry" });
          if (s.dry_full > 0) packs.push({ count: s.dry_full, name: "250ml plastic container for large dry" });
          if (s.curry_full > 0) packs.push({ count: s.curry_full, name: "250ml plastic container for large curry" });
          if (o.Dal && o.Dal.count > 0) packs.push({ count: o.Dal.count, name: "250ml plastic container for Dal" });
          if (o.Dal_Fry && o.Dal_Fry.count > 0) packs.push({ count: o.Dal_Fry.count, name: "250ml plastic container for Dal Fry" });
          if (o.Curd && o.Curd.count > 0) packs.push({ count: o.Curd.count, name: "50ml plastic container for curd" });
          if (o.Rice && o.Rice.count > 0) packs.push({ count: o.Rice.count, name: "250ml aluminium container for rice" });
        }

        const hasMatrices = (m.rotiMatrix && Object.keys(m.rotiMatrix).length > 0) ||
                            (m.riceMatrix && Object.keys(m.riceMatrix).length > 0) ||
                            (m.saladMatrix && Object.keys(m.saladMatrix).length > 0) ||
                            (m.curdMatrix && Object.keys(m.curdMatrix).length > 0);

        if (packs.length > 0 || hasMatrices) {
          html += `<div class="meal-block">
            <div class="meal-head">
              <span class="meal-icon">${icon}</span>
              <span class="meal-title">Packing: ${label}</span>
            </div>
            <div class="meal-body">`;

          if (m.rotiMatrix && Object.keys(m.rotiMatrix).length > 0) {
            const rotis = ["Chapati", "Without_Oil_Chapati", "Phulka", "Ghee_Phulka", "Jowar_Bhakri", "Bajra_Bhakri"];
            html += `<div class="matrix-title">Roti Preparation Matrix (Packet Sizes)</div>
            <div class="roti-matrix-wrap">
              <table class="roti-table">
                <thead>
                  <tr>
                    <th class="roti-name">Item</th>
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => `<th>${n}</th>`).join("")}
                  </tr>
                </thead>
                <tbody>
                  ${rotis.map(r => {
              const row = m.rotiMatrix[r] || {};
              if (Object.keys(row).length === 0) return "";
              return `<tr class="roti-row-${r}">
                      <td class="roti-name val-${r}">${mr(r)}</td>
                      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => {
                const count = row[n] || 0;
                return count > 0 ? `<td class="roti-val val-${r}">${count}</td>` : `<td class="roti-empty">·</td>`;
              }).join("")}
                    </tr>`;
            }).join("")}
                </tbody>
              </table>
            </div>`;
          }

          if ((m.riceMatrix && Object.keys(m.riceMatrix).length > 0) || (m.saladMatrix && Object.keys(m.saladMatrix).length > 0) || (m.curdMatrix && Object.keys(m.curdMatrix).length > 0)) {
            html += `<div class="matrix-title">Rice, Salad & Curd Preparation Matrix</div>
            <div class="roti-matrix-wrap">
              <table class="roti-table">
                <thead>
                  <tr>
                    <th class="roti-name">Item</th>
                    ${[1, 2, 3, 4].map(n => `<th>${n}</th>`).join("")}
                  </tr>
                </thead>
                <tbody>
                  ${m.riceMatrix && Object.keys(m.riceMatrix).length > 0 ? `
                    <tr class="roti-row-Rice">
                      <td class="roti-name val-Rice">भा (Rice)</td>
                      ${[1, 2, 3, 4].map(n => {
              const count = m.riceMatrix[n] || 0;
              return count > 0 ? `<td class="roti-val">${count}</td>` : `<td class="roti-empty">·</td>`;
            }).join("")}
                    </tr>` : ""}
                  ${m.saladMatrix && Object.keys(m.saladMatrix).length > 0 ? `
                    <tr class="roti-row-Salad">
                      <td class="roti-name val-Salad">को (Salad)</td>
                      ${[1, 2, 3, 4].map(n => {
              const count = m.saladMatrix[n] || 0;
              return count > 0 ? `<td class="roti-val">${count}</td>` : `<td class="roti-empty">·</td>`;
            }).join("")}
                    </tr>` : ""}
                  ${m.curdMatrix && Object.keys(m.curdMatrix).length > 0 ? `
                    <tr class="roti-row-Curd">
                      <td class="roti-name val-Curd">दही (Curd)</td>
                      ${[1, 2, 3, 4].map(n => {
              const count = m.curdMatrix[n] || 0;
              return count > 0 ? `<td class="roti-val">${count}</td>` : `<td class="roti-empty">·</td>`;
            }).join("")}
                    </tr>` : ""}
                </tbody>
              </table>
            </div>`;
          }

          if (packs.length > 0) {
            const packMR = {
              "100ml plastic container for mini dry": "100ml प्लास्टिक कंटेनर (सुकी भाजी)",
              "100ml plastic container for mini curry": "100ml प्लास्टिक कंटेनर (रस्सा भाजी)",
              "250ml plastic container for large dry": "250ml प्लास्टिक कंटेनर (सुकी भाजी)",
              "250ml plastic container for large curry": "250ml प्लास्टिक कंटेनर (रस्सा भाजी)",
              "250ml plastic container for Dal": "250ml प्लास्टिक कंटेनर (वरण)",
              "250ml plastic container for Dal Fry": "250ml प्लास्टिक कंटेनर (दाल फ्राय)",
              "50ml plastic container for curd": "50ml प्लास्टिक कंटेनर (दही)",
              "250ml aluminium container for rice": "250ml अल्युमिनियम कंटेनर (भात)"
            };

            html += `<div class="matrix-title">Container Checklist / पॅकिंग लिस्ट</div>
              ${packs.map(p => `
                <div class="pack-row">
                  <div class="pack-count">Get ${p.count}</div>
                  <div class="pack-desc">
                    ${p.name}<br>
                    <span style="color:#7f8c8d; font-size:0.85rem; font-weight:700;">${packMR[p.name] || ""}</span>
                  </div>
                </div>
              `).join("")}`;
          }

          html += `</div></div>`;
        }
      }

      if (!html) html = `<div class="no-orders">No packing items needed for this date.</div>`;
      document.getElementById("kbody").innerHTML = html;
    }

    function getFittedFontSize(text, baseSize) {
      const len = (text || "").length;
      let size = baseSize + 3; // +3 increase as requested
      if (len > 100) size -= 4;
      else if (len > 60) size -= 2;
      return size + "px";
    }

    function renderLabelsTab() {
      const body = document.getElementById("kbody");
      if (!_lastData || !_lastData.orders || _lastData.orders.length === 0) {
        body.innerHTML = '<div class="no-orders" style="padding:40px; text-align:center; color:#888;">No orders to label</div>';
        return;
      }

      const currentMeal = _manualMeal || getCurrentMeal();
      const activeOrders = _lastData.orders.filter(o => {
        if (o.Packed) return false;
        return o.Meal_Type === currentMeal;
      });

      if (activeOrders.length === 0) {
        const msg = `🎉 No ${currentMeal} orders to pack!`;
        body.innerHTML = `<div class="no-orders" style="color:var(--green); font-weight:bold; padding:40px; text-align:center;">${msg}</div>`;
        return;
      }

      const fmtDate = d => { const p = d.split("-"); return `${p[2]}/${p[1]}/${p[0]}`; };
      let html = `<div style="text-align:center;font-size:0.75rem;color:#666;margin-bottom:14px;">📦 Labeled Packing - ${fmtDate(_lastData.date)}</div>`;

      // ── Bulk Pack All button ─────────────────────────────────
      html += `<div style="text-align:center;margin-bottom:12px;">
        <button onclick="packAllOrders()" style="background:#059669;color:#fff;border:none;padding:12px 28px;border-radius:10px;font-size:0.95rem;font-weight:800;cursor:pointer;box-shadow:0 2px 6px rgba(5,150,105,0.3);">
          ✅ Pack All (${activeOrders.length})
        </button>
      </div>`;

      html += '<div style="display:flex; flex-direction:column; gap:12px; padding:10px;">';
      html += activeOrders.map(o => {
        // Create a copy of MR and add common kitchen instructions
        const FULL_MR = {
          ...MR,
          "Less spicy": "कमी तिखट (लेस स्पायसी)",
          "Extra chutney": "जास्त चटणी (एक्स्ट्रा चटणी)",
          "Deliver at gate": "गेटवर द्या",
          "Ring bell": "बेल वाजवा",
          "Don't ring bell": "बेल वाजवू नका"
        };

        // ── NEW CONCISE SUMMARY LOGIC ──
        let summaryMar = "";
        const items = o.items || {};
        const parts = [];
        const lang = "Devanagari";
        const lbl = LABEL_MR;

        if (currentMeal === "Breakfast") {
          ["Kanda Poha", "Ghee Upma", "Thalipeeth", "Palak Paratha", "Paneer Paratha", "Methi Thepla", "Sabudana Khichdi", "Curd"].forEach(k => {
            if (items[k] > 0) parts.push(`${items[k]}x${lbl[k] || k}`);
          });
        } else {
          LD_COLS.forEach(col => {
            if (items[col] > 0) parts.push(`${items[col]}x${lbl[col] || col}`);
          });
        }
        summaryMar = parts.join(", ") || o.summary || "साधी थाळी";

        // Localize Special Notes
        let noteMar = o.marathiNotes || o.Special_Notes_Kitchen || "";
        Object.keys(FULL_MR).forEach(key => {
          const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (key.length > 5 && noteMar.toLowerCase().includes(key.toLowerCase())) {
            noteMar = noteMar.replace(new RegExp(escapedKey, 'gi'), FULL_MR[key]);
          }
        });

        const nameSize = getFittedFontSize(o.Customer_Name, 18);
        const summarySize = getFittedFontSize(summaryMar, 16);
        const noteSize = getFittedFontSize(noteMar, 14);

        const hasNote = !!(noteMar || o.Special_Notes_Kitchen);
        return `
        <div class="label-block" id="label_${o.Submission_ID}" style="background:${hasNote ? 'linear-gradient(135deg,#fffbeb,#fff)' : 'white'}; border-radius:12px; border:1px solid ${hasNote ? '#f59e0b' : '#eee'}; padding:15px; box-shadow:0 1px 3px rgba(0,0,0,0.05); border-left:4px solid ${hasNote ? '#f59e0b' : 'var(--red)'}; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <div style="font-weight:700; color:#1e293b; font-size:${nameSize}; line-height:1.2;">${o.Customer_Name}</div>
          </div>
          <div style="background:#f8fafc; padding:10px; border-radius:8px; font-size:${summarySize}; margin-bottom:10px; color:#334155; font-weight:700; line-height:1.5; word-wrap:break-word;">
            ${summaryMar}
          </div>
          
          <div class="no-print" style="display:flex; flex-direction:column; gap:6px; margin-bottom:12px;">
            ${noteMar || o.Special_Notes_Kitchen ? `
              <div style="font-size:0.95rem; color:#dc2626; font-weight:800; border-left:4px solid #dc2626; padding:8px 12px; background:#fef2f2; border-radius:4px;">
                🍳 Kitchen Notes: ${noteMar || o.Special_Notes_Kitchen}
              </div>` : `
              <div style="font-size:0.8rem; color:#94a3b8; font-style:italic; padding:4px 8px;">
                (No special instructions)
              </div>
            `}
          </div>

          <div style="display:flex; justify-content:flex-end;" class="no-print">
            <button onclick="markOrderPacked('${o.Submission_ID}')" style="background:#059669; color:white; border:none; padding:10px 20px; border-radius:8px; font-size:1rem; font-weight:800; cursor:pointer; box-shadow:0 2px 4px rgba(5,150,105,0.2);">पॅक झाल्यावर क्लिक करा</button>
          </div>
        </div>
      `;
      }).join('');
      html += '</div>';

      body.innerHTML = html;
    }

    async function markOrderPacked(id) {
      const block = document.getElementById('label_' + id);
      if (block) block.style.opacity = '0.5';

      try {
        const res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          body: JSON.stringify({
            _action: "markOrderPacked",
            pin: K.sessionPin,
            submissionId: id
          })
        });
        const data = await res.json();
        if (data.success) {
          if (block) block.remove();
          // Update cache
          const order = _lastData.orders.find(o => o.Submission_ID === id);
          if (order) order.Packed = true;

          if (_lastData.orders.filter(o => !o.Packed).length === 0) {
            renderLabelsTab();
          }
        } else {
          throw new Error(data.error);
        }
      } catch (e) {
        if (block) block.style.opacity = '1';
        alert("Error: " + e.message);
      }
    }

    // ── BULK PACK ALL ────────────────────────────────────────
    async function packAllOrders() {
      const currentMeal = _manualMeal || getCurrentMeal();
      const remaining = (_lastData?.orders || []).filter(o => !o.Packed && o.Meal_Type === currentMeal);
      if (!remaining.length) { alert("No orders left to pack!"); return; }
      if (!confirm(`Mark all ${remaining.length} ${currentMeal} orders as packed?`)) return;

      // Dim all cards
      remaining.forEach(o => {
        const b = document.getElementById("label_" + o.Submission_ID);
        if (b) b.style.opacity = "0.4";
      });

      let failed = 0;
      for (const o of remaining) {
        try {
          const res  = await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({ _action: "markOrderPacked", pin: K.sessionPin, submissionId: o.Submission_ID })
          });
          const data = await res.json();
          if (data.success) {
            o.Packed = true;
            const block = document.getElementById("label_" + o.Submission_ID);
            if (block) block.remove();
          } else { failed++; }
        } catch(e) { failed++; }
      }

      if (failed) alert(`${failed} order(s) failed to mark. Please retry individually.`);
      renderLabelsTab();
    }

    // ── APP VERSION + AUTO-UPDATE ──
    // Match this string to the <meta name="app-version"> tag in <head>.
    // On every page load we fetch the deployed HTML (cache-busted) and
    // compare its meta-version to this constant. If they differ, the
    // staff is running cached/stale HTML — silently hard-reload so the
    // newest build always wins. No prompts, no surprises.
    const KITCHEN_VERSION = "v26.08.11.01";
    (async function _kitchenVersionCheck() {
      try {
        const badge = document.getElementById("kitchenVerBadge");
        if (badge) badge.textContent = KITCHEN_VERSION;
        const res = await fetch(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(/<meta\s+name=["']app-version["']\s+content=["']([^"']+)["']/i);
        if (m && m[1] && m[1] !== KITCHEN_VERSION) {
          console.log("[Kitchen] Version mismatch: running=" + KITCHEN_VERSION
                      + ", latest=" + m[1] + " — prompting hard refresh");
          // Marathi confirm — shown ONLY on a real version mismatch. Same dialogue
          // in Admin + Kitchen. On confirm → hard refresh to the newest build.
          if (window.confirm(_skUpdateMsgMarathi(KITCHEN_VERSION, m[1]))) {
            const sep = window.location.href.indexOf("?") === -1 ? "?" : "&";
            window.location.replace(window.location.href + sep + "_v=" + Date.now());
          }
        }
      } catch (_) { /* network blip — try again next load */ }
    })();
    // Shared update prompt (identical wording in Admin + Kitchen), in Marathi.
    function _skUpdateMsgMarathi(cur, latest) {
      return "🔄 नवीन व्हर्जन उपलब्ध आहे!\n\n"
           + "सध्याची आवृत्ती: " + cur + "\n"
           + "नवीन आवृत्ती: " + latest + "\n\n"
           + "लेटेस्ट व्हर्जनवर जाण्यासाठी पेज रिफ्रेश करणे आवश्यक आहे.\n"
           + "आता रिफ्रेश करायचे?";
    }

    // ── INITIAL STATE ON LOAD ──
    (function () {
      // ALWAYS reset to today's date on every page load / refresh.
      // Previously this honoured a (never-written) sessionStorage key, but
      // legacy storage from older builds could surface a stale date and
      // kitchen staff occasionally prepared off the wrong day's order list.
      // Forcing today on load is the safer default — staff can still pick
      // a different date manually via the picker if they need to.
      document.getElementById("datePicker").value = todayIST();
      try { sessionStorage.removeItem('sk_kitchen_date'); } catch(_) {}

      const savedTab = sessionStorage.getItem('sk_kitchen_tab');
      if (savedTab) _currentTab = savedTab;

      const savedMeal = sessionStorage.getItem('sk_kitchen_meal');
      if (savedMeal) _manualMeal = savedMeal;

      // Auto-Login
      const savedPin = localStorage.getItem('sk-kitchen-pin');
      if (savedPin && savedPin.length === 4) {
        verifyPin(savedPin);
      }
    })();

    // ── AUTO REFRESH ──
    let _lastUpdated = null;
    let _nextRefresh = null;
    const REFRESH_SECS = 300; // 5 minutes

    function startAutoRefresh() {
      if (window._rt) clearInterval(window._rt);
      if (window._ct) clearInterval(window._ct);
      if (window._td) clearInterval(window._td);

      function scheduleNext() {
        _nextRefresh = new Date(Date.now() + REFRESH_SECS * 1000);
      }

      function doRefresh() {
        loadKitchen();
      }

      scheduleNext();
      window._rt = setInterval(doRefresh, REFRESH_SECS * 1000);

      window._ct = setInterval(() => {
        const el = document.getElementById("lastUpdated");
        if (!el) return;
        const secsLeft = _nextRefresh ? Math.max(0, Math.floor((_nextRefresh.getTime() - Date.now()) / 1000)) : REFRESH_SECS;
        const m = Math.floor(secsLeft / 60);
        const s = String(secsLeft % 60).padStart(2, "0");
        const updStr = _lastUpdated ? _lastUpdated.toLocaleTimeString("en-IN") : "—";
        el.textContent = `Updated: ${updStr}  ·  Refresh in ${m}:${s}`;
      }, 1000);

      window._td = setInterval(updateCountdown, 1000);
      updateCountdown();

      // Screen Wake Lock
      let wakeLock = null;
      async function requestWakeLock() {
        try {
          if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            updateWakeStatus(true);
            wakeLock.addEventListener('release', () => updateWakeStatus(false));
          }
        } catch (err) { updateWakeStatus(false); }
      }

      function updateWakeStatus(active) {
        const el = document.getElementById("wakeStatus");
        if (!el) return;
        if (active) {
          el.textContent = "⚡ Stay Awake: Active";
          el.classList.add("active");
        } else {
          el.textContent = "⚡ Stay Awake: Inactive (Click to Activate)";
          el.classList.remove("active");
        }
      }

      // Fallback: request on first click
      document.addEventListener('click', () => {
        if (!wakeLock) requestWakeLock();
      }, { once: true });

      // Pause when tab hidden, resume when visible
      document.removeEventListener("visibilitychange", window._visHandler);
      window._visHandler = () => {
        if (document.hidden) {
          if (window._rt) { clearInterval(window._rt); window._rt = null; }
        } else {
          doRefresh();
          window._rt = setInterval(doRefresh, REFRESH_SECS * 1000);
          requestWakeLock(); // Re-acquire wake lock
        }
      };
      document.addEventListener("visibilitychange", window._visHandler);
      requestWakeLock(); // Initial request
    }

    function updateCountdown() {
      const el = document.getElementById("countdownTimer");
      if (!el) return;

      // Only show if we are looking at today
      if (document.getElementById("datePicker").value !== todayIST()) {
        el.style.display = "none";
        return;
      }

      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 3600000);
      const h = ist.getUTCHours();
      const m = ist.getUTCMinutes();
      const s = ist.getUTCSeconds();
      // Current time as decimal hours (e.g. 6:30 AM = 6.5)
      const nowHours = h + m / 60 + s / 3600;

      // Cutoffs from sheet (decimal hours) or defaults
      const cutoffs = {
        Breakfast: Number(_lastCutoffs.Breakfast) || 7,
        Lunch:     Number(_lastCutoffs.Lunch)     || 9,
        Dinner:    Number(_lastCutoffs.Dinner)    || 16.5
      };

      // Find the next upcoming cutoff
      let targetMeal = null;
      let targetHours = 0;

      if      (nowHours < cutoffs.Breakfast) { targetMeal = "Breakfast"; targetHours = cutoffs.Breakfast; }
      else if (nowHours < cutoffs.Lunch)     { targetMeal = "Lunch";     targetHours = cutoffs.Lunch;     }
      else if (nowHours < cutoffs.Dinner)    { targetMeal = "Dinner";    targetHours = cutoffs.Dinner;    }

      if (targetMeal) {
        const diffMins = (targetHours - nowHours) * 60; // minutes remaining

        // Show only within 30 minutes of cutoff
        if (diffMins > 0 && diffMins <= 30) {
          const remM = Math.floor(diffMins);
          const remS = Math.floor((diffMins - remM) * 60);
          const timeStr = `${String(remM).padStart(2, "0")}:${String(remS).padStart(2, "0")}`;

          const labels = { Breakfast: "न्याहारी", Lunch: "दुपारचे जेवण", Dinner: "रात्रीचे जेवण" };

          // Urgency colour: red under 10 mins, orange under 30
          const colour = diffMins <= 10 ? "#c0392b" : "#d35400";
          const bg     = diffMins <= 10 ? "#fdecea" : "#fff8e1";
          const border = diffMins <= 10 ? "#f5b5b0" : "#ffe082";

          el.style.background = bg;
          el.style.borderColor = border;
          el.innerHTML = `⏳ <span style="font-size:0.85rem;color:#784100;font-weight:600;">(${labels[targetMeal]})</span> स्वयंपाक सुरू होण्यास: <span style="font-size:1.4rem;color:${colour};">${timeStr}</span>`;
          el.style.display = "block";
          return;
        }
      }
      el.style.display = "none";
    }


    function setManualMeal(m) {
      _manualMeal = m;
      renderView();
    }

    async function openWeeklyMenu() {
      const overlay = document.getElementById("wmOverlay");
      const body = document.getElementById("wmBody");
      overlay.classList.add("active");

      body.innerHTML = '<div style="text-align:center; padding:20px;"><div class="spinner"></div><p style="font-size:0.78rem;color:#888;margin-top:8px;">Fetching menu...</p></div>';
      try {
        const res = await fetch(`${APPS_SCRIPT_URL}?action=getWeeklyMenu&pin=${K.sessionPin}`);
        const data = await res.json();
        if (data.success) {
          renderMenuModal(data.days);
        } else {
          throw new Error(data.error || "Failed to load menu");
        }
      } catch (e) {
        body.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Error: ${e.message}</div>`;
      }
    }

    function renderMenuModal(days) {
      const body = document.getElementById("wmBody");
      const dayMR = {
        "Monday": "सोमवार", "Tuesday": "मंगळवार", "Wednesday": "बुधवार",
        "Thursday": "गुरुवार", "Friday": "शुक्रवार", "Saturday": "शनिवार", "Sunday": "रविवार"
      };

      let html = "";
      days.forEach(d => {
        const bfList = (d.breakfast || []).map(b => mr(b.name)).join(", ");
        const l_dry = mr(d.lunch_dry || "-");
        const l_curry = mr(d.lunch_curry || "-");
        const d_dry = mr(d.dinner_dry || "-");
        const d_curry = mr(d.dinner_curry || "-");

        html += `
          <div class="wm-day" style="margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px;">
            <h4 style="color:#1E1240; font-size: 1rem; margin-bottom: 8px;">
              📅 ${dayMR[d.dayName] || d.dayName} (${d.displayDate})
            </h4>
            <p style="font-size:0.88rem; margin-bottom:4px;"><strong>न्याहारी (BF):</strong> ${bfList}</p>
            <p style="font-size:0.88rem; margin-bottom:4px;"><strong>दुपार (Lunch):</strong> ${l_dry} & ${l_curry}</p>
            <p style="font-size:0.88rem; margin-bottom:0;"><strong>रात्र (Dinner):</strong> ${d_dry} & ${d_curry}</p>
          </div>
        `;
      });
      body.innerHTML = html || '<div style="text-align:center; padding:20px;">No menu data available.</div>';
    }

    function closeWeeklyMenu() {
      document.getElementById("wmOverlay").classList.remove("active");
    }

    // ── BULK PRINT LABELS (PORTED FROM ADMIN) ──
    let _bulkLabelOrders = [];
    // Server-shared label gap (mm). Populated by fetchLabelGap() on kitchen
    // login. Replaces the per-device localStorage value so every device
    // (kitchen tablet, admin laptop, etc.) prints with the same spacing.
    // localStorage stays only as an offline fallback if the network call
    // fails on a particular device.
    let _serverLabelGap = null;

    async function fetchLabelGap() {
      try {
        const res = await fetch(`${APPS_SCRIPT_URL}?action=getLabelGap&pin=${K.sessionPin}&_t=${Date.now()}`,
                                { cache: "no-store" });
        const data = await res.json();
        if (data && !data.error && typeof data.gap_mm === "number") {
          _serverLabelGap = data.gap_mm;
          // Cache as local fallback for next offline session.
          try { localStorage.setItem("sk-label-gap", String(data.gap_mm)); } catch(_) {}
          // If the labels tab is currently rendered, update the visible input.
          const el = document.getElementById("bulkLabelGap");
          if (el && document.activeElement !== el) el.value = String(data.gap_mm);
        }
      } catch (_) { /* offline — fall back to localStorage */ }
    }

    async function saveLabelGap(rawValue) {
      const v = parseFloat(rawValue);
      if (!isFinite(v) || v < 0 || v > 20) return; // input box constraints catch this
      // Update local fallback immediately so the value persists if the
      // network call below fails.
      try { localStorage.setItem("sk-label-gap", String(v)); } catch(_) {}
      _serverLabelGap = v;
      try {
        const res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          body: JSON.stringify({ _action: "setLabelGap", pin: K.sessionPin, gap_mm: v })
        });
        const data = await res.json();
        if (data && data.success && typeof toast === "function") {
          toast("Gap saved (synced to all kitchen devices)", 3500);
        }
      } catch (_) {
        if (typeof toast === "function") toast("⚠️ Gap saved locally but couldn't sync to server", 4500);
      }
    }

    const LABEL_EN = {
      Chapati: "CH", Without_Oil_Chapati: "CH(O)", Phulka: "PH", Ghee_Phulka: "GPH",
      Jowar_Bhakri: "J", Bajra_Bhakri: "B",
      Dry_Sabji_Mini: "D100", Dry_Sabji_Full: "D250",
      Curry_Sabji_Mini: "C100", Curry_Sabji_Full: "C250",
      Dal: "DAL", Dal_Fry: "DF", Rice: "R", Salad: "S", Curd: "CU",
      "Kanda Poha": "KP", "Ghee Upma": "GU", "Thalipeeth": "TP",
      "Paneer Paratha": "PP", "Methi Thepla": "MT", "Sabudana Khichdi": "SK",
            "Ghee Sheera": "GS", "Sheera": "SH", "Aloo Paratha": "AP", "Tikhi Puri": "TPU", "Tikhi Pudi": "TPD",
      "Idli": "ID", "Coconut Chutney": "CCT", "Chutney": "CCT", "Dadpe Pohe": "DP", "Masala Dosa": "MD",
      "Upma": "UP", "Poha": "PO",
    };
    const LABEL_MR = {
      Chapati: "च", Without_Oil_Chapati: "च बिनतेल", Phulka: "फु", Ghee_Phulka: "घी फु",
      Jowar_Bhakri: "जो", Bajra_Bhakri: "बाज",
      Dry_Sabji_Mini: "सु १००", Dry_Sabji_Full: "सु २५०",
      Curry_Sabji_Mini: "र १००", Curry_Sabji_Full: "र २५०",
      Dal: "दाल", Dal_Fry: "डा.फ्रा.", Rice: "भात", Salad: "स", Curd: "दही",
      "Kanda Poha": "कांपो", "Ghee Upma": "घीऊ", "Thalipeeth": "था",
      "Paneer Paratha": "पनपरा", "Methi Thepla": "मेथी", "Sabudana Khichdi": "साबु",
            "Ghee Sheera": "घी शिरा", "Sheera": "शिरा", "Aloo Paratha": "आलू पराठा", "Tikhi Puri": "तिखी पुरी", "Tikhi Pudi": "तिखी पुडी",
      "Idli": "इडली", "Coconut Chutney": "खोबरेल चटणी", "Chutney": "चटणी", "Dadpe Pohe": "दापपे पोहे", "Masala Dosa": "मसाला डोसा",
      "Upma": "उपमा", "Poha": "पोहे",
    };
    const LD_COLS = ["Chapati", "Without_Oil_Chapati", "Phulka", "Ghee_Phulka", "Jowar_Bhakri", "Bajra_Bhakri",
      "Dry_Sabji_Mini", "Dry_Sabji_Full", "Curry_Sabji_Mini", "Curry_Sabji_Full", "Dal", "Dal_Fry", "Rice", "Salad", "Curd"];

    function renderPrintLabelsTab() {
      const today = document.getElementById("datePicker").value || new Date().toISOString().split('T')[0];
      const selectedMeal = _manualMeal || getCurrentMeal();
      
      document.getElementById("kbody").innerHTML = `
        <div class="label-controls">
          <div class="ctrl-group">
            <label>Date</label>
            <input type="date" id="bulkLabelDate" value="${today}">
          </div>
          <div class="ctrl-group">
            <label>Meal</label>
            <select id="bulkLabelMeal">
              <option value="Breakfast" ${selectedMeal==='Breakfast'?'selected':''}>Breakfast</option>
              <option value="Lunch" ${selectedMeal==='Lunch'?'selected':''}>Lunch</option>
              <option value="Dinner" ${selectedMeal==='Dinner'?'selected':''}>Dinner</option>
            </select>
          </div>
          <div class="ctrl-group">
            <label>Language</label>
            <select id="bulkLabelLang">
              <option value="Devanagari">Devanagari (Marathi)</option>
              <option value="English">English</option>
            </select>
          </div>
          <div class="ctrl-group">
            <label>Gap (MM) <span style="font-size:0.62rem;color:#aaa;font-weight:500;" id="gapSyncLabel">· global</span></label>
            <input type="number" id="bulkLabelGap"
                   value="${(_serverLabelGap !== null && _serverLabelGap !== undefined) ? _serverLabelGap : (localStorage.getItem('sk-label-gap') || '2.7')}"
                   step="0.1" min="0" max="20" style="min-width:80px;"
                   title="Shared across all kitchen devices — saved on the server"
                   onchange="saveLabelGap(this.value)">
          </div>
          <div class="ctrl-group">
            <label>Mode</label>
            <select id="bulkLabelMode">
              <option value="Actual">Actual (Final)</option>
              <option value="Test">Test (Top 5 Only)</option>
            </select>
          </div>
          <button class="gen-btn" onclick="generateBulkLabels()">⚡ Generate Labels</button>
        </div>
        <div id="bulkLabelPreview" class="label-preview" style="display:none;"></div>
        <button id="bulkDownloadBtn" class="download-btn" onclick="saveBulkLabelsToDrive()">💾 Save PDF to Drive</button>
      `;
    }

    async function generateBulkLabels() {
      const date = document.getElementById("bulkLabelDate").value;
      const meal = document.getElementById("bulkLabelMeal").value;
      const lang = document.getElementById("bulkLabelLang").value;
      const preview = document.getElementById("bulkLabelPreview");
      const btn = document.getElementById("bulkDownloadBtn");

      if (!date) { sAlert("Select a date first"); return; }

      preview.style.display = "block";
      preview.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;">Loading…</div>';
      btn.style.display = "none";

      try {
        const res = await fetch(`${APPS_SCRIPT_URL}?action=getLabelOrders&pin=${K.sessionPin}&date=${date}&meal=${meal}&_t=${Date.now()}`);
        const data = await res.json();
        if (data.error) { preview.innerHTML = `<p style="color:#c0392b;padding:20px;">Error: ${data.error}</p>`; return; }

        _bulkLabelOrders = data.orders || [];
        if (!_bulkLabelOrders.length) {
          preview.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;">No orders found for this date/meal</div>';
          return;
        }
        
        // Render Preview
        const d = new Date(date + "T00:00:00");
        const disp = d.getDate().toString().padStart(2, "0") + "/" + (d.getMonth() + 1).toString().padStart(2, "0") + "/" + d.getFullYear();
        let html = `<h3>${_bulkLabelOrders.length} Labels · ${meal} · ${disp}</h3>`;
        _bulkLabelOrders.forEach((o, i) => {
          const summary = getBulkItemSummary(o, meal, lang);
          html += `
            <div class="label-card">
              <div>
                <div class="lname">${o.name}</div>
                <div class="lsummary">${summary}</div>
                ${o.area ? `<div class="larea">${o.area}</div>` : ''}
                ${o.notes ? `<div class="lnotes">★ ${o.notes}</div>` : ""}
              </div>
              <div class="lnum">#${i + 1}</div>
            </div>`;
        });
        preview.innerHTML = html;
        btn.style.display = "block";
        btn.textContent = "💾 Save to Drive";
      } catch (e) {
        preview.innerHTML = `<p style="color:red;">Network Error: ${e.message}</p>`;
      }
    }

    function getBulkItemSummary(order, meal, lang) {
      // Items_JSON-ONLY when present (fix 2026-08-26 double-count regression).
      // Mirrors backend _lblItemSummary — see comment there.
      const lbl = lang === "Devanagari" ? LABEL_MR : LABEL_EN;
      const norm = (n) => {
        n = String(n || "").trim();
        if (n === "Breakfast Curd") n = "Curd";
        return n.replace(/\s*\[.*?\]\s*/g, "").replace(/\s*\(.*?\)\s*/g, "").trim();
      };
      const items = {};
      const names = [];
      let hasJson = false;
      if (order.Items_JSON) {
        try {
          const parsed = JSON.parse(order.Items_JSON);
          Object.entries(parsed).forEach(([k, q]) => {
            const qty = Number(q) || 0;
            if (qty <= 0) return;
            const n = norm(k === "Breakfast Curd" ? "Curd" : k);
            if (!n) return;
            if (items[n] === undefined) { items[n] = qty; names.push(n); }
            hasJson = true;
          });
        } catch (e) {}
      }
      if (!hasJson) {
        for (let n = 1; n <= 4; n++) {
          const it = String(order["BF_Item_" + n] || "").trim();
          const q = Number(order["BF_Qty_" + n]) || 0;
          if (!it || q <= 0) continue;
          const nn = norm(it);
          if (items[nn] === undefined) { items[nn] = q; names.push(nn); }
        }
        LD_COLS.forEach(col => {
          const qc = Number(order[col]) || 0;
          if (qc <= 0) return;
          if (items[col] === undefined) { items[col] = qc; names.push(col); }
        });
        if (!items["Curd"] && Number(order.Curd) > 0) { items["Curd"] = Number(order.Curd); names.push("Curd"); }
      }
      return names.map(name => {
        const a = lbl[name] || lbl[name.replace(/ /g, "_")] || name;
        return items[name] + "x" + a;
      }).join(", ");
}).join(", ");
}

    async function saveBulkLabelsToDrive() {
      const date = document.getElementById("bulkLabelDate").value;
      const meal = document.getElementById("bulkLabelMeal").value;
      const lang = document.getElementById("bulkLabelLang").value;
      const gapVal = parseFloat(document.getElementById("bulkLabelGap").value) || 2.7;
      const btn = document.getElementById("bulkDownloadBtn");

      if (!_bulkLabelOrders.length) { sAlert("Generate labels first"); return; }
      btn.disabled = true;
      btn.textContent = "⏳ Generating PDF… (+3px size active)";

      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      try {
        const { jsPDF } = window.jspdf;
        const W = 50, LH = 25, GAP = gapVal, BLOCK = LH + GAP;
        const isTest = document.getElementById('bulkLabelMode').value === "Test";
        const currentLabels = isTest ? _bulkLabelOrders.slice(0, 5) : _bulkLabelOrders;
        const n = currentLabels.length, totalH = n * BLOCK;
        const isMR = lang === "Devanagari";
        const TW = W - 4, LM = 2;

        const doc = new jsPDF({ unit: "mm", format: [W, totalH || 1], orientation: (totalH >= W ? "portrait" : "landscape") });

        if (!isMR) {
          currentLabels.forEach((order, idx) => {
            const BY = idx * BLOCK;
            const summary = getBulkItemSummary(order, meal, lang);
            doc.setFont("helvetica", "bold"); doc.setFontSize(13); 
            const nameL = doc.splitTextToSize("Name: " + order.name, TW);
            let y = BY + 6; doc.text(nameL, LM, y);
            y += nameL.length * 5 + 0.5;
            doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); 
            const sumL = doc.splitTextToSize(summary, TW);
            doc.text(sumL, LM, y);
            y += sumL.length * 4 + 1;
            doc.setFont("helvetica", "bold"); doc.setFontSize(11);
            doc.text(order.area || "", LM, y);
            y += 4.5;
            if (order.notes) {
              doc.setFontSize(9); doc.setTextColor(184, 96, 0); 
              doc.text("* " + order.notes, LM, Math.min(y, BY + LH - 2));
              doc.setTextColor(0, 0, 0);
            }
            if (idx < n - 1) { doc.setDrawColor(0); doc.line(1, BY + LH + GAP / 2, W - 1, BY + LH + GAP / 2); }
          });
        } else {
          // Devanagari logic using Canvas
          const SCALE = 10, PW = W * SCALE, PH = totalH * SCALE;
          const mm = v => v * SCALE, maxW = mm(TW);
          const cv = document.createElement("canvas"); cv.width = PW; cv.height = PH;
          const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PW, PH);
          const devFont = "'Hind','Noto Sans Devanagari',sans-serif";

          const cvWrap = (text, bold, fSize, x, startY, lH) => {
            ctx.font = (bold ? "bold " : "") + `${fSize}px ${devFont}`;
            const words = text.split(" ");
            let line = "", cy = startY;
            for (const w of words) {
              const test = line ? line + " " + w : w;
              if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, cy); cy += lH; line = w; }
              else line = test;
            }
            if (line) { ctx.fillText(line, x, cy); cy += lH; } return cy;
          };

          currentLabels.forEach((order, idx) => {
            const BY = mm(idx * BLOCK);
            const summary = getBulkItemSummary(order, meal, lang);
            ctx.fillStyle = "#000";
            let y = cvWrap("Name: " + order.name, true, mm(3.4), mm(LM), BY + mm(5.0), mm(4.4)); 
            y += mm(0.5); ctx.fillStyle = "#222";
            y = cvWrap(summary, false, mm(3.0), mm(LM), y, mm(3.8));
            y += mm(0.5); ctx.fillStyle = "#000";
            y = cvWrap(order.area || "", true, mm(3.2), mm(LM), y, mm(4.0));
            if (order.notes) {
              ctx.fillStyle = "#b86000"; ctx.font = `${mm(2.4)}px ${devFont}`;
              ctx.fillText("* " + order.notes, mm(LM), Math.min(y, BY + mm(LH - 2)));
            }
            if (idx < n - 1) {
              const lineY = BY + mm(LH) + mm(GAP / 2);
              ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.beginPath();
              ctx.moveTo(mm(1), lineY); ctx.lineTo(PW - mm(1), lineY); ctx.stroke();
            }
          });
          doc.addImage(cv.toDataURL("image/png"), "PNG", 0, 0, W, totalH);
        }

        btn.textContent = "⏳ Saving to Drive…";
        const pdfB64 = doc.output("datauristring").split(",")[1];
        const res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          body: JSON.stringify({ _action: "saveLabels", pin: K.sessionPin, date, meal, lang, pdf: pdfB64 })
        });
        const data = await res.json();
        if (data.url) {
          btn.innerHTML = `<a href="${data.url}" target="_blank" style="color:#fff;text-decoration:none;">✅ Saved — Open (${data.name})</a>`;
          btn.disabled = false;
        } else {
          sAlert("Error: " + (data.error || "Unknown error"));
          btn.textContent = "💾 Save to Drive"; btn.disabled = false;
        }
      } catch (e) {
        sAlert("PDF Error: " + e.message);
        btn.textContent = "💾 Save to Drive"; btn.disabled = false;
      }
    }
  