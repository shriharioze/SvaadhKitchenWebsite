const fs = require('fs');

let code = fs.readFileSync('02_Orders_Menu.gs', 'utf8');
const lines = code.split('\n');

const startIndex = lines.findIndex(l => l.includes('const ar = String(r.Area || "").toLowerCase();'));
const endIndex = lines.findIndex((l, i) => i > startIndex && l === '  }');

if (startIndex !== -1 && endIndex !== -1 && endIndex - startIndex < 100) {
  const replacement = `    const ar = String(r.Area || "").toLowerCase();
    if (ar.indexOf("pickup") !== -1 || ar === "porter") continue;
    const soc = _normSocietyBase(r.Society || "");
    if (soc.indexOf("shreelaxmivihar") !== -1) continue;
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

  lines.splice(startIndex, endIndex - startIndex + 1, replacement);
  fs.writeFileSync('02_Orders_Menu.gs', lines.join('\n'), 'utf8');
  console.log('Successfully fixed 02_Orders_Menu.gs');
} else {
  console.log('Could not find bounds to replace in 02_Orders_Menu.gs');
}
