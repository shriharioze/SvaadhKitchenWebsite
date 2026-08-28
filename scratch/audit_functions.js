const fs = require('fs');

const files = [
  '00_Config.gs',
  '02_Orders_Menu.gs',
  '03_Admin_Kitchen.gs',
  '04_Reports_Misc.gs',
  '05_Customer_Archive.gs',
  '06_Bulk_Orders.gs',
  '07_Labels_Auto.gs',
  '10_Hdfc_Gateway.gs',
  '11_Hdfc_Reconciler.gs',
  '12_Payout_Reconciler.gs',
  '13_LivianoSerio.gs',
  'Analyze_AOV.gs',
  'Code.gs',
  'IntentAmplify.gs'
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    const code = fs.readFileSync(f, 'utf8');
    const lines = code.split('\n');
    const fnMatches = [];
    lines.forEach((l, idx) => {
      const m = l.match(/function\s+([a-zA-Z0-9_$]+)\s*\(/);
      if (m) {
        fnMatches.push({ line: idx + 1, name: m[1] });
      }
    });
    console.log(`\n=== ${f} (${lines.length} lines, ${fnMatches.length} functions) ===`);
    fnMatches.forEach(fn => console.log(`  L${fn.line}: ${fn.name}`));
  }
});
