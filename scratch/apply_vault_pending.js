const fs = require('fs');

let html = fs.readFileSync('docs/Admin/vault_admin.html', 'utf8');

// 1. Bump versions to v26.08.27.01
html = html.replace(/<meta name="app-version" content="[^"]*">/, '<meta name="app-version" content="v26.08.27.01">');
html = html.replace(/const APP_VERSION = "[^"]*";/, 'const APP_VERSION = "v26.08.27.01";');
html = html.replace(/const ADMIN_VERSION = "[^"]*";/, 'const ADMIN_VERSION = "v26.08.27.01";');

// 2. Update loadAnalytics and renderAnalytics
const oldLoadAnalytics = `async function loadAnalytics() {
  const from = document.getElementById("analyticsFrom").value;
  const to   = document.getElementById("analyticsTo").value;
  if (!from || !to) { toast("Pick a date range first"); return; }
  const el = document.getElementById("analyticsContent");
  el.innerHTML = \`<div style="text-align:center;padding:40px;"><div class="spinner" style="margin:0 auto;"></div></div>\`;
  try {
    const data = await safeFetchJson(\`\${APPS_SCRIPT_URL}?action=getAnalytics&dateFrom=\${from}&dateTo=\${to}&pin=\${S.sessionPin}&_t=\${Date.now()}\`);
    if (!data.success) throw new Error(data.error);
    el.innerHTML = renderAnalytics(data, from, to);
  } catch(e) {
    el.innerHTML = \`<p style="color:var(--red);text-align:center;padding:30px;">Error: \${e.message}</p>\`;
  }
}`;

const newLoadAnalytics = `let _lastAnalyticsData = null;
let _lastAnalyticsFrom = "";
let _lastAnalyticsTo = "";

async function loadAnalytics() {
  const from = document.getElementById("analyticsFrom").value;
  const to   = document.getElementById("analyticsTo").value;
  if (!from || !to) { toast("Pick a date range first"); return; }
  const el = document.getElementById("analyticsContent");
  el.innerHTML = \`<div style="text-align:center;padding:40px;"><div class="spinner" style="margin:0 auto;"></div></div>\`;
  try {
    const data = await safeFetchJson(\`\${APPS_SCRIPT_URL}?action=getAnalytics&dateFrom=\${from}&dateTo=\${to}&pin=\${S.sessionPin}&_t=\${Date.now()}\`);
    if (!data.success) throw new Error(data.error);
    _lastAnalyticsData = data;
    _lastAnalyticsFrom = from;
    _lastAnalyticsTo = to;
    el.innerHTML = renderAnalytics(data, from, to);
  } catch(e) {
    el.innerHTML = \`<p style="color:var(--red);text-align:center;padding:30px;">Error: \${e.message}</p>\`;
  }
}`;

html = html.replace(oldLoadAnalytics, newLoadAnalytics);
html = html.replace(oldLoadAnalytics.replace(/\n/g, '\r\n'), newLoadAnalytics.replace(/\n/g, '\r\n'));

// Update the Pending KPI card
const oldPendingCard = `<div class="kpi-card gold"><div class="kv">\${fmtM(summary.pending)}</div><div class="kl">Pending</div></div>`;
const newPendingCard = `<div class="kpi-card gold" style="cursor:pointer;position:relative;border:2px solid #f59e0b;background:#fffdf5;box-shadow:0 2px 8px rgba(245,158,11,0.15);transition:transform .12s ease;" onclick="openPendingAnalyticsModal()" title="Click to view pending customers & orders" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
      <div class="kv" style="color:#b45309;">\${fmtM(summary.pending)}</div>
      <div class="kl" style="color:#b45309;font-weight:700;display:flex;align-items:center;justify-content:center;gap:4px;">
        <span>Pending</span>
        <span style="font-size:.65rem;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:10px;border:1px solid #fde68a;">Click to View ↗</span>
      </div>
    </div>`;

html = html.replace(oldPendingCard, newPendingCard);

