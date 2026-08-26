const fs = require("fs");

// ── 1. Add text-format enforcement to _customersTabFor (13_LivianoSerio.gs) ──
let ls = fs.readFileSync("13_LivianoSerio.gs", "utf8");
const anchor1 = "  return ws;\n}";
// Find the _customersTabFor function closing and add text-col enforcement before return
const old1 = `    console.log("Created " + TAB_LS_CUSTOMERS + " tab (schema cloned from SK_Customers).");
    return created;`;
const new1 = `    console.log("Created " + TAB_LS_CUSTOMERS + " tab (schema cloned from SK_Customers).");
    _forceCustomerTextCols(created);
    return created;`;
if (ls.includes(old1)) { ls = ls.replace(old1, new1); console.log("_customersTabFor creation ✓"); }
else console.log("MISS _customersTabFor creation");

// Also apply to existing tab on every access (idempotent)
const old1b = `  return getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
}`;
const new1b = `  var _skC = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  _forceCustomerTextCols(_skC);
  return _skC;
}`;
// This is the else path — but it's the main-site return, don't want to slow it down.
// Instead, add the helper + apply only on LS path.
// Revert the else-path change if it was applied:
// Actually the function structure is: if LS → lazy create + return created; else → return getOrCreateTab(SK)
// Let me just add the helper function and call it on the LS creation path + on the LS tab when accessed.

// Add the helper function before _lsPickupLabel
const helper = `
// Force Phone (col 1) and PIN (col 14 = "PIN" in CUSTOMERS_HEADERS) to TEXT format
// so Google Sheets never coerces "0001" → 1. Same as ia_forceTextCols for IA_Customers.
// Safe to call repeatedly. Column indices derived from CUSTOMERS_HEADERS positions.
function _forceCustomerTextCols(ws) {
  try {
    ws.getRange("A2:A").setNumberFormat("@");  // Phone (col 1)
    ws.getRange("N2:N").setNumberFormat("@");  // PIN (col 14)
  } catch (e) {}
}
`;
const helperAnchor = "// Self-pickup label for order rows:";
if (ls.includes(helperAnchor)) {
  ls = ls.replace(helperAnchor, helper + "\n" + helperAnchor);
  console.log("_forceCustomerTextCols helper added ✓");
} else console.log("MISS helper anchor");

// Also apply on LS tab re-access (not just creation)
const old1c = `  return ws;
}`;
// Find the _customersTabFor function specifically — it has TAB_LS_CUSTOMERS
const ctfStart = ls.indexOf("function _customersTabFor(ss, storefront) {");
if (ctfStart !== -1) {
  const ctfEnd = ls.indexOf("\n}", ctfStart);
  let ctfBody = ls.slice(ctfStart, ctfEnd + 2);
  if (ctfBody.includes("return ws;") && !ctfBody.includes("_forceCustomerTextCols(ws)")) {
    ctfBody = ctfBody.replace("  return ws;", "  _forceCustomerTextCols(ws);\n  return ws;");
    ls = ls.slice(0, ctfStart) + ctfBody + ls.slice(ctfEnd + 2);
    console.log("_customersTabFor re-access ✓");
  } else console.log("_customersTabFor re-access already has it or return ws not found");
}

fs.writeFileSync("13_LivianoSerio.gs", ls);

// ── 2. Fix PIN write in _upsertCustomer to preserve leading zeros ──
let om = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const oldPin = "update(\"PIN\", profile.pin);";
const newPin = "update(\"PIN\", profile.pin !== undefined && profile.pin !== \"\" ? \"'\" + String(profile.pin).trim() : profile.pin);";
if (om.includes(oldPin)) { om = om.replace(oldPin, newPin); console.log("_upsertCustomer PIN quote ✓"); }
else console.log("MISS _upsertCustomer PIN");

// Also fix the setPin POST handler in Code.gs — it calls _upsertCustomer with pin
// The quote fix above handles it since _upsertCustomer does the write.

