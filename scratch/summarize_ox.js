const fs = require('fs');

const raw = fs.readFileSync('project-overview-summary-request.json', 'utf8');
const data = JSON.parse(raw);

const userPrompts = [];
const patches = [];
const toolCalls = [];
const assistantResponses = [];

data.messages.forEach((m, idx) => {
  const role = m.info && m.info.role;
  const parts = m.parts || [];
  
  let allText = '';
  parts.forEach(p => {
    if (p.text) allText += p.text + '\n';
    if (p.type === 'tool' || p.tool) {
      toolCalls.push({ idx, tool: p.tool || p.name, input: p.input || p.args });
    }
    if (p.patch || (p.data && p.data.patch)) {
      patches.push({ idx, patch: p.patch || p.data.patch });
    }
  });

  if (role === 'user' && allText.trim()) {
    userPrompts.push({ idx, text: allText.trim() });
  } else if (role === 'assistant' && allText.trim()) {
    assistantResponses.push({ idx, text: allText.trim() });
  }
});

console.log(`Total Messages: ${data.messages.length}`);
console.log(`User Prompts Count: ${userPrompts.length}`);
console.log(`Assistant Responses Count: ${assistantResponses.length}`);

console.log('\n=== ALL USER PROMPTS ===');
userPrompts.forEach((p, i) => {
  console.log(`\n--- PROMPT ${i+1} (msg #${p.idx}) ---`);
  console.log(p.text);
});