// 3. Add Modal Functions for Pending Orders Drilldown and Mark Paid
const modalFunctions = `
// ════════════════════════════════════════════════════════════════════
// ANALYTICS PENDING ORDERS & CUSTOMERS DRILL-DOWN MODAL
// ════════════════════════════════════════════════════════════════════
let _pendingModalState = {
  customers: [],
  selectedSids: new Set()
};

function openPendingAnalyticsModal() {
  if (!_lastAnalyticsData) { toast("Please load analytics first"); return; }
  const data = _lastAnalyticsData;
  const customers = data.pendingCustomers || [];
  _pendingModalState.customers = JSON.parse(JSON.stringify(customers));
  _pendingModalState.selectedSids.clear();

  const fmtM = v => \`₹\${Number(v).toLocaleString("en-IN")}\`;
  const fmtD = d => { if(!d) return ""; const p=d.split("-"); return p.length===3 ? \`\${p[2]}/\${p[1]}/\${p[0]}\` : d; };
  const from = _lastAnalyticsFrom;
  const to = _lastAnalyticsTo;
  
  const totalPendingAmt = _pendingModalState.customers.reduce((s, c) => s + (c.totalPending || 0), 0);
  const totalOrdersCount = _pendingModalState.customers.reduce((s, c) => s + (c.orders ? c.orders.length : 0), 0);

  const ex = document.getElementById("pendingAnalyticsModal");
  if (ex) ex.remove();

  const ov = document.createElement("div");
  ov.id = "pendingAnalyticsModal";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:75000;display:flex;align-items:center;justify-content:center;padding:12px;backdrop-filter:blur(2px);";

  ov.innerHTML = \`
    <div style="background:#fff;border-radius:16px;max-width:680px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,0.35);overflow:hidden;font-family:inherit;">
      
      <!-- HEADER -->
      <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc;position:relative;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <div>
            <div style="font-size:1.15rem;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:6px;">
              <span>⏳ Unpaid / Pending Orders</span>
            </div>
            <div style="font-size:0.8rem;color:#64748b;margin-top:2px;">
              Period: <b>\${fmtD(from)}</b> to <b>\${fmtD(to)}</b> &nbsp;·&nbsp; Total Pending: <b style="color:#d97706;">\${fmtM(totalPendingAmt)}</b> (\${_pendingModalState.customers.length} customers, \${totalOrdersCount} orders)
            </div>
          </div>
          <button onclick="document.getElementById('pendingAnalyticsModal').remove()" style="border:none;background:#e2e8f0;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1.1rem;color:#475569;display:flex;align-items:center;justify-content:center;transition:background .15s ease;" onmouseover="this.style.background='#cbd5e1'" onmouseout="this.style.background='#e2e8f0'">✕</button>
        </div>
        
        <!-- SEARCH BAR -->
        <div style="margin-top:12px;position:relative;">
          <input type="text" id="pendingCustSearch" placeholder="🔍 Search customer by name or phone..." oninput="_filterPendingCustModal()" style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:.86rem;outline:none;box-sizing:border-box;">
        </div>
      </div>

      <!-- BODY: CUSTOMER ACCORDION LIST -->
      <div id="pendingCustListContainer" style="flex:1;overflow-y:auto;padding:14px 18px;background:#f1f5f9;display:flex;flex-direction:column;gap:10px;">
        \${_renderPendingCustListHtml(_pendingModalState.customers)}
      </div>

      <!-- FOOTER ACTION BAR -->
      <div style="padding:12px 18px;border-top:1px solid #e2e8f0;background:#ffffff;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="font-size:0.84rem;color:#334155;">
          Selected: <b id="pendingSelCount" style="color:#0f172a;">0</b> orders (<b id="pendingSelAmt" style="color:#16a34a;">₹0</b>)
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" onclick="_toggleSelectAllPendingOrders()" style="padding:8px 12px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;font-size:.82rem;font-weight:600;cursor:pointer;">Toggle All</button>
          <button type="button" id="btnMarkSelectedPaid" onclick="_handleMarkSelectedPaidClick()" style="padding:8px 16px;border:none;background:#16a34a;color:#fff;border-radius:8px;font-size:.84rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 2px 6px rgba(22,163,74,0.3);transition:background .15s ease;" onmouseover="this.style.background='#15803d'" onmouseout="this.style.background='#16a34a'">
            <span>✓ Mark Selected as Paid</span>
          </button>
        </div>
      </div>

    </div>\`;

  ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  _updatePendingSelectionSummary();
}

function _renderPendingCustListHtml(customers) {
  const fmtM = v => \`₹\${Number(v).toLocaleString("en-IN")}\`;
  const fmtD = d => { if(!d) return ""; const p=d.split("-"); return p.length===3 ? \`\${p[2]}/\${p[1]}/\${p[0]}\` : d; };
  const MEAL_ICONS = {Breakfast:"🌅",Lunch:"☀️",Dinner:"🌙"};

  if (!customers || !customers.length) {
    return \`<div style="text-align:center;padding:36px;color:#64748b;background:#fff;border-radius:12px;">
      <div style="font-size:2rem;margin-bottom:6px;">🎉</div>
      <div style="font-weight:700;font-size:.95rem;">No unpaid orders found!</div>
      <div style="font-size:.8rem;margin-top:2px;">All orders in this date range are collected/paid.</div>
    </div>\`;
  }

  return customers.map((c, cIdx) => {
    const custId = \`pending_cust_\${c.phone || cIdx}\`;
    const orders = c.orders || [];
    const orderRowsHtml = orders.map((o, oIdx) => {
      const isPaid = (o.status === "Paid" || o.status === "Wallet Paid" || o.status === "Collected");
      const sid = String(o.sid || \`\${o.phone}_\${o.date}_\${o.meal}\`);
      const isChecked = _pendingModalState.selectedSids.has(sid);
      const icon = MEAL_ICONS[o.meal] || "🍽️";

      return \`
        <div id="pord_row_\${sid}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #f1f5f9;\${isPaid ? 'background:#f0fdf4;opacity:0.65;' : 'background:#fff;'}font-size:.82rem;">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
            \${isPaid ? \`<span style="color:#16a34a;font-weight:700;font-size:.85rem;">✓</span>\` : \`<input type="checkbox" class="pending-ord-cb" data-phone="\${c.phone}" data-date="\${o.date}" data-sid="\${o.sid||''}" data-amount="\${o.amount}" \${isChecked ? 'checked' : ''} onchange="_onPendingOrderCheckboxChange(this, '\${sid}')" style="cursor:pointer;width:16px;height:16px;accent-color:#16a34a;">\`}
            <div style="min-width:0;">
              <div style="font-weight:700;color:#1e293b;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span>\${fmtD(o.date)}</span>
                <span style="font-size:.74rem;background:#e2e8f0;padding:1px 6px;border-radius:4px;color:#334155;">\${icon} \${o.meal}</span>
                \${o.isLS ? \`<span style="font-size:.7rem;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:4px;font-weight:700;">[LS]</span>\` : ''}
                <span style="font-size:.72rem;color:\${isPaid ? '#16a34a' : '#d97706'};font-weight:600;">[\${o.status || 'Pending'}]</span>
              </div>
              \${o.summary && o.summary !== '—' ? \`<div style="font-size:.74rem;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;" title="\${o.summary}">\${o.summary}</div>\` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
            <div style="font-weight:800;font-size:.88rem;\${isPaid ? 'color:#16a34a;text-decoration:line-through;' : 'color:#0f172a;'}">\${fmtM(o.amount)}</div>
            \${isPaid ? \`<span style="font-size:.72rem;background:#dcfce7;color:#15803d;padding:2px 6px;border-radius:4px;font-weight:700;">Paid</span>\` : \`<button type="button" onclick="_markSinglePendingOrderPaid('\${c.phone}', '\${o.date}', '\${o.sid||''}', \${o.amount})" style="padding:4px 8px;border:1px solid #86efac;background:#f0fdf4;color:#15803d;border-radius:6px;font-size:.72rem;font-weight:700;cursor:pointer;transition:all .15s ease;" onmouseover="this.style.background='#dcfce7'" onmouseout="this.style.background='#f0fdf4'">Paid ✓</button>\`}
          </div>
        </div>\`;
    }).join("");

    return \`
      <div class="pending-cust-card" data-phone="\${c.phone}" data-name="\${(c.name||'').toLowerCase()}" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <!-- CUSTOMER HEADER (ACCORDION TOGGLE) -->
        <div onclick="_togglePendingCustAccordion('\${custId}')" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;background:#ffffff;transition:background .15s ease;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#ffffff'">
          <div style="display:flex;align-items:center;gap:10px;">
            <span id="\${custId}_chev" style="font-size:.75rem;color:#64748b;transition:transform .15s ease;">▼</span>
            <div>
              <div style="font-weight:700;font-size:.9rem;color:#0f172a;display:flex;align-items:center;gap:6px;">
                <span>\${c.name || 'Customer'}</span>
              </div>
              <div style="font-size:.75rem;color:#64748b;">📞 \${c.phone}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;" onclick="event.stopPropagation();">
            <span style="font-size:.72rem;background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:12px;font-weight:600;">\${orders.length} order\${orders.length===1?'':'s'}</span>
            <span style="font-weight:800;font-size:.92rem;color:#d97706;background:#fffbeb;padding:2px 8px;border-radius:8px;border:1px solid #fef3c7;">\${fmtM(c.totalPending)}</span>
            <button type="button" onclick="_toggleSelectCustAllOrders('\${c.phone}')" title="Select all orders for this customer" style="padding:3px 7px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:6px;font-size:.7rem;font-weight:600;cursor:pointer;">Select All</button>
          </div>
        </div>

        <!-- ORDERS ACCORDION BODY -->
        <div id="\${custId}_body" style="display:block;border-top:1px solid #f1f5f9;background:#fafafa;">
          \${orderRowsHtml}
        </div>
      </div>\`;
  }).join("");
}

function _togglePendingCustAccordion(custId) {
  const body = document.getElementById(\`\${custId}_body\`);
  const chev = document.getElementById(\`\${custId}_chev\`);
  if (!body) return;
  if (body.style.display === "none") {
    body.style.display = "block";
    if (chev) chev.textContent = "▼";
  } else {
    body.style.display = "none";
    if (chev) chev.textContent = "▶";
  }
}

function _filterPendingCustModal() {
  const q = (document.getElementById("pendingCustSearch").value || "").trim().toLowerCase();
  const cards = document.querySelectorAll(".pending-cust-card");
  cards.forEach(card => {
    const name = card.getAttribute("data-name") || "";
    const phone = card.getAttribute("data-phone") || "";
    if (!q || name.includes(q) || phone.includes(q)) {
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }
  });
}

function _onPendingOrderCheckboxChange(cb, sid) {
  if (cb.checked) {
    _pendingModalState.selectedSids.add(sid);
  } else {
    _pendingModalState.selectedSids.delete(sid);
  }
  _updatePendingSelectionSummary();
}

function _toggleSelectCustAllOrders(phone) {
  const c = _pendingModalState.customers.find(x => String(x.phone).trim() === String(phone).trim());
  if (!c || !c.orders) return;
  
  const allSids = c.orders.map(o => String(o.sid || \`\${o.phone}_\${o.date}_\${o.meal}\`));
  const allSelected = allSids.every(sid => _pendingModalState.selectedSids.has(sid));
  
  allSids.forEach(sid => {
    if (allSelected) {
      _pendingModalState.selectedSids.delete(sid);
    } else {
      _pendingModalState.selectedSids.add(sid);
    }
  });

  const cbs = document.querySelectorAll(\`.pending-ord-cb[data-phone="\${phone}"]\`);
  cbs.forEach(cb => { cb.checked = !allSelected; });
  _updatePendingSelectionSummary();
}

function _toggleSelectAllPendingOrders() {
  let anyUnselected = false;
  const allOrders = [];
  _pendingModalState.customers.forEach(c => {
    (c.orders || []).forEach(o => {
      if (o.status !== "Paid" && o.status !== "Wallet Paid" && o.status !== "Collected") {
        const sid = String(o.sid || \`\${o.phone}_\${o.date}_\${o.meal}\`);
        allOrders.push(sid);
        if (!_pendingModalState.selectedSids.has(sid)) anyUnselected = true;
      }
    });
  });

  allOrders.forEach(sid => {
    if (anyUnselected) {
      _pendingModalState.selectedSids.add(sid);
    } else {
      _pendingModalState.selectedSids.delete(sid);
    }
  });

  const cbs = document.querySelectorAll(".pending-ord-cb");
  cbs.forEach(cb => { cb.checked = anyUnselected; });
  _updatePendingSelectionSummary();
}

function _updatePendingSelectionSummary() {
  let count = 0;
  let sum = 0;
  _pendingModalState.customers.forEach(c => {
    (c.orders || []).forEach(o => {
      const sid = String(o.sid || \`\${o.phone}_\${o.date}_\${o.meal}\`);
      if (_pendingModalState.selectedSids.has(sid)) {
        count++;
        sum += Number(o.amount) || 0;
      }
    });
  });

  const fmtM = v => \`₹\${Number(v).toLocaleString("en-IN")}\`;
  const cntEl = document.getElementById("pendingSelCount");
  const amtEl = document.getElementById("pendingSelAmt");
  if (cntEl) cntEl.textContent = count;
  if (amtEl) amtEl.textContent = fmtM(sum);
}

async function _markSinglePendingOrderPaid(phone, date, sid, amount) {
  const confirmed = await sConfirm(\`Mark order on \${date} (₹\${amount}) for \${phone} as Paid?\`, "Confirm Payment", "💰");
  if (!confirmed) return;

  sLoading(true, "Marking order as Paid...");
  try {
    const res = await safeFetchJson(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: JSON.stringify({
        _action: "markOrdersStatus",
        pin: S.sessionPin,
        phone: phone,
        date: date,
        sid: sid,
        status: "Paid"
      })
    });
    if (!res.success) throw new Error(res.error || "Failed to update order status");

    // Update in-memory modal state
    _applyLocalPaidStatus([{ phone, date, sid, amount }]);
    toast(\`✅ Order marked as Paid (₹\${amount})!\`);
    // Refresh background analytics silently
    try { loadAnalytics(); } catch(_) {}
  } catch(e) {
    sAlert(e.message, "Update Failed", "❌");
  } finally {
    sLoading(false);
  }
}

async function _handleMarkSelectedPaidClick() {
  const selectedList = [];
  _pendingModalState.customers.forEach(c => {
    (c.orders || []).forEach(o => {
      const sid = String(o.sid || \`\${o.phone}_\${o.date}_\${o.meal}\`);
      if (_pendingModalState.selectedSids.has(sid)) {
        selectedList.push({ phone: c.phone, date: o.date, sid: o.sid, amount: o.amount });
      }
    });
  });

  if (!selectedList.length) {
    toast("Select at least one order to mark as Paid");
    return;
  }

  const totalSum = selectedList.reduce((s, x) => s + (Number(x.amount)||0), 0);
  const confirmed = await sConfirm(\`Mark \${selectedList.length} selected order(s) totalling ₹\${totalSum.toLocaleString("en-IN")} as Paid?\`, "Mark Orders Paid", "💰");
  if (!confirmed) return;

  sLoading(true, \`Updating \${selectedList.length} order(s)...\`);
  let successCount = 0;
  let errors = [];

  try {
    for (let i = 0; i < selectedList.length; i++) {
      const item = selectedList[i];
      try {
        const res = await safeFetchJson(APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: JSON.stringify({
            _action: "markOrdersStatus",
            pin: S.sessionPin,
            phone: item.phone,
            date: item.date,
            sid: item.sid,
            status: "Paid"
          })
        });
        if (res.success) successCount++;
        else errors.push(\`\${item.date} (\${item.phone}): \${res.error}\`);
      } catch(err) {
        errors.push(\`\${item.date} (\${item.phone}): \${err.message}\`);
      }
    }

    _applyLocalPaidStatus(selectedList);
    toast(\`✅ \${successCount} of \${selectedList.length} order(s) marked as Paid!\`);
    if (errors.length) {
      console.warn("Some orders failed to update:", errors);
    }
    // Refresh background analytics
    try { loadAnalytics(); } catch(_) {}
  } finally {
    sLoading(false);
  }
}

function _applyLocalPaidStatus(updatedOrders) {
  updatedOrders.forEach(u => {
    const sid = String(u.sid || \`\${u.phone}_\${u.date}\`);
    _pendingModalState.selectedSids.delete(sid);
    
    // Update customer in modal state
    _pendingModalState.customers.forEach(c => {
      if (String(c.phone).trim() === String(u.phone).trim()) {
        (c.orders || []).forEach(o => {
          if ((u.sid && String(o.sid) === String(u.sid)) || (o.date === u.date && !u.sid)) {
            if (o.status !== "Paid" && o.status !== "Wallet Paid" && o.status !== "Collected") {
              o.status = "Paid";
              c.totalPending = Math.max(0, c.totalPending - (Number(u.amount) || 0));
            }
          }
        });
      }
    });
  });

  // Re-render container body
  const container = document.getElementById("pendingCustListContainer");
  if (container) {
    container.innerHTML = _renderPendingCustListHtml(_pendingModalState.customers);
  }
  _updatePendingSelectionSummary();
}
`;

html += '\n' + modalFunctions;

fs.writeFileSync('docs/Admin/vault_admin.html', html, 'utf8');
console.log('vault_admin.html updated successfully with pending analytics modal functions');
