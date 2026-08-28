const fs = require('fs');

// 1. Update docs/Admin/vault_admin.html
let vault = fs.readFileSync('docs/Admin/vault_admin.html', 'utf8');

// Update meta app-version
vault = vault.replace(/<meta name="app-version" content="[^"]*">/, '<meta name="app-version" content="v26.08.26.02">');

// Update APP_VERSION
vault = vault.replace(/const APP_VERSION = "[^"]*";/, 'const APP_VERSION = "v26.08.26.02";');

// Fix setInterval and visibilitychange in early script
const oldInterval = `setInterval(async function() {
  try {
    const data = await safeFetchJson(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
    const html = await res.text();
    const m = html.match(/const APP_VERSION = "([^"]+)"/);
    if (m && m[1] !== APP_VERSION) location.reload(true);
  } catch (e) {}
}, 15 * 60 * 1000);
document.addEventListener("visibilitychange", async function() {
  if (document.visibilityState === "visible") {
    try {
      _areasList = await safeFetchJson(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
      const html = await res.text();
      const m = html.match(/const APP_VERSION = "([^"]+)"/);
      if (m && m[1] !== APP_VERSION) location.reload(true);
    } catch (e) {}
  }
});`;

const newInterval = `setInterval(async function() {
  try {
    const res = await fetch(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
    const html = await res.text();
    const m = html.match(/const APP_VERSION = "([^"]+)"/);
    if (m && m[1] && m[1] !== APP_VERSION) {
      localStorage.setItem("sk_admin_ver", m[1]);
      location.reload(true);
    }
  } catch (e) {}
}, 15 * 60 * 1000);
document.addEventListener("visibilitychange", async function() {
  if (document.visibilityState === "visible") {
    try {
      const res = await fetch(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
      const html = await res.text();
      const m = html.match(/const APP_VERSION = "([^"]+)"/);
      if (m && m[1] && m[1] !== APP_VERSION) {
        localStorage.setItem("sk_admin_ver", m[1]);
        location.reload(true);
      }
    } catch (e) {}
  }
});`;

vault = vault.replace(oldInterval, newInterval);
// Also try with CRLF if needed
vault = vault.replace(oldInterval.replace(/\n/g, '\r\n'), newInterval.replace(/\n/g, '\r\n'));

// Update ADMIN_VERSION and replace window.confirm prompt with silent hard reload
const oldAdminVerCheck = `    const ADMIN_VERSION = "v26.08.03.5";
    (async function _versionCheck() {
      try {
        const badge = document.getElementById("appVerBadge");
        if (badge) badge.textContent = ADMIN_VERSION;
        const res = await fetch(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(/<meta\\s+name=["']app-version["']\\s+content=["']([^"']+)["']/i);
        if (m && m[1] && m[1] !== ADMIN_VERSION) {
          console.log("[Admin] Version mismatch: running=" + ADMIN_VERSION
                      + ", latest=" + m[1] + " — prompting hard refresh");
          // Marathi confirm — shown ONLY on a real version mismatch. Same dialogue
          // in Admin + Kitchen. On confirm → hard refresh to the newest build.
          if (window.confirm(_skUpdateMsgMarathi(ADMIN_VERSION, m[1]))) {
            const sep = window.location.href.indexOf("?") === -1 ? "?" : "&";
            window.location.replace(window.location.href + sep + "_v=" + Date.now());
          }
        }
      } catch (_) { /* network blip — try again next load */ }
    })();
    // Shared update prompt (identical wording in Admin + Kitchen), in Marathi.
    function _skUpdateMsgMarathi(cur, latest) {
      return "🔄 नवीन व्हर्जन उपलब्ध आहे!\\n\\n"
           + "सध्याची आवृत्ती: " + cur + "\\n"
           + "नवीन आवृत्ती: " + latest + "\\n\\n"
           + "लेटेस्ट व्हर्जनवर जाण्यासाठी पेज रिफ्रेश करणे आवश्यक आहे.\\n"
           + "आता रिफ्रेश करायचे?";
    }`;

