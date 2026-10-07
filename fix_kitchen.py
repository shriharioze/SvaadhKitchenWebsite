# Read claude.md and bump version number for pages with changes

import os
import re

target_path = r'c:\Users\admin\Downloads\LLM Course\Projects\ChatBot - final\docs\Admin\kitchen.html'
if not os.path.exists(target_path):
    print(f"File not found: {target_path}")
    exit(1)

with open(target_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update Tabs Header
tabs_pattern = r' +<div class="ktabs" style="display:flex; justify-content:space-between; align-items:center;">.*? +</button>\n +</div>'
new_tabs = '''      <div class="ktabs" style="display:flex; justify-content:center; align-items:center;">
        <div style="display:flex; gap:0;">
          <div class="ktab active" id="tab_Summary" onclick="switchKTab('Summary')">Summary</div>
          <div class="ktab" id="tab_Packing" onclick="switchKTab('Packing')">Packing</div>
          <div class="ktab" id="tab_Labels" onclick="switchKTab('Labels')">Labels</div>
        </div>
      </div>'''

content = re.sub(tabs_pattern, new_tabs, content, flags=re.DOTALL)

# 2. Update getCurrentMeal (already updated mostly, but let's be sure)
# Logic: Breakfast (00:00-08:45), Lunch (08:45-14:00), Dinner (14:00-21:00), Post-21:00 (Breakfast)

# 3. Fix renderKitchen Loop and variables
kitchen_func_pattern = r'function renderKitchen\(data\) \{.*?document\.getElementById\("kbody"\)\.innerHTML = html;\n +\}'
new_kitchen_func = '''function renderKitchen(data) {
      const meals = data.meals || {};
      let html = "";

      if (!Object.keys(meals).length) {
        html = `<div class="no-orders" style="display:flex;flex-direction:column;align-items:center;padding:40px;">
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

      const currentMeal = getCurrentMeal();
      if (!meals[currentMeal]) {
          document.getElementById("kbody").innerHTML = `<div class="no-orders" style="padding:40px; text-align:center;">🎉 No ${currentMeal} orders found!</div>`;
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
          <div class="cook-breakdown">${s.dry_mini || 0} Mini + ${s.dry_full || 0} Full</div>
        </div>` : ""}
        ${showCurry ? `
        <div class="sabji-cook-card">
          <div class="cook-label">🍲 <strong>${curryDisplayName}</strong></div>
          <div class="cook-val">${cRes.val}</div>
          <div class="cook-unit">${cRes.unit}</div>
          <div class="cook-breakdown">${s.curry_mini || 0} Mini + ${s.curry_full || 0} Full</div>
        </div>` : ""}
      </div>`;

        const dal = current_m.other["Dal"];
        const otherHtml = `
      <div class="item-card ${dal.kg === 0 ? "zero" : ""}">
        <span class="iname">${mr("Dal")}</span>
        <span class="inum">${dal.kg}</span>
      </div>` +
          ["Rice", "Salad", "Curd"].map(name => {
            const o = current_m.other[name];
            return `<div class="item-card ${o.count === 0 ? "zero" : ""}">
          <span class="iname">${mr(name)}</span>
          <span class="inum">${o.count}</span>
        </div>`;
          }).join("");

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
      </div>
    </div>`;
      }
      document.getElementById("kbody").innerHTML = html;
    }'''

content = re.sub(kitchen_func_pattern, new_kitchen_func, content, flags=re.DOTALL)

# 4. Fix renderPacking Variables
packing_head_pattern = r'function renderPacking\(data\) \{.*?const currentMeal = getCurrentMeal\(\);'
new_packing_head = '''function renderPacking(data) {
      const meals = data.meals || {};
      let html = "";

      if (!Object.keys(meals).length) {
        html = `<div class="no-orders">No orders set for ${data.date}</div>`;
        document.getElementById("kbody").innerHTML = html;
        return;
      }
      const MEAL_META = {
        Breakfast: { icon: "🌅", label: "न्याहारी" },
        Lunch: { icon: "☀️", label: "दुपारचे जेवण" },
        Dinner: { icon: "🌙", label: "रात्रीचे जेवण" },
      };

      const currentMeal = getCurrentMeal();'''

content = re.sub(packing_head_pattern, new_packing_head, content, flags=re.DOTALL)

# Also fix the weird doubled declarations in packing
doubled_p_pattern = r'if \(meals\[currentMeal\]\) \{.*?const curd = \(m\.items \|\| {}\)\[\"Curd\"\] \|\| 0;'
new_doubled_p = '''if (meals[currentMeal]) {
        const m = meals[currentMeal];
        const { icon, label } = MEAL_META[currentMeal];

        const packs = [];
        if (currentMeal === "Breakfast") {
          const curd = (m.items || {})["Curd"] || 0;'''

content = re.sub(doubled_p_pattern, new_doubled_p, content, flags=re.DOTALL)

with open(target_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fix applied successfully.")
