// PASS 2: per-sequence UTF-8 walker over remaining mojibake.
// For each char: map to original byte (cp1252 reverse). Walk bytes; emit valid
// UTF-8 sequences decoded; emit invalid bytes as their ORIGINAL cp1252 chars
// (no latin1 truncation this time). Clean chars (₹, Devanagari, — etc.) that
// have no cp1252 byte act as boundaries and pass through untouched.
const fs = require("fs");
const p = "docs/Liviano-Serio.html";
const s = fs.readFileSync(p, "utf8");

const HIGH = {
  "\u20AC":0x80,"\u201A":0x82,"\u0192":0x83,"\u201E":0x84,"\u2026":0x85,
  "\u2020":0x86,"\u2021":0x87,"\u02C6":0x88,"\u2030":0x89,"\u0160":0x8A,
  "\u2039":0x8B,"\u0152":0x8C,"\u017D":0x8E,"\u2018":0x91,"\u2019":0x92,
  "\u201C":0x93,"\u201D":0x94,"\u2022":0x95,"\u2013":0x96,"\u2014":0x97,
  "\u02DC":0x98,"\u2122":0x99,"\u0161":0x9A,"\u203A":0x9B,"\u0153":0x9C,
  "\u017E":0x9E,"\u0178":0x9F
};
function charToByte(ch){
  const cp = ch.codePointAt(0);
  if (cp < 0x80) return cp;
  if (cp >= 0xA0 && cp <= 0xFF) return cp;
  const h = HIGH[ch];
  return h === undefined ? null : h;
}

let out = "";
let buf = [];           // bytes
let orig = [];          // original chars for this run
function seqLen(b){
  if (b < 0x80) return 1;
  if (b >= 0xC2 && b <= 0xDF) return 2;
  if (b >= 0xE0 && b <= 0xEF) return 3;
  if (b >= 0xF0 && b <= 0xF4) return 4;
  return 0; // invalid start (continuation byte or 0x80/C0/C1/F5+)
}
function flushRun(){
  if (!buf.length) return;
  let i = 0;
  while (i < buf.length){
    const len = seqLen(buf[i]);
    if (len === 0 || i + len > buf.length){ out += orig[i]; i++; continue; }
    const dec = Buffer.from(buf.slice(i, i + len)).toString("utf8");
    if (dec.includes("\uFFFD")){ out += orig[i]; i++; continue; }
    out += dec; i += len;
  }
  buf = []; orig = [];
}
for (const ch of s){
  const b = charToByte(ch);
  if (b === null){ flushRun(); out += ch; }
  else { buf.push(b); orig.push(ch); }
}
flushRun();

fs.writeFileSync(p, out, "utf8");
const count = (re) => (out.match(re) || []).length;
console.log("── AFTER PASS 2 ──");
console.log("mojibake â€:", count(/â€/g), "| ð:", count(/ð/g), "| à¤:", count(/à¤/g), "| Ã:", count(/Ã/g));
console.log("clean ₹:", count(/₹/g), "| emoji:", count(/[\u{1F300}-\u{1FAFF}]/gu), "| devanagari:", count(/[\u0900-\u097F]/gu), "| em-dash:", count(/—/g));
console.log("length:", out.length);
