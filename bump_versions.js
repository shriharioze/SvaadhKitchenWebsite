const fs = require('fs');

function bumpFile(path) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/content="v\d\d\.\d\d\.\d\d\.\d\d"/g, 'content="v26.09.01.01"');
  content = content.replace(/APP_VERSION = "v\d\d\.\d\d\.\d\d\.\d\d"/g, 'APP_VERSION = "v26.09.01.01"');
  content = content.replace(/KITCHEN_VERSION = "v\d\d\.\d\d\.\d\d\.\d\d"/g, 'KITCHEN_VERSION = "v26.09.01.01"');
  content = content.replace(/ADMIN_VERSION = "v\d\d\.\d\d\.\d\d\.\d\d"/g, 'ADMIN_VERSION = "v26.09.01.01"');
  fs.writeFileSync(path, content, 'utf8');
  console.log(`Bumped ${path}`);
}

bumpFile('docs/Admin/kitchen.html');
bumpFile('docs/Admin/vault_admin.html');
