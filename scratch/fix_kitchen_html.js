const fs = require('fs');
const filePath = 'docs/Admin/kitchen.html';
let content = fs.readFileSync(filePath, 'utf8');

const target = `        if (currentMeal === "Breakfast") {
          ["Kanda Poha", "Ghee Upma", "Thalipeeth", "Palak Paratha", "Paneer Paratha", "Methi Thepla", "Sabudana Khichdi", "Curd"].forEach(k => {
            if (items[k] > 0) parts.push(\`\${items[k]}x\${lbl[k] || k}\`);
          });
        } else {`;

const replacement = `        if (currentMeal === "Breakfast") {
          Object.keys(items).forEach(k => {
            if (items[k] > 0) {
              const name = k.replace(/\\s*\\[.*?\\]\\s*/g, "").replace(/\\s*\\(.*?\\)\\s*/g, "").trim();
              const abbr = lbl[name] || lbl[name.replace(/ /g, "_")] || name;
              parts.push(\`\${items[k]}x\${abbr}\`);
            }
          });
        } else {`;

let normContent = content.replace(/\r\n/g, '\n');
let normTarget = target.replace(/\r\n/g, '\n');

if (!normContent.includes(normTarget)) {
  console.error('Target not found in kitchen.html');
  process.exit(1);
}

normContent = normContent.replace(normTarget, replacement.replace(/\r\n/g, '\n'));

// Bump version from v26.08.26.02 to v26.08.27.01
normContent = normContent.replace(/v26\.08\.26\.02/g, 'v26.08.27.01');

fs.writeFileSync(filePath, normContent, 'utf8');
console.log('Successfully updated kitchen.html and bumped version to v26.08.27.01');
