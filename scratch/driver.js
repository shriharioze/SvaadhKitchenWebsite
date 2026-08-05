
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W/exec";
const APP_VERSION = "v26.08.03.1";
(function() {
  const savedVer = localStorage.getItem("sk_admin_ver");
  if (savedVer !== APP_VERSION) {
    localStorage.setItem("sk_admin_ver", APP_VERSION);
    location.reload(true);
  }
})();
setInterval(async function() {
  try {
    const data = await safeFetchJson();
    if (data.error) throw new Error(data.error);
    if (routeRes) {
      try {
        const rd = await routeRes.json();
        if (rd && rd.success) {
          _deliveryRoute = rd.route || {};
          _routeUpdated = rd.updated || "";
          _routeAliasRules = rd.alias_rules || null; // canonical matching rules (SK_Society_Aliases)
        }
      } catch (e) {}
    }
    updateRouteStatus();
    updateSortToggleUI();
    renderAll(data);
    setSyncBadge();
    stopPoll(); startPoll();
  } catch(e) {
    ["Breakfast","Lunch","Dinner"].forEach(m => {
      document.getElementById("panel_"+m).innerHTML =
        `<div class="empty"><div class="empty-icon">⚠️</div>${e.message}</div>`;
    });
  } finally {
    sLoading(false);
  }
}

// ── AUTO-POLL (delivery status sync every 5m) ────────────────────────────────
function startPoll()  { stopPoll(); _pollTimer = setInterval(silentPoll, 300000); }
function stopPoll()   { if (_pollTimer) clearInterval(_pollTimer); }

async function silentPoll() {
  const date = document.getElementById("datePicker").value;
  if (!date || !D.sessionPin) return;
  try {
    const data = await safeFetchJson();
    if (data.error) return;
    // Only update delivery badges — don't re-render cards
    let anyUpdate = false;
    ["Breakfast","Lunch","Dinner"].forEach(meal => {
      (data.meals[meal] || []).forEach(o => {
        if (!o.submissionId) return;
        const btn  = document.getElementById("dbtn_"+o.submissionId);
        const card = document.getElementById("dcard_"+o.submissionId);
        if (o.deliveredAt && btn && !btn.classList.contains("done")) {
          btn.className = "btn-delivered done";
          btn.innerHTML = `✅ Delivered at ${fmtTime(o.deliveredAt)}`;
          if (card) { card.classList.add("delivered"); }
          const tBadge = document.getElementById("dtag_"+o.submissionId);
          if (tBadge) { tBadge.style.display=""; tBadge.textContent = `✅ ${fmtTime(o.deliveredAt)}`; }
          // Update local data + push to bottom
          const local = (_ordersData[meal]||[]).find(lo=>lo.submissionId===o.submissionId);
          if (local && !local.deliveredAt) {
            local.deliveredAt = o.deliveredAt;
            setTimeout(()=>{ const panel=document.getElementById("panel_"+meal); if(card&&panel)panel.appendChild(card); }, 300);
            anyUpdate = true;
          }
        }
      });
      if (anyUpdate) updateProgress(meal);
    });
    setSyncBadge();
  } catch(e) {}
}

function setSyncBadge() {
  const now = new Date(new Date().getTime() + 5.5*3600000);
  document.getElementById("syncBadge").textContent =
    `Synced ${now.getUTCHours()}:${String(now.getUTCMinutes()).padStart(2,"0")}`;
}

// ── SORT MODE TOGGLE ────────────────────────────────────────────────────────
function setSortMode(mode) {
  _sortMode = (mode === "name") ? "name" : (mode === "area") ? "area" : "route";
  localStorage.setItem("sk_driver_sort", _sortMode);
  updateSortToggleUI();
  if (_lastData) renderAll(_lastData);
}

function updateSortToggleUI() {
  const on  = "background:#fff;color:#1a8c4a;";
  const off = "background:none;color:#fff;";
  const r = document.getElementById("sortBtnRoute");
  const n = document.getElementById("sortBtnName");
  const a = document.getElementById("sortBtnArea");
  if (r) r.style.cssText = "border:none;font-size:0.68rem;font-weight:700;padding:4px 12px;cursor:pointer;" + (_sortMode === "route" ? on : off);
  if (n) n.style.cssText = "border:none;font-size:0.68rem;font-weight:700;padding:4px 12px;cursor:pointer;" + (_sortMode === "name" ? on : off);
  if (a) a.style.cssText = "border:none;font-size:0.68rem;font-weight:700;padding:4px 12px;cursor:pointer;" + (_sortMode === "area" ? on : off);
}

// ── DELIVERY ROUTE ──────────────────────────────────────────────────────────
function updateRouteStatus() {
  const el = document.getElementById("routeStatus");
  if (!el) return;
  const buildings = Object.keys((_deliveryRoute && _deliveryRoute.Lunch) || {}).length
                 || Object.keys((_deliveryRoute && _deliveryRoute.Dinner) || {}).length;
  el.textContent = _routeUpdated
    ? `🧭 Route: ${buildings} building(s) · learned ${_routeUpdated}`
    : `🧭 Route: not learned yet — tap "Optimize route" after a few days of deliveries`;
}

async function rebuildRoute() {
  if (!confirm("Re-learn the delivery route from your delivered orders (data window: 5 Jun – 4 Jul 2026)?\n\nThis reads the order in which you marked deliveries and sorts each meal's stops by building. You can run this anytime.")) return;
  sLoading(true, "Learning route from last 30 days…");
  try {
    const res  = await fetchWithTimeout(`${APPS_SCRIPT_URL}?action=buildDeliveryRoute&days=30&pin=${D.sessionPin}&_t=${Date.now()}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Could not build route");
    if (!data.count) {
      alert("ℹ️ Nothing to learn yet.\n\nThe route is built from DELIVERED orders dated 5 Jun – 4 Jul 2026 that have a building/society name. Mark a few deliveries (in the order you actually stop), then tap this again.");
    } else {
      const pm = data.perMeal || {};
      const breakdown = ["Breakfast", "Lunch", "Dinner"].map(m => `${m}: ${pm[m] || 0}`).join("  ·  ");
      alert(`✅ Route updated (separate per meal):\n${breakdown}\n\n${data.count} building-stops learned in total. Reloading in route order.`);
    }
    await loadOrders();
  } catch (e) {
    alert("⚠️ " + e.message);
  } finally {
    sLoading(false);
  }
}

// ── RENDER ────────────────────────────────────────────────────────────────────
// ── ENKIN CONSOLIDATION ──────────────────────────────────────────────────────
// Collapses all Enkin orders for a meal into ONE representative card.
// The consolidated card carries _enkinGroupIds (all submission IDs) so
// markDelivered can batch-mark them all.
function _consolidateEnkin(orders) {
  const enkinOrders = [];
  const otherOrders = [];
  orders.forEach(o => {
    if (String(o.name || "").toLowerCase().indexOf("enkin") !== -1) {
      enkinOrders.push(o);
    } else {
      otherOrders.push(o);
    }
  });
  if (enkinOrders.length <= 1) return orders; // 0–1 Enkin → nothing to consolidate

  // Pick the first Enkin order as the representative card
  const rep = { ...enkinOrders[0] };
  rep.name = `Enkin (×${enkinOrders.length})`;
  rep._enkinGroupIds = enkinOrders.map(o => o.submissionId);
  rep._enkinNames = enkinOrders.map(o => o.name);
  // If ANY Enkin is already delivered, the group is delivered (use earliest time)
  const deliveredOnes = enkinOrders.filter(o => o.deliveredAt);
  if (deliveredOnes.length === enkinOrders.length) {
    rep.deliveredAt = deliveredOnes.sort((a,b) => new Date(a.deliveredAt) - new Date(b.deliveredAt))[0].deliveredAt;
  } else {
    rep.deliveredAt = ""; // not all delivered yet → show as undelivered
  }
  // If any has enRouteAt, the group has enRouteAt
  if (enkinOrders.some(o => o.enRouteAt)) rep.enRouteAt = enkinOrders.find(o => o.enRouteAt).enRouteAt;

  return [...otherOrders, rep];
}

function renderAll(data) {
  _lastData = data; // remember for re-render when the sort toggle changes
  ["Breakfast","Lunch","Dinner"].forEach(meal => {
    const raw = ((data.meals || {})[meal] || []);

    // ── Enkin consolidation: collapse N Enkin orders → 1 card ──
    const consolidated = _consolidateEnkin(raw);

    // Undelivered (top) sort depends on the driver's chosen mode:
    //   "route" → learned building order (society grouped in his preferred stop
    //             sequence; unknown buildings sink to bottom; within: wing→flat→name)
    //   "name"  → simple A–Z by customer name (helpful early, before route is learned)
    //   "area"  → alphabetical by area, then society, then name
    // Delivered (bottom): always by time delivered (oldest→newest) — a running log.
    const routeMap = _deliveryRoute[meal] || {};
    const socKey = (o) => _canonSocKey(o.society || o.area || "");
    const routeRank = (o) => {
      // Self Pickup is ALWAYS first — the driver drops those at the pickup point,
      // marks them delivered, and then starts the actual delivery route.
      const _a = String(o.society || o.area || "").toLowerCase();
      if (_a.indexOf("pickup") !== -1) return 0;
      const r = routeMap[socKey(o)];
      return (typeof r === "number" && r > 0) ? r : 9999; // unknown → bottom
    };
    const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    const byRoute = (a, b) => {
      const ra = routeRank(a), rb = routeRank(b);
      if (ra !== rb) return ra - rb;
      // Tie → keep buildings together (alphabetical society), then wing/flat/name.
      const sa = socKey(a), sb = socKey(b);
      if (sa !== sb) return sa.localeCompare(sb);
      const wa = String(a.wing || "").toLowerCase(), wb = String(b.wing || "").toLowerCase();
      if (wa !== wb) return wa.localeCompare(wb);
      const fa = parseInt(a.flat, 10) || 0, fb = parseInt(b.flat, 10) || 0;
      if (fa !== fb) return fa - fb;
      return byName(a, b);
    };
    const byArea = (a, b) => {
      const aa = String(a.area || "").toLowerCase(), ab = String(b.area || "").toLowerCase();
      if (aa !== ab) return aa.localeCompare(ab);
      const sa = socKey(a), sb = socKey(b);
      if (sa !== sb) return sa.localeCompare(sb);
      return byName(a, b);
    };
    const byDeliveredTime = (a, b) => {
      const ta = a.deliveredAt ? new Date(a.deliveredAt).getTime() : 0;
      const tb = b.deliveredAt ? new Date(b.deliveredAt).getTime() : 0;
      return ta - tb;
    };
    const undeliveredSort = (_sortMode === "name") ? byName : (_sortMode === "area") ? byArea : byRoute;
    const orders = [
      ...consolidated.filter(o => !o.deliveredAt).sort(undeliveredSort),
      ...consolidated.filter(o => o.deliveredAt).sort(byDeliveredTime)
    ];
    _ordersData[meal] = orders;
    // Tab count: show total original order count (not consolidated)
    const originalCount = raw.length;
    document.getElementById("cnt_"+meal).textContent = originalCount;
    document.getElementById("panel_"+meal).innerHTML = renderMealPanel(orders, meal);
    // Re-apply any active search query for this meal after re-render.
    applyDriverSearch(meal);
  });
  // Show progress for the currently active tab
  const activeMeal = ["Breakfast","Lunch","Dinner"].find(m =>
    document.getElementById("tab_"+m).classList.contains("active")) || "Breakfast";
  updateProgress(activeMeal);
}

function updateProgress(meal) {
  const orders = _ordersData[meal] || [];
  const total  = orders.length;
  const done   = orders.filter(o => o.deliveredAt).length;
  const strip  = document.getElementById("progressStrip");
  const fill   = document.getElementById("progressFill");
  const text   = document.getElementById("progressText");
  if (!total) { strip.style.display = "none"; return; }
  strip.style.display = "flex";
  const pct = Math.round(done/total*100);
  fill.style.width  = pct + "%";
  text.textContent  = `${done} / ${total} delivered`;
  text.className    = "progress-text" + (done===total ? " done" : "");
  // Tab count shows remaining
  const remaining = total - done;
  document.getElementById("cnt_"+meal).textContent = remaining > 0 ? remaining : "✓";
  // Cash badge logic removed
  // Check if all done
  if (done === total && total > 0) checkAllDone(meal);
}

function checkAllDone(meal) {
  const orders   = _ordersData[meal] || [];
  const total    = orders.length;
  // Audit Fix #1: Define km from _routeDists to prevent ReferenceError
  const km = _routeDists[meal] || null;
  document.getElementById("doneStats").innerHTML = `
    <div class="done-stat"><div class="done-stat-val">${total}</div><div class="done-stat-lbl">Deliveries Completed</div></div>
    ${km ? `<div class="done-stat"><div class="done-stat-val">~${km} km</div><div class="done-stat-lbl">Estimated Route</div></div>` : ""}
    <div class="done-stat"><div class="done-stat-val">${fmtTime(new Date().toISOString())}</div><div class="done-stat-lbl">Finished At</div></div>
  `;
  document.getElementById("allDoneOverlay").style.display = "flex";
}

function renderMealPanel(orders, meal) {
  if (!orders.length) {
    return `<div class="empty"><div class="empty-icon">😴</div>No deliveries for ${meal}</div>`;
  }

  const selectedDate = document.getElementById("datePicker").value;
  const localEnRouteKey = `sk_enroute_${selectedDate}_${meal}`;
  const isLocallyEnRoute = localStorage.getItem(localEnRouteKey) === 'true';

  // Apply persistence override immediately
  if (isLocallyEnRoute) {
    orders.forEach(o => { if (!o.deliveredAt) o.enRouteAt = o.enRouteAt || new Date().toISOString(); });
  }

  // Count geocodable orders for route button
  const canOptimize = orders.some(o => extractCoords(o));

  const today = todayIST();
  const nowRaw = new Date(new Date().getTime() + 5.5*3600000);
  const hour = nowRaw.getUTCHours() + nowRaw.getUTCMinutes()/60;
  
  const SLOT_TIMES = { Breakfast: 7.5, Lunch: 10, Dinner: 17.5 }; // 07:30, 10:00, 17:30
  const isToday = (selectedDate === today);
  const timeReached = hour >= (SLOT_TIMES[meal] || 0);
  const canStart = isToday && timeReached;
  
  // Detect if delivery trip already started for this meal (now includes localStorage check)
  const isEnRoute = orders.some(o => o.enRouteAt);

  // Glitch recovery: delivery was started but some points are still locked
  // (no enRouteAt, not delivered). Offer a Restart to re-open just those.
  const lockedCount = orders.filter(o => !o.enRouteAt && !o.deliveredAt).length;
  const showRestart = isToday && timeReached && isEnRoute && lockedCount > 0;

  const fmtSlotTime = (t) => {
    const h = Math.floor(t), m = (t % 1) * 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
  };

  const statusMsg = !isToday ? "Future delivery cannot be started" : 
                    (!timeReached ? `Opening at ${fmtSlotTime(SLOT_TIMES[meal])}` : "");

  // Determine Button State
  let btnClass = canStart ? 'green' : '';
  let btnText = canStart ? `🚀 Start ${meal} Delivery` : `🔒 ${meal} Locked`;
  let btnAttr = !canStart ? 'disabled style="background:#888;box-shadow:none;opacity:0.6;"' : 'style="padding:10px 14px;font-size:0.85rem;box-shadow:0 3px 10px rgba(39,174,96,0.3);"';

  if (isEnRoute) {
    btnClass = "green done";
    btnText = `🚗 ${meal} Out for Delivery`;
    btnAttr = 'disabled style="padding:10px 14px;font-size:0.85rem;box-shadow:none;opacity:0.8;"';
  }

  // Per-meal search bar — scoped to this meal only so searching in Lunch
  // never reaches Breakfast/Dinner cards (those panels are hidden anyway).
  // The handler hides any .order-card whose data-search doesn't contain the
  // query; clearing the input shows everything again.
  const prevQuery = (_searchQuery && _searchQuery[meal]) || "";
  const searchBar = `<div class="driver-search-bar" style="padding:10px 12px 0;background:#fff;">
    <div style="position:relative;">
      <input type="search" id="search_${meal}" placeholder="🔍 Search name or area…" value="${prevQuery.replace(/"/g,'&quot;')}"
             oninput="applyDriverSearch('${meal}', this.value)"
             style="width:100%;padding:8px 32px 8px 12px;font-size:0.85rem;border:1.5px solid #ddd;border-radius:10px;font-family:inherit;box-sizing:border-box;background:#fafafa;">
      ${prevQuery ? `<button type="button" onclick="clearDriverSearch('${meal}')" aria-label="Clear" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1rem;color:#888;padding:4px 8px;">✕</button>` : ""}
    </div>
    <div id="searchMeta_${meal}" style="font-size:0.7rem;color:#888;margin-top:4px;min-height:14px;"></div>
  </div>`;

  const routeBar = `<div class="route-bar" id="routeBar_${meal}" style="border-bottom:2.5px solid #1E1240;">
    <button class="route-btn ${btnClass}" 
            onclick="markAllEnRoute('${meal}')" 
            id="startBtn_${meal}" 
            ${btnAttr}>
      ${btnText}
    </button>
    ${showRestart ? `<button class="route-btn" onclick="restartDelivery('${meal}')" title="Re-unlock delivery points still showing 'Start Delivery to Unlock' (delivered orders stay delivered)" style="background:#e67e22;">↻ Restart Delivery</button>` : ""}
    ${(!isEnRoute && statusMsg) ? `<span style="font-size:0.7rem;color:#1E1240;font-weight:700;margin-left:4px;">${statusMsg}</span>` : ""}
    ${canOptimize
      ? `<button class="route-btn" onclick="optimizeRoute('${meal}')">🗺 Optimize Route</button>`
      : ""}
    <span class="route-info" id="routeInfo_${meal}"></span>
    <a id="routeLink_${meal}" class="route-maps-link" style="display:none;" target="_blank">📍 Open in Maps</a>
    <a href="https://www.google.com/maps/search/?api=1&query=${KITCHEN.lat},${KITCHEN.lng}"
       target="_blank"
       style="font-size:0.62rem;color:#888;text-decoration:none;margin-left:auto;"
       title="Verify kitchen start/end point">🏠 Kitchen pin</a>
  </div>`;

  return searchBar + routeBar + orders.map((o, i) => renderCard(o, i, meal)).join("");
}

function renderCard(o, i, meal) {
  const hasMap      = o.maps && o.maps.startsWith("http");
  const hasPhone    = o.phone && o.phone.length >= 10;
  const isDelivered = !!o.deliveredAt;
  const waText      = encodeURIComponent(`✅ Hi ${o.name}! Your ${meal} has been delivered. 🙏 If you don't see it at your door, please check the bag kept outside — that's where we place it. 🛍️ (Keeping a bag out helps us deliver everyone's meals faster!) Thank you!`);
  const waNum       = hasPhone ? "91" + o.phone.replace(/\D/g,"").slice(-10) : "";

  // ── DYNAMIC ADDRESS OVERRIDE ──
  let displayArea = o.area || "";
  let displayAddr = o.address || "";
  let displayLandmark = o.landmark || "";
  
  if (o.mealAddresses) {
    try {
      const ma = JSON.parse(o.mealAddresses);
      const mData = ma[meal];
      if (mData && mData.area) {
        displayArea = mData.area;
        if (displayArea.toLowerCase().includes("pickup")) {
          // If profile says pickup, ensure it shows as pickup
        } else {
          // Use profile address components if it's a specific delivery location
          const parts = [
            mData.wing ? `Wing ${mData.wing}` : "",
            mData.flat ? `Flat ${mData.flat}` : "",
            mData.floor ? `${mData.floor} Floor` : "",
            mData.society || "",
            mData.area || ""
          ].filter(Boolean);
          displayAddr = parts.join(", ");
          displayLandmark = mData.landmark || "";
        }
      }
    } catch(e) { console.warn("Error parsing mealAddresses override", e); }
  }
  const isPickup = displayArea.toLowerCase().includes("pickup");

  // Build search string: name + area (for area-based filtering)
  const searchStr = [String(o.name||""), displayArea, String(o.society||"")].join(" ").toLowerCase().replace(/"/g,'&quot;');

  // Enkin consolidated card: show a badge listing all individual names
  const isEnkinGroup = !!(o._enkinGroupIds && o._enkinGroupIds.length > 1);
  const enkinBadge = isEnkinGroup
    ? `<div style="background:#f3e5f5;border:1px solid #ce93d8;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:0.78rem;color:#6a1b9a;">
         📦 <b>Consolidated:</b> ${o._enkinNames.join(", ")}
       </div>`
    : "";
  // Enkin group: store all IDs as a data attribute for batch marking
  const enkinIdsAttr = isEnkinGroup ? ` data-enkin-ids="${o._enkinGroupIds.join(",")}"` : "";

  return `<div class="order-card${isDelivered?" delivered":""}" id="dcard_${o.submissionId}" data-meal="${meal}" data-search="${searchStr}"${enkinIdsAttr}>
    <div class="order-header">
      <div class="order-num">DELIVERY #${i+1}${isEnkinGroup ? ` <span style="background:#ce93d8;color:#fff;padding:1px 6px;border-radius:6px;font-size:0.6rem;margin-left:4px;">GROUP</span>` : ""}</div>
      ${isDelivered
        ? `<div class="delivered-time" id="dtag_${o.submissionId}">✅ ${fmtTime(o.deliveredAt)}</div>`
        : `<div class="delivered-time" id="dtag_${o.submissionId}" style="display:none;"></div>`}
    </div>
    <div class="cust-name">${o.name || "—"}</div>
    <div class="cust-phone">${hasPhone ? "📞 "+o.phone : ""}</div>
    ${enkinBadge}
    <div class="address-box">
      ${isPickup 
        ? `<div style="color:#d32f2f; font-size:1.1rem; font-weight:800; display:flex; align-items:center; gap:6px; margin-bottom:4px;">🏠 SELF PICKUP</div><div style="font-size:0.8rem; color:#666;">Customer set "${displayArea}" in profile</div>`
        : `📍 ${displayAddr || "Address not available"}
          ${displayArea ? `<br><span style="color:#888;font-size:0.72rem;">📌 ${displayArea}</span>` : ""}
          ${displayLandmark ? `<div class="landmark">🏢 Landmark: <span>${displayLandmark}</span></div>` : ""}`
      }
    </div>
    
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
      <div style="background:#e3f2fd; border-radius:10px; padding:10px 14px; font-size:0.85rem; color:#1565c0; font-weight:700; border: 1px solid #bbdefb; display:flex; align-items:center; gap:8px;">
        <span>🚚</span> <span>Instruction : ${o.deliveryPoint || "Handover at Doorstep"}</span>
      </div>
      ${o.notes ? `<div class="notes-box" style="margin-bottom:0; padding:10px 14px; font-size:0.85rem; border: 1px solid #ffe082;">📝 Special instructions for driver staff (optional): ${o.notes}</div>` : ""}
    </div>

    <div class="card-actions">
      ${hasPhone
        ? `<a class="btn-call" href="tel:${o.phone}">📞 Call</a>`
        : `<span class="btn-call" style="background:#ccc;pointer-events:none;">No number</span>`}
      ${(hasMap && !isPickup)
        ? `<a class="btn-maps" href="${o.maps}" target="_blank">🗺 Maps</a>`
        : `<span class="btn-maps disabled">No map</span>`}
      ${hasPhone
        ? `<a class="btn-whatsapp" href="https://wa.me/${waNum}?text=${waText}" target="_blank">💬</a>`
        : ""}
    </div>
    ${(() => {
       const c = extractCoords(o);
       if (!c) return `<div style="margin-top:6px;font-size:0.65rem;color:#c0392b;">⚠️ No coordinates extracted — this stop will be skipped during route optimization</div>`;
       return `<div style="margin-top:6px;font-size:0.65rem;color:#888;">
         📍 Pin used:
         <a href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}" target="_blank"
            style="color:#1a73e8;text-decoration:none;font-weight:600;">${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}</a>
       </div>`;
     })()}
    <div style="margin-top:10px;">
      <button class="btn-delivered${isDelivered?" done":""}" 
        style="width:100%;margin-top:0;padding:14px;font-size:1rem;${(!o.enRouteAt && !isDelivered) ? 'opacity:0.5; cursor:not-allowed;' : ''}" 
        id="dbtn_${o.submissionId}"
        onclick="markDelivered('${o.submissionId}','${meal}',this)"
        ${(isDelivered || !o.enRouteAt) ? "disabled" : ""}>
        ${o.enRouteAt && !isDelivered ? `<span style="float:left;">🚗</span>` : ""}
        ${isDelivered ? `✅ Delivered at ${fmtTime(o.deliveredAt)}` : (!o.enRouteAt ? "🔒 Start Delivery to Unlock" : (isEnkinGroup ? `⬜ Mark All ${o._enkinGroupIds.length} Delivered` : "⬜ Mark Delivered"))}
      </button>
    </div>
  </div>`;
}

// ── OFFLINE DELIVERY QUEUE ───────────────────────────────────────────────────
// If markDelivered fails (no signal), we queue it in localStorage and flush later.
const _OFFLINE_KEY = "sk_driver_offline_queue";

function _queueDelivery(submissionId, meal, deliveredAt) {
  let q = [];
  try { q = JSON.parse(localStorage.getItem(_OFFLINE_KEY) || "[]"); } catch(e) {}
  // Deduplicate by submissionId
  if (!q.find(x => x.submissionId === submissionId)) {
    q.push({ submissionId, meal, deliveredAt, pin: D.sessionPin });
    localStorage.setItem(_OFFLINE_KEY, JSON.stringify(q));
    _showOfflineBadge(q.length);
  }
}
// Queue a failed "Start Delivery" (batchMarkEnRoute) for background sync.
// The UI is already unlocked optimistically; this only retries the server write.
function _queueEnRoute(submissionIds, enRouteAt) {
  let q = [];
  try { q = JSON.parse(localStorage.getItem(_OFFLINE_KEY) || "[]"); } catch(e) {}
  q.push({ type: "enroute", submissionIds, enRouteAt, pin: D.sessionPin });
  localStorage.setItem(_OFFLINE_KEY, JSON.stringify(q));
  _showOfflineBadge(q.length);
}
function _showOfflineBadge(count) {
  let badge = document.getElementById("offlineQueueBadge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "offlineQueueBadge";
    badge.onclick = _flushOfflineQueue;
    badge.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#e67e22;color:#fff;font-size:0.78rem;font-weight:700;padding:8px 16px;border-radius:20px;cursor:pointer;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.3);";
    document.body.appendChild(badge);
  }
  badge.textContent = `⚠️ ${count} update(s) offline — tap to sync`;
  badge.style.display = count > 0 ? "block" : "none";
}

async function _flushOfflineQueue() {
  let q = [];
  try { q = JSON.parse(localStorage.getItem(_OFFLINE_KEY) || "[]"); } catch(e) {}
  if (!q.length) return;
  let flushed = 0;
  const remaining = [];
  for (const item of q) {
    try {
      // Queued "Start Delivery" batch (UI already unlocked optimistically)
      if (item.type === "enroute") {
        const data = await safeFetchJson();
        if (data.success) flushed++; else remaining.push(item);
        continue;
      }
      const data = await safeFetchJson();
      if (data.success) {
        flushed++;
        // Update UI if card still visible
        const btn = document.getElementById("dbtn_"+item.submissionId);
        if (btn && !btn.classList.contains("done")) {
          btn.className = "btn-delivered done";
          btn.innerHTML = `✅ Delivered at ${fmtTime(item.deliveredAt)}`;
        }
        const card = document.getElementById("dcard_"+item.submissionId);
        if (card) card.classList.add("delivered");
      } else { remaining.push(item); }
    } catch(e) { remaining.push(item); }
  }
  localStorage.setItem(_OFFLINE_KEY, JSON.stringify(remaining));
  _showOfflineBadge(remaining.length);
  if (flushed) silentPoll(); // refresh delivery counts
}

// Flush queue on connectivity restored or tab becomes visible
window.addEventListener("online", _flushOfflineQueue);
document.addEventListener("visibilitychange", () => { if (!document.hidden && navigator.onLine) _flushOfflineQueue(); });

// Check on load for any pending offline items
window.addEventListener("load", () => {
  try {
    const q = JSON.parse(localStorage.getItem(_OFFLINE_KEY) || "[]");
    if (q.length) _showOfflineBadge(q.length);
  } catch(e) {}
});

// ── MARK DELIVERED ────────────────────────────────────────────────────────────
async function markDelivered(submissionId, meal, btn) {
  if (!submissionId || btn.classList.contains("done")) return;

  // ── Enkin consolidated card: batch-mark all IDs ────────────────────────
  const card = document.getElementById("dcard_"+submissionId);
  const enkinIdsStr = card && card.getAttribute("data-enkin-ids");
  if (enkinIdsStr) {
    const allIds = enkinIdsStr.split(",").filter(Boolean);
    sBtnLoading(btn, true, `Marking ${allIds.length} orders`);
    const deliveredAt = new Date().toISOString();

    // Optimistic UI
    btn.className = "btn-delivered done";
    btn.innerHTML = `✅ All ${allIds.length} delivered at ${fmtTime(deliveredAt)}`;
    if (card) card.classList.add("delivered");
    const tag = document.getElementById("dtag_"+submissionId);
    if (tag) { tag.style.display=""; tag.textContent = `✅ ${fmtTime(deliveredAt)}`; }
    const order = (_ordersData[meal]||[]).find(o=>o.submissionId===submissionId);
    if (order) order.deliveredAt = deliveredAt;
    updateProgress(meal);
    setTimeout(() => { const panel = document.getElementById("panel_"+meal); if (card && panel) panel.appendChild(card); }, 500);

    try {
      const data = await safeFetchJson();
      if (!data.success) throw new Error(data.error || "Failed");
    } catch(e) {
      // Queue each for offline sync
      allIds.forEach(sid => _queueDelivery(sid, meal, deliveredAt));
    }
    return;
  }

  // ── Normal single-order delivery ───────────────────────────────────────
  sBtnLoading(btn, true, "Marking");
  const deliveredAt = new Date().toISOString(); // proper UTC — fmtTime adds +5:30 for display

  // Optimistically update UI immediately for better field UX
  btn.className = "btn-delivered done";
  btn.innerHTML = `✅ Delivered at ${fmtTime(deliveredAt)}`;
  if (card) card.classList.add("delivered");
  const tag = document.getElementById("dtag_"+submissionId);
  if (tag) { tag.style.display=""; tag.textContent = `✅ ${fmtTime(deliveredAt)}`; }
  const order = (_ordersData[meal]||[]).find(o=>o.submissionId===submissionId);
  if (order) order.deliveredAt = deliveredAt;
  updateProgress(meal);
  setTimeout(() => { const panel = document.getElementById("panel_"+meal); if (card && panel) panel.appendChild(card); }, 500);

  try {
    const data = await safeFetchJson();
    if (!data.success) throw new Error(data.error || "Failed");
    // Success — clear any stale offline queue entry for this order
    try {
      let q = JSON.parse(localStorage.getItem(_OFFLINE_KEY) || "[]");
      q = q.filter(x => x.submissionId !== submissionId);
      localStorage.setItem(_OFFLINE_KEY, JSON.stringify(q));
      _showOfflineBadge(q.length);
    } catch(e) {}
  } catch(e) {
    // Network failure — queue for later sync
    _queueDelivery(submissionId, meal, deliveredAt);
  }
}

async function markAllEnRoute(meal) {
  const orders = _ordersData[meal] || [];
  if (!orders.length) return;
  const count = orders.filter(o => !o.enRouteAt && !o.deliveredAt).length;
  if (count === 0) { await sAlert("All orders for " + meal + " are already marked as out for delivery!", "Notice", "ℹ️"); return; }

  if (!await sConfirm(`Mark all ${count} ${meal} orders as 'Out for Delivery'?\n\nThis will notify customers that their food is on the way!`, "Start Delivery", "🚀")) return;

  const btn = document.getElementById("startBtn_" + meal);
  sBtnLoading(btn, true, "Sending notifications");
  
  const enRouteAt = new Date().toISOString();
  const submissionIds = orders.filter(o => !o.enRouteAt && !o.deliveredAt).map(o => o.submissionId);

  // OPTIMISTIC UNLOCK: apply local state FIRST so a flaky network can never
  // leave the cards stuck on "Start Delivery to Unlock". The server sync
  // happens after; if it fails it's queued and flushed automatically.
  orders.forEach(o => {
    if (submissionIds.includes(o.submissionId)) o.enRouteAt = enRouteAt;
  });
  const selectedDate = document.getElementById("datePicker").value;
  localStorage.setItem(`sk_enroute_${selectedDate}_${meal}`, 'true');
  document.getElementById("panel_" + meal).innerHTML = renderMealPanel(orders, meal);
  switchTab(meal);

  try {
    const data = await safeFetchJson();
    if (!data.success) throw new Error(data.error || "Failed to update");
    await sAlert(`Success! ${submissionIds.length} orders marked as Out for Delivery.`, "Delivery Started", "✅");
  } catch (err) {
    // Cards are already unlocked locally — queue the server sync for later.
    _queueEnRoute(submissionIds, enRouteAt);
    await sAlert("No signal — delivery started locally and all points are unlocked. The server will sync automatically when you're back online (or tap the orange badge).", "Started (Offline)", "📡");
  }
}

// Glitch recovery: re-open only the delivery points still showing
// "Start Delivery to Unlock" (locked, not yet delivered). Delivered orders
// are left untouched. Use when "Start Delivery" half-failed and some cards
// stayed locked with no way to retry.
async function restartDelivery(meal) {
  const orders = _ordersData[meal] || [];
  const locked = orders.filter(o => !o.enRouteAt && !o.deliveredAt);
  if (!locked.length) { await sAlert("All delivery points for " + meal + " are already unlocked.", "Nothing to restart", "ℹ️"); return; }

  if (!await sConfirm(`Re-unlock ${locked.length} ${meal} delivery point(s) still showing "Start Delivery to Unlock"?\n\nAlready-delivered orders stay delivered — this only re-opens the stuck ones.`, "Restart Delivery", "↻")) return;

  const enRouteAt = new Date().toISOString();
  const submissionIds = locked.map(o => o.submissionId);
  try {
    const data = await safeFetchJson();
    if (!data.success) throw new Error(data.error || "Failed to update");

    orders.forEach(o => { if (submissionIds.includes(o.submissionId)) o.enRouteAt = enRouteAt; });
    const selectedDate = document.getElementById("datePicker").value;
    localStorage.setItem(`sk_enroute_${selectedDate}_${meal}`, 'true');

    document.getElementById("panel_" + meal).innerHTML = renderMealPanel(orders, meal);
    switchTab(meal);
    await sAlert(`Re-opened ${submissionIds.length} delivery point(s). You can now mark them delivered.`, "Delivery Restarted", "✅");
  } catch (err) {
    await sAlert("Error: " + err.message, "Restart Failed", "❌");
  }
}

function fmtTime(isoStr) {
  if (!isoStr) return "";
  try {
    // Always treat stored value as UTC and convert to IST (+5:30)
    const ist = new Date(new Date(isoStr).getTime() + 5.5*3600000);
    const h = ist.getUTCHours(), m = ist.getUTCMinutes();
    return `${h}:${String(m).padStart(2,"0")}`;
  } catch(e) { return isoStr.slice(11,16); }
}

// ── ROUTE OPTIMISATION ────────────────────────────────────────────────────────
// Server resolves lat/lng for every order (short links + pin coords). The fallback
// regex below matches the same priority order as the server in case the server
// could not resolve. Priority: !3d/!4d (actual pin) > /place/@ > ?q= / ?destination=
// > ?ll= > @ (camera center, last resort).
function extractCoords(o) {
  if (!o) return null;
  if (o.lat && o.lng) return { lat: +o.lat, lng: +o.lng };
  let url = o.maps || "";
  if (!url) return null;
  try { url = decodeURIComponent(url); } catch(_) {}

  let m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2] };

  m = url.match(/\/place\/[^/]+\/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2] };

  m = url.match(/[?&](?:q|query|destination|daddr|saddr)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2] };

  m = url.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2] };

  m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2] };

  return null;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function nearestNeighbor(orders) {
  const undelivered = orders.filter(o => !o.deliveredAt);
  const delivered   = orders.filter(o => o.deliveredAt);
  
  const withC = undelivered.map(o => ({...o, _c: extractCoords(o)}));
  const geo   = withC.filter(o => o._c);
  const noGeo = withC.filter(o => !o._c);
  if (!geo.length) return { route: orders, dist: null };

  const result = [], remaining = [...geo];
  let cur = KITCHEN;
  while (remaining.length) {
    let minD = Infinity, minI = 0;
    remaining.forEach((o,i) => {
      const d = haversine(cur.lat, cur.lng, o._c.lat, o._c.lng);
      if (d < minD) { minD = d; minI = i; }
    });
    result.push(remaining[minI]);
    cur = remaining[minI]._c;
    remaining.splice(minI, 1);
  }

  // Total round-trip distance
  let dist = 0, prev = KITCHEN;
  result.forEach(o => { dist += haversine(prev.lat, prev.lng, o._c.lat, o._c.lng); prev = o._c; });
  dist += haversine(prev.lat, prev.lng, KITCHEN.lat, KITCHEN.lng);

  return { route: [...result, ...noGeo, ...delivered], dist: Math.round(dist*10)/10 };
}

