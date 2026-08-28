const fs = require('fs');

let codeGS = fs.readFileSync('Code.gs', 'utf8');
const target = 'if (action === "setupMonthlyArchiveTrigger" || action === "setupArchiveTrigger") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes({ success: true, message: setupMonthlyArchiveTrigger() }); }';
const replace = 'if (action === "setupMonthlyArchiveTrigger" || action === "setupArchiveTrigger") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes({ success: true, message: setupMonthlyArchiveTrigger() }); }\r\n    if (action === "setupLostOrderAuditTrigger") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes({ success: true, message: setupLostOrderAuditTrigger() }); }';

if (codeGS.includes(target)) {
  codeGS = codeGS.replace(target, replace);
  fs.writeFileSync('Code.gs', codeGS, 'utf8');
  console.log('Code.gs updated OK');
} else {
  console.error('Target not found in Code.gs');
}
