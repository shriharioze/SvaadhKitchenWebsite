const fs = require('fs');

// 1. Update 02_Orders_Menu.gs
let code02 = fs.readFileSync('02_Orders_Menu.gs', 'utf8');
const target02 = 'try { reconcileMissedOrdersLog(); } catch (e) { Logger.log("reconcileMissedOrdersLog: " + (e && e.message)); }';
const replace02 = 'try { reconcileMissedOrdersLog(); } catch (e) { Logger.log("reconcileMissedOrdersLog: " + (e && e.message)); }\r\n  // Auto-recover dropped charged orders from SK_Order_Log stash (10-60 min window)\r\n  try { recoverFromOrderLog(); } catch (e) { Logger.log("recoverFromOrderLog: " + (e && e.message)); }';

if (code02.includes(target02)) {
  code02 = code02.replace(target02, replace02);
  fs.writeFileSync('02_Orders_Menu.gs', code02, 'utf8');
  console.log('02_Orders_Menu.gs updated OK');
} else {
  console.error('02_Orders_Menu.gs target not found');
}

// 2. Update 04_Reports_Misc.gs
let code04 = fs.readFileSync('04_Reports_Misc.gs', 'utf8');
const oldCatch = '} catch (e) { Logger.log("recoverFromOrderLog error: " + e.message); }\r\n}';
const oldCatchLF = '} catch (e) { Logger.log("recoverFromOrderLog error: " + e.message); }\n}';
const newReturn = '    return { success: true, recovered: recovered, details: recoveredDetails };\r\n  } catch (e) { Logger.log("recoverFromOrderLog error: " + e.message); return { success: false, error: e.message }; }\r\n}';

if (code04.includes(oldCatch)) {
  code04 = code04.replace(oldCatch, newReturn);
  fs.writeFileSync('04_Reports_Misc.gs', code04, 'utf8');
  console.log('04_Reports_Misc.gs updated OK');
} else if (code04.includes(oldCatchLF)) {
  code04 = code04.replace(oldCatchLF, newReturn);
  fs.writeFileSync('04_Reports_Misc.gs', code04, 'utf8');
  console.log('04_Reports_Misc.gs (LF) updated OK');
} else {
  console.error('04_Reports_Misc.gs target not found');
}

// 3. Update Code.gs
let codeGS = fs.readFileSync('Code.gs', 'utf8');
const targetGS = 'if (action === "cleanupOrderLog") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(cleanupOrderLog()); } // manual cleanup of SK_Order_Log: deletes yesterday and older entries';
const replaceGS = 'if (action === "cleanupOrderLog") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(cleanupOrderLog()); } // manual cleanup of SK_Order_Log: deletes yesterday and older entries\r\n    if (action === "recoverFromOrderLog") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(recoverFromOrderLog()); } // manual run of SK_Order_Log recovery sweep';

if (codeGS.includes(targetGS)) {
  codeGS = codeGS.replace(targetGS, replaceGS);
  fs.writeFileSync('Code.gs', codeGS, 'utf8');
  console.log('Code.gs updated OK');
} else {
  console.error('Code.gs target not found');
}

// 4. Update 00_Config.gs
let config = fs.readFileSync('00_Config.gs', 'utf8');
config = config.replace('const CODE_VERSION = 34.1;', 'const CODE_VERSION = 34.2; // ORDER LOG RECOVERY IN 10-MIN AUDIT: hooked recoverFromOrderLog() into 10-minute liveLostOrderAudit trigger (previously only daily 22:30 IST). Auto-recovers dropped charged orders within their 10-60 min window during the day. // 34.1:');
fs.writeFileSync('00_Config.gs', config, 'utf8');
console.log('00_Config.gs updated OK');
