const fs = require('fs');

let html = fs.readFileSync('docs/Admin/vault_admin.html', 'utf8');

// 1. Add version badge on login card
const oldLoginCardEnd = `    <div class="login-err" id="loginErr"></div>\r\n  </div>`;
const oldLoginCardEndLF = `    <div class="login-err" id="loginErr"></div>\n  </div>`;

const newLoginCardEnd = `    <div class="login-err" id="loginErr"></div>
    <div style="margin-top:16px;text-align:center;">
      <span id="loginVerBadge" style="font-size:0.75rem; color:#64748b; font-weight:700; background:#f1f5f9; padding:3px 10px; border-radius:12px; border:1px solid #cbd5e1; display:inline-block; letter-spacing:0.5px;">v26.08.27.02</span>
    </div>
  </div>`;

if (html.includes(oldLoginCardEnd)) {
  html = html.replace(oldLoginCardEnd, newLoginCardEnd);
} else if (html.includes(oldLoginCardEndLF)) {
  html = html.replace(oldLoginCardEndLF, newLoginCardEnd);
}

// 2. Add prominent gold version badge in topbar brand
const oldTopbarBrand = `<div class="topbar-brand">Svaadh Kitchen <span>ADMIN</span></div>`;
const newTopbarBrand = `<div class="topbar-brand">
      Svaadh Kitchen <span>ADMIN</span>
      <span class="app-ver-badge" id="topbarVerBadge" style="font-size:0.68rem; color:#fbbf24; font-weight:700; background:rgba(0,0,0,0.35); padding:2px 8px; border-radius:8px; border:1px solid rgba(251,191,36,0.4); margin-left:8px; letter-spacing:0.3px; display:inline-block; vertical-align:middle;">v26.08.27.02</span>
    </div>`;

html = html.replace(oldTopbarBrand, newTopbarBrand);

// 3. Update _versionCheck and bootApp
const oldVersionCheck = `        const badge = document.getElementById("appVerBadge");
        if (badge) badge.textContent = ADMIN_VERSION;`;

const newVersionCheck = `        const loginBadge = document.getElementById("loginVerBadge");
        if (loginBadge) loginBadge.textContent = ADMIN_VERSION;
        const badges = document.querySelectorAll(".app-ver-badge, #topbarVerBadge, #appVerBadge");
        badges.forEach(b => { if (b) b.textContent = ADMIN_VERSION; });`;

html = html.replace(oldVersionCheck, newVersionCheck);
html = html.replace(oldVersionCheck.replace(/\n/g, '\r\n'), newVersionCheck);

const oldBootAppTpl = `  if (tpl) {
    document.getElementById("shell").appendChild(tpl.content.cloneNode(true));
    tpl.remove();
  }`;

const newBootAppTpl = `  if (tpl) {
    document.getElementById("shell").appendChild(tpl.content.cloneNode(true));
    tpl.remove();
    const badges = document.querySelectorAll(".app-ver-badge, #topbarVerBadge, #appVerBadge");
    badges.forEach(b => { if (b) b.textContent = ADMIN_VERSION; });
  }`;

html = html.replace(oldBootAppTpl, newBootAppTpl);
html = html.replace(oldBootAppTpl.replace(/\n/g, '\r\n'), newBootAppTpl);

fs.writeFileSync('docs/Admin/vault_admin.html', html, 'utf8');
console.log('vault_admin.html updated successfully with visible version display in login card and topbar!');
