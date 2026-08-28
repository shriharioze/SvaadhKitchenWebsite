const fs = require('fs');

let html = fs.readFileSync('docs/Admin/kitchen.html', 'utf8');

const targetOld = `      // Pause when tab hidden, resume when visible
      document.removeEventListener("visibilitychange", window._visHandler);
      window._visHandler = () => {
        if (document.hidden) {
          if (window._rt) { clearInterval(window._rt); window._rt = null; }
        } else {
          doRefresh();
          window._rt = setInterval(doRefresh, REFRESH_SECS * 1000);
          requestWakeLock(); // Re-acquire wake lock
        }
      };
      document.addEventListener("visibilitychange", window._visHandler);`;

const targetNew = `      // Tab visibility: re-acquire wake lock when visible, DO NOT trigger data fetch
      document.removeEventListener("visibilitychange", window._visHandler);
      window._visHandler = () => {
        if (!document.hidden) {
          requestWakeLock(); // Re-acquire wake lock on return
        }
      };
      document.addEventListener("visibilitychange", window._visHandler);`;

// Also ensure doRefresh updates scheduleNext
const oldDoRefresh = `      function doRefresh() {
        loadKitchen();
      }`;
const newDoRefresh = `      function doRefresh() {
        scheduleNext();
        loadKitchen();
      }`;

// Handle CRLF / LF
html = html.replace(/\r?\n\s*\/\/ Pause when tab hidden, resume when visible[\s\S]*?document\.addEventListener\("visibilitychange", window\._visHandler\);/, '\r\n' + targetNew);
html = html.replace(/\r?\n\s*function doRefresh\(\) \{\r?\n\s*loadKitchen\(\);\r?\n\s*\}/, '\r\n' + newDoRefresh);

fs.writeFileSync('docs/Admin/kitchen.html', html, 'utf8');
console.log('docs/Admin/kitchen.html updated successfully');