const newAdminVerCheck = `    const ADMIN_VERSION = "v26.08.26.02";
    (async function _versionCheck() {
      try {
        const badge = document.getElementById("appVerBadge");
        if (badge) badge.textContent = ADMIN_VERSION;
        const res = await fetch(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(/<meta\\s+name=["']app-version["']\\s+content=["']([^"']+)["']/i);
        if (m && m[1] && m[1] !== ADMIN_VERSION) {
          console.log("[Admin] Version mismatch: running=" + ADMIN_VERSION
                      + ", latest=" + m[1] + " — auto hard reloading");
          localStorage.setItem("sk_admin_ver", m[1]);
          const sep = window.location.href.indexOf("?") === -1 ? "?" : "&";
          window.location.replace(window.location.href.split("?")[0] + sep + "_v=" + Date.now());
        }
      } catch (_) { /* network blip — try again next load */ }
    })();`;

vault = vault.replace(oldAdminVerCheck, newAdminVerCheck);
vault = vault.replace(oldAdminVerCheck.replace(/\n/g, '\r\n'), newAdminVerCheck.replace(/\n/g, '\r\n'));

fs.writeFileSync('docs/Admin/vault_admin.html', vault, 'utf8');
console.log('vault_admin.html updated successfully');


// 2. Update docs/Admin/kitchen.html to remove window.confirm prompt too
let kitchen = fs.readFileSync('docs/Admin/kitchen.html', 'utf8');

const oldKitchenVerCheck = `    const KITCHEN_VERSION = "v26.08.26.02";
    (async function _kitchenVersionCheck() {
      try {
        const badge = document.getElementById("kitchenVerBadge");
        if (badge) badge.textContent = KITCHEN_VERSION;
        const res = await fetch(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(/<meta\\s+name=["']app-version["']\\s+content=["']([^"']+)["']/i);
        if (m && m[1] && m[1] !== KITCHEN_VERSION) {
          console.log("[Kitchen] Version mismatch: running=" + KITCHEN_VERSION
                      + ", latest=" + m[1] + " — prompting hard refresh");
          // Marathi confirm — shown ONLY on a real version mismatch. Same dialogue
          // in Admin + Kitchen. On confirm → hard refresh to the newest build.
          if (window.confirm(_skUpdateMsgMarathi(KITCHEN_VERSION, m[1]))) {
            const sep = window.location.href.indexOf("?") === -1 ? "?" : "&";
            window.location.replace(window.location.href + sep + "_v=" + Date.now());
          }
        }
      } catch (_) { /* network blip — try again next load */ }
    })();
    // Shared update prompt (identical wording in Admin + Kitchen), in Marathi.
    function _skUpdateMsgMarathi(cur, latest) {
      return "🔄 नवीन व्हर्जन उपलब्ध आहे!\\n\\n"
           + "सध्याची आवृत्ती: " + cur + "\\n"
           + "नवीन आवृत्ती: " + latest + "\\n\\n"
           + "लेटेस्ट व्हर्जनवर जाण्यासाठी पेज रिफ्रेश करणे आवश्यक आहे.\\n"
           + "आता रिफ्रेश करायचे?";
    }`;

const newKitchenVerCheck = `    const KITCHEN_VERSION = "v26.08.26.02";
    (async function _kitchenVersionCheck() {
      try {
        const badge = document.getElementById("kitchenVerBadge");
        if (badge) badge.textContent = KITCHEN_VERSION;
        const res = await fetch(window.location.pathname + "?_v=" + Date.now(), { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(/<meta\\s+name=["']app-version["']\\s+content=["']([^"']+)["']/i);
        if (m && m[1] && m[1] !== KITCHEN_VERSION) {
          console.log("[Kitchen] Version mismatch: running=" + KITCHEN_VERSION
                      + ", latest=" + m[1] + " — auto hard reloading");
          localStorage.setItem("sk_admin_ver", m[1]);
          const sep = window.location.href.indexOf("?") === -1 ? "?" : "&";
          window.location.replace(window.location.href.split("?")[0] + sep + "_v=" + Date.now());
        }
      } catch (_) { /* network blip — try again next load */ }
    })();`;

kitchen = kitchen.replace(oldKitchenVerCheck, newKitchenVerCheck);
kitchen = kitchen.replace(oldKitchenVerCheck.replace(/\n/g, '\r\n'), newKitchenVerCheck.replace(/\n/g, '\r\n'));

fs.writeFileSync('docs/Admin/kitchen.html', kitchen, 'utf8');
console.log('kitchen.html updated successfully');
