const fs = require('fs');
let code = fs.readFileSync('02_Orders_Menu.gs', 'utf8');
const injection = `
  // ── OVERDUE ACCOUNT CHECK ─────────────────────────────────────
  // If customer is On Account (Monthly) and it is >= 10th of the month
  // with an unpaid bill from the previous month(s), completely block
  // them from placing new orders until the bill is paid.
  if (String(profile.onAccount || "").toLowerCase() === "yes" &&
      String(profile.billingCycle || "").toLowerCase() === "monthly") {
    if (typeof getOnAccountBill === "function") {
      const billInfo = getOnAccountBill(profile.phone);
      if (billInfo && billInfo.due && billInfo.isOverdue) {
        return {
          error: "Your previous month's bill is overdue. Please settle your outstanding balance of ₹" + billInfo.total + " to continue placing orders.",
          isOverdue: true
        };
      }
    }
  }
`;
code = code.replace('const payFreq      = profile.payment_preference || "Daily Payment";', 'const payFreq      = profile.payment_preference || "Daily Payment";\n' + injection);
fs.writeFileSync('02_Orders_Menu.gs', code, 'utf8');
console.log('Injected');
