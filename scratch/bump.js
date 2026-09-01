const fs = require('fs');
let content = fs.readFileSync('docs/order.html', 'utf8');
content = content.replace(/v26\.09\.01\.01/g, 'v26.09.01.02');
fs.writeFileSync('docs/order.html', content, 'utf8');
