const fs = require('fs');
let html = fs.readFileSync('docs/Admin/driver.html', 'utf8');
const fetchWithTimeoutRegex = /async function fetchWithTimeout\([\s\S]*?\n\}/;

const safeFetchJsonDefinition = `async function safeFetchJson(url, options = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 1200)); continue; }
        throw new Error('Server temporarily busy. Please try again.');
      }
      return JSON.parse(text);
    } catch(err) {
      if (attempt === 0 && !err.message.includes('STRICT') && !err.message.includes('REQUIRED')) {
        await new Promise(r => setTimeout(r, 1200));
        continue;
      }
      if (err.name === 'SyntaxError' || err.message.includes('Unexpected token')) {
        throw new Error('Server temporarily busy. Please try again.');
      }
      throw err;
    }
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const fetchOpts = typeof options === 'number' ? {} : options;
  return fetch(url, fetchOpts);
}`;

if (fetchWithTimeoutRegex.test(html)) {
  html = html.replace(fetchWithTimeoutRegex, safeFetchJsonDefinition);
  
  // Replace verifyPin logic
  html = html.replace(
    /const res\s*=\s*await fetchWithTimeout\((.*?)\);\s*const data\s*=\s*await res\.json\(\);/,
    'const data = await safeFetchJson($1);'
  );

  fs.writeFileSync('docs/Admin/driver.html', html);
  console.log('Driver.html patched with safeFetchJson!');
} else {
  console.log('Could not find fetchWithTimeout definition');
}
