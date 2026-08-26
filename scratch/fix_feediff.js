const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_differential.js", "utf8");
const a = `  let ok = main.rows.length === ls.rows.length;
  // NOTE: totalFood INCLUDES delivery+smallFee, so it legitimately differs on LS.
  // Compare pure food (baseFood) instead.
  const bfMain = main.rows.reduce((s, r) => s + r.baseFood, 0);
  const bfLs = ls.rows.reduce((s, r) => s + r.baseFood, 0);
  if (ok && Math.abs(bfMain - bfLs) > 0.001) ok = false;
  let delivDiff = 0, expectedDiff = 0;
  for (let i = 0; ok && i < main.rows.length; i++) {
    const a = main.rows[i], b = ls.rows[i];
    delivDiff += a.delivery - b.delivery;
    if (a.delivery === 11) expectedDiff += 11;   // delivery removed on LS
    if (a.smallFee === 11) expectedDiff += 11;   // small-order fee also removed on LS
    if (b.delivery !== 0) { ok = false; break; }
    if (b.smallFee !== 0) { ok = false; break; }  // LS: no small-order fee either
    if (a.baseFood !== b.baseFood) { ok = false; break; }
  }
  if (ok && Math.round(delivDiff) !== expectedDiff) ok = false;
  // LS total must be ≤ main total, and ≥ main − 22×rows (delivery + smallFee both removed)
  if (ok && (ls.total > main.total || ls.total < main.total - 22 * main.rows.length)) ok = false;
  if (!ok) {
    T(\`batch#\${t}\`, false, \`main=\${main.total} ls=\${ls.total} delivDiff=\${delivDiff}\\nCTX=\${JSON.stringify(ctx)} rate=\${rate} nRows=\${main.rows.length}\\nMAINrows=\${JSON.stringify(main.rows.map(r => [r.date, r.meal, r.baseFood, r.delivery, r.smallFee, r.discount, r.net]))}\\nLSrows=\${JSON.stringify(ls.rows.map(r => [r.date, r.meal, r.baseFood, r.delivery, r.smallFee, r.discount, r.net]))}\`);
    break;
  } else pass++;`;
const b = `  let ok = main.rows.length === ls.rows.length;
  // NOTE: totalFood INCLUDES delivery+smallFee, so it legitimately differs on LS.
  // Compare pure food (baseFood) instead.
  const bfMain = main.rows.reduce((s, r) => s + r.baseFood, 0);
  const bfLs = ls.rows.reduce((s, r) => s + r.baseFood, 0);
  if (ok && Math.abs(bfMain - bfLs) > 0.001) ok = false;
  let feeDiff = 0, expectedFeeDiff = 0;
  for (let i = 0; ok && i < main.rows.length; i++) {
    const a = main.rows[i], b = ls.rows[i];
    feeDiff += (a.delivery - b.delivery) + (a.smallFee - b.smallFee);
    if (a.delivery === 11) expectedFeeDiff += 11;
    if (a.smallFee === 11) expectedFeeDiff += 11;
    if (b.delivery !== 0) { ok = false; break; }
    if (b.smallFee !== 0) { ok = false; break; }
    if (a.baseFood !== b.baseFood) { ok = false; break; }
  }
  if (ok && Math.round(feeDiff) !== expectedFeeDiff) ok = false;
  // LS total must be ≤ main total (fees + discount pool shrink), and not absurdly lower
  if (ok && (ls.total > main.total || ls.total < main.total - 22 * main.rows.length)) ok = false;
  if (!ok) {
    T(\`batch#\${t}\`, false, \`main=\${main.total} ls=\${ls.total} feeDiff=\${feeDiff} expectedFeeDiff=\${expectedFeeDiff}\\nCTX=\${JSON.stringify(ctx)} rate=\${rate} nRows=\${main.rows.length}\\nMAINrows=\${JSON.stringify(main.rows.map(r => [r.date, r.meal, r.baseFood, r.delivery, r.smallFee, r.discount, r.net]))}\\nLSrows=\${JSON.stringify(ls.rows.map(r => [r.date, r.meal, r.baseFood, r.delivery, r.smallFee, r.discount, r.net]))}\`);
    break;
  } else pass++;`;
if (c.includes(a)) { c = c.replace(a, b); fs.writeFileSync("scratch/test_ls_differential.js", c); console.log("fixed"); }
else { console.log("MISS — dumping current block"); const i = c.indexOf("let delivDiff"); console.log(c.slice(i - 100, i + 1200)); }
