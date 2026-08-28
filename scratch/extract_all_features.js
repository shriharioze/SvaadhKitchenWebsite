const fs = require('fs');

const raw = fs.readFileSync('project-overview-summary-request.json', 'utf8');
const data = JSON.parse(raw);

const featureList = [];
const assistantResponses = [];

data.messages.forEach((m, idx) => {
  const role = m.info && m.info.role;
  const parts = m.parts || [];
  
  parts.forEach(p => {
    if (p.text && role === 'assistant') {
      // Look for summary headings, checklists, completion reports
      if (p.text.includes('✅') || p.text.includes('## Summary') || p.text.includes('## What was done') || p.text.includes('CODE_VERSION') || p.text.includes('deploy')) {
        assistantResponses.push({ idx, text: p.text });
      }
    }
  });
});

console.log(`Found ${assistantResponses.length} key assistant summaries.`);
assistantResponses.forEach((r, i) => {
  console.log(`\n================== SUMMARY ${i+1} (msg #${r.idx}) ==================`);
  console.log(r.text.slice(0, 1000));
});
