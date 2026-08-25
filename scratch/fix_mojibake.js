// Reverses the UTF-8→cp1252→UTF-8 double-encode damage in Liviano-Serio.html.
// Chars map back to their original bytes; maximal byte-runs are re-decoded as UTF-8.
// Runs that don't decode cleanly are left untouched (safe fallback).
const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let s = fs.readFileSync(p, "utf8");

// cp1252 high-char → original byte (0x80–0x9F); 0xA0–0xFF are identity
const HIGH = {
  "\u20AC": 0x80, "\u201A": 0x82, "\u0192": 0x83, "\u201E": 0x84, "\u2026": 0x85,
  "\u2020": 0x86, "\u2021": 0x87, "\u02C6": 0x88, "\u2030": 0x89, "\u0160": 0x8A,
  "\u2039": 0x8B, "\u0152": 0x8C, "\u017D": 0x8E, "\u2018": 0x91, "\u2019": 0x92,
  "\u201C": 0x93, "\u201D": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97,
  "\u02DC": 0x98, "\u2122": 0x99, "\u0161": 0x9A, "\u203A": 0x9B, "\u0153": 0x9C,
  "\u017E": 0x9E, "\u0178": 0x9F
};
function charToByte(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) return cp;
  if (cp >= 0xA0 && cp <= 0xFF) return cp;
  const h = HIGH[ch];
  return h === undefined ? null : h;
}

let out = "";
let buf = [];
let runs = 0, decodedRuns = 0;
function flush() {
  if (!buf.length) return;
  const bytes = Buffer.from(buf);
  let replaced = null;
  const dec = bytes.toString("utf8");
  if (!dec.includes("\uFFFD")) {
    // only accept if the decode actually produced non-ASCII (real mojibake reversal),
    // or is identical ASCII (harmless identity)
    replaced = dec;
    decodedRuns++;
  }
  out += replaced !== null ? replaced : buf.map(b => {
    // restore original chars from bytes (inverse of charToByte for this run)
    return Buffer.from([b]).toString("latin1");
  });
  buf = [];
}
for (const ch of s) {
  const b = charToByte(ch);
  if (b === null) { flush(); out += ch; }
  else buf.push(b);
}
flush();

fs.writeFileSync(p, out, "utf8");
console.log("runs processed:", ++runs, "| decoded OK:", decodedRuns);
const count = (re) => (out.match(re) || []).length;
console.log("── AFTER ──");
console.log("mojibake â€:", count(/â€/g), "| ð:", count(/ð/g), "| à¤:", count(/à¤/g), "| Ã:", count(/Ã/g));
console.log("clean ₹:", count(/₹/g), "| emoji:", count(/[\u{1F300}-\u{1FAFF}]/gu), "| devanagari:", count(/[\u0900-\u097F]/gu), "| em-dash:", count(/—/g));