function buildMapsUrl(orders) {
  // Use the official Directions API URL format — this respects the order of
  // waypoints we pass and disables Google's auto-optimisation (we already
  // ran nearest-neighbor client-side). Round trip: kitchen → stops → kitchen.
  const stops = orders.filter(o => o._c).map(o => `${o._c.lat},${o._c.lng}`);
  if (!stops.length) return null;
  const K = `${KITCHEN.lat},${KITCHEN.lng}`;

  // Google Maps directions URL caps practical waypoint count around 9; if more,
  // we still include them but the customer/driver may need to split.
  const params = new URLSearchParams({
    api:           "1",
    origin:        K,
    destination:   K,
    travelmode:    "driving",
    waypoints:     stops.join("|")
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function optimizeRoute(meal) {
  const orders = _ordersData[meal];
  if (!orders || !orders.length) return;

  const { route, dist } = nearestNeighbor(orders);
  _ordersData[meal] = route;
  if (dist) _routeDists[meal] = dist; // save for end-of-day summary

  // Re-number and re-render cards only (keep route bar)
  const cardsHtml = route.map((o,i) => renderCard(o, i, meal)).join("");
  // Replace cards after the route-bar div
  const panel = document.getElementById("panel_"+meal);
  const routeBar = document.getElementById("routeBar_"+meal);
  // Remove all children except routeBar
  [...panel.children].forEach(el => { if (el !== routeBar) el.remove(); });
  panel.insertAdjacentHTML("beforeend", cardsHtml);

  // Update route info
  const infoEl = document.getElementById("routeInfo_"+meal);
  if (infoEl) infoEl.innerHTML = `<span style="color:#27ae60;font-weight:600;">✅ Optimised${dist ? " · ~"+dist+" km" : ""}</span>`;

  // Show Maps link
  const mapsUrl = buildMapsUrl(route);
  const linkEl  = document.getElementById("routeLink_"+meal);
  if (linkEl && mapsUrl) { linkEl.href = mapsUrl; linkEl.style.display = "block"; }
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function switchTab(meal) {
  ["Breakfast","Lunch","Dinner"].forEach(m => {
    document.getElementById("tab_"+m).classList.toggle("active", m===meal);
    document.getElementById("panel_"+m).classList.toggle("active", m===meal);
  });
  updateProgress(meal);
}

document.getElementById("datePicker").value = todayIST();

// ── SCREEN WAKE LOCK ──
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
    el.textContent = "⚡ Wake: On";
    el.classList.add("active");
  } else {
    el.textContent = "⚡ Wake: Off (Click)";
    el.classList.remove("active");
  }
}

document.addEventListener('click', () => {
  if (!wakeLock) requestWakeLock();
}, { once: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

// Auto-Login
window.onload = () => {
  requestWakeLock();
  const saved = localStorage.getItem('sk-driver-pin');
  if (saved && saved.length === 4) {
    verifyPin(saved);
  }
};

// ── EXPORT DELIVERY SHEET ────────────────────────────────────────────────────
function _defaultExportMeal() {
  // Use IST time (UTC+5:30) to pick the most relevant meal
  const nowUtc  = new Date();
  const istHour = (nowUtc.getUTCHours() + 5) + (nowUtc.getUTCMinutes() + 30) / 60;
  // before 08:00 IST → Breakfast | before 14:00 IST → Lunch | else → Dinner
  if (istHour < 8)   return "Breakfast";
  if (istHour < 14)  return "Lunch";
  return "Dinner";
}

function openExportModal() {
  // Default: today's date + time-based meal; user can override
  const todayIST = (() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 330); // shift to IST
    return d.toISOString().slice(0, 10);
  })();
  document.getElementById("exportDate").value = todayIST;
  document.getElementById("exportMeal").value = _defaultExportMeal();
  document.getElementById("exportModal").style.display = "flex";
}

function closeExportModal() {
  document.getElementById("exportModal").style.display = "none";
}

async function confirmExport() {
  const date = document.getElementById("exportDate").value;
  const meal = document.getElementById("exportMeal").value;
  if (!date) { alert("Please select a date."); return; }

  closeExportModal();
  sLoading(true, "Creating Google Sheet…");

  try {
    const data = await safeFetchJson();
    if (data.error) throw new Error(data.error);
    if (!data.count) { alert(`No orders found for ${meal} on ${date}.`); return; }
    window.open(data.url, "_blank");
  } catch(e) {
    alert("Could not create sheet: " + e.message);
  } finally {
    sLoading(false);
  }
}
// ─────────────────────────────────────────────────────────────────────────────