// And fix _setPinAfterOtp which already uses quote — verify:
if (om.includes("setValue(\"'\" + String(newPin).trim())")) console.log("_setPinAfterOtp already has quote ✓");

fs.writeFileSync("02_Orders_Menu.gs", om);

// ── 3. Fix existing bad data in SK_Customers + LS_Customers ──
// Add a one-time admin endpoint to scan + fix PINs that lost leading zeros
let cg = fs.readFileSync("Code.gs", "utf8");
const diagAnchor = 'if (action === "archiveDueDryRun")';
const fixEndpoint = `    if (action === "fixCustomerPins") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(fixCustomerPins(p.commit === "1")); } // scan + fix PINs that lost leading zeros (dry-run unless commit=1)\n`;
if (cg.includes(diagAnchor)) {
  cg = cg.replace(diagAnchor, fixEndpoint + diagAnchor);
  fs.writeFileSync("Code.gs", cg);
  console.log("fixCustomerPins endpoint added ✓");
} else console.log("MISS Code.gs endpoint");

// Add the fixCustomerPins function to 02_Orders_Menu.gs
const fixFn = `

// ── FIX CUSTOMER PINS: scan SK_Customers + LS_Customers for PINs that were ──
// coerced to numbers by Google Sheets (e.g. "0001" → 1). Re-writes them as
// text with the original leading zeros restored. DRY-RUN by default.
// Known PIN lengths: 4 digits (standard). Pads with zeros to 4 digits.
function fixCustomerPins(commit) {
  var ss = getSpreadsheet();
  var results = { sk: { scanned: 0, fixed: 0 }, ls: { scanned: 0, fixed: 0 } };
  var tabs = [
    { ws: getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS), key: "sk" },
    { ws: (typeof _lsOrdersWs === "function" ? (ss.getSheetByName(TAB_LS_CUSTOMERS) || null) : null), key: "ls" }
  ];
  tabs.forEach(function (tab) {
    if (!tab.ws) return;
    var ws = tab.ws;
    var res = results[tab.key];
    // Force text format first so fixes stick
    try { ws.getRange("A2:A").setNumberFormat("@"); ws.getRange("N2:N").setNumberFormat("@"); } catch (e) {}
    var lastRow = ws.getLastRow();
    if (lastRow < 2) return;
    var pinCol = CUSTOMERS_HEADERS.indexOf("PIN") + 1; // column 14
    var pinValues = ws.getRange(2, pinCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < pinValues.length; i++) {
      res.scanned++;
      var v = pinValues[i][0];
      if (v === "" || v === null || v === undefined) continue;
      // If it's a number (not string), it lost its leading zeros
      if (typeof v === "number") {
        var padded = ("0000" + Math.round(v)).slice(-4);
        if (commit === true || commit === "true") {
          ws.getRange(i + 2, pinCol).setNumberFormat("@").setValue("'" + padded);
        }
        res.fixed++;
        Logger.log("fixCustomerPins: row " + (i + 2) + " PIN " + v + " → '" + padded);
      } else if (typeof v === "string" && v.length < 4 && !isNaN(Number(v))) {
        // String but shorter than 4 — also coerced (e.g. "001" → "1" → stored as text "1")
        var padded2 = ("0000" + Number(v)).slice(-4);
        if (v !== padded2) {
          if (commit === true || commit === "true") {
            ws.getRange(i + 2, pinCol).setNumberFormat("@").setValue("'" + padded2);
          }
          res.fixed++;
        }
      }
    }
  });
  results.dryRun = !(commit === true || commit === "true");
  return results;
}
`;
om += fixFn;
fs.writeFileSync("02_Orders_Menu.gs", om);
console.log("fixCustomerPins function added ✓");

// ── syntax checks ──
["13_LivianoSerio.gs", "02_Orders_Menu.gs", "Code.gs"].forEach(f => {
  fs.copyFileSync(f, "scratch/syn_" + f.replace(".gs", ".js"));
});
