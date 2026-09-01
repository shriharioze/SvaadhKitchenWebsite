const fs = require('fs');

let code = fs.readFileSync('02_Orders_Menu.gs', 'utf8');

const target = `    if (soc.indexOf("shreelaxmivihar") !== -1) continue;
    const mt = String(r.Meal_Type || "").trim();
    if (c[mt] === undefined) continue;
    if (_isEnkin(r.Customer_Name)) { sawEnkin[mt] = true; continue; } // counted once below
    if (_isIA(r.Customer_Name))    { sawIA[mt]    = true; continue; } // counted once below
    // Unique name per meal — same customer placing 2 orders = 1 delivery slot.
    const nameKey = String(r.Customer_Name || "").trim().toLowerCase();
    if (!seen[mt][nameKey]) {
      seen[mt][nameKey] = true;
      c[mt]++;
    }
  }`;

const replacement = `    if (soc.indexOf("shreelaxmivihar") !== -1) continue;
    const mt = String(r.Meal_Type || "").trim();
    if (c[mt] === undefined) continue;
    if (_isEnkin(r.Customer_Name)) { sawEnkin[mt] = true; continue; }
    if (_isIA(r.Customer_Name))    { sawIA[mt]    = true; continue; }
    
    const nameKey = "name|" + String(r.Customer_Name || "").trim().toLowerCase();
    var f = String(r.Flat || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    var w = String(r.Wing || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    var sStr = typeof _normSocietyKey === "function" ? _normSocietyKey(r.Society) : _normSocietyBase(r.Society || "");
    var addrKey = "";
    if (f && sStr) addrKey = "addr|" + w + "|" + f + "|" + sStr;

    if (!seen[mt][nameKey] && (!addrKey || !seen[mt][addrKey])) {
      c[mt]++;
    }
    
    seen[mt][nameKey] = true;
    if (addrKey) seen[mt][addrKey] = true;
  }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('02_Orders_Menu.gs', code, 'utf8');
  console.log('Fixed 02_Orders_Menu.gs');
} else {
  console.log('Target not found in 02_Orders_Menu.gs');
}

let code2 = fs.readFileSync('03_Admin_Kitchen.gs', 'utf8');
const target2 = `        else {
          const nameKey = String(row.Customer_Name || "").trim().toLowerCase();
          if (nameKey && !seen[dd][meal][nameKey]) {
            seen[dd][meal][nameKey] = true;
            mealOrderCounts[dd][meal]++;
          }
        }`;

const replacement2 = `        else {
          const nameKey = "name|" + String(row.Customer_Name || "").trim().toLowerCase();
          var f = String(row.Flat || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
          var w = String(row.Wing || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
          var sStr = typeof _normSocietyKey === "function" ? _normSocietyKey(row.Society) : _normSocietyBase(row.Society || "");
          var addrKey = "";
          if (f && sStr) addrKey = "addr|" + w + "|" + f + "|" + sStr;

          if (!seen[dd][meal][nameKey] && (!addrKey || !seen[dd][meal][addrKey])) {
            mealOrderCounts[dd][meal]++;
          }
          
          seen[dd][meal][nameKey] = true;
          if (addrKey) seen[dd][meal][addrKey] = true;
        }`;

if (code2.includes(target2)) {
  code2 = code2.replace(target2, replacement2);
  fs.writeFileSync('03_Admin_Kitchen.gs', code2, 'utf8');
  console.log('Fixed 03_Admin_Kitchen.gs');
} else {
  console.log('Target not found in 03_Admin_Kitchen.gs');
}
