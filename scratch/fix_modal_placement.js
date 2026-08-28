const fs = require('fs');

let html = fs.readFileSync('docs/Admin/vault_admin.html', 'utf8');

// 1. Extract the trailing modal code
const modalHeaderIndex = html.indexOf('// ════════════════════════════════════════════════════════════════════\r\n// ANALYTICS PENDING ORDERS');
const modalHeaderIndexLF = html.indexOf('// ════════════════════════════════════════════════════════════════════\n// ANALYTICS PENDING ORDERS');
const idx = modalHeaderIndex !== -1 ? modalHeaderIndex : modalHeaderIndexLF;

let modalCode = '';
if (idx !== -1) {
  modalCode = html.slice(idx);
  html = html.slice(0, idx).trim();
}

// 2. Insert modalCode right after renderAnalytics
const targetInsertion = `  return html;\r\n}`;
const targetInsertionLF = `  return html;\n}`;

if (html.includes(targetInsertion)) {
  html = html.replace(targetInsertion, targetInsertion + '\r\n\r\n' + modalCode);
} else if (html.includes(targetInsertionLF)) {
  html = html.replace(targetInsertionLF, targetInsertionLF + '\n\n' + modalCode);
} else {
  console.error('Target renderAnalytics end not found!');
}

// 3. Ensure the file ends with </script>\n</body>\n</html>
html = html.trim();
if (!html.endsWith('</html>')) {
  html += '\r\n</script>\r\n</body>\r\n</html>';
}

// 4. Bump version to v26.08.27.02
html = html.replace(/<meta name="app-version" content="[^"]*">/, '<meta name="app-version" content="v26.08.27.02">');
html = html.replace(/const APP_VERSION = "[^"]*";/, 'const APP_VERSION = "v26.08.27.02";');
html = html.replace(/const ADMIN_VERSION = "[^"]*";/, 'const ADMIN_VERSION = "v26.08.27.02";');

fs.writeFileSync('docs/Admin/vault_admin.html', html, 'utf8');
console.log('vault_admin.html updated successfully — modal code is now properly inside <script> tag!');
