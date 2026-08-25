const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_e2e.js", "utf8");
const start = c.indexOf('console.log("\\n[10] RISK 6.1');
const end = c.indexOf('console.log("\\n════════════════════════════════", )') === -1
  ? c.indexOf('console.log("\\n════════════════════════════════");')
  : c.indexOf('console.log("\\n════════════════════════════════", )');
if (start === -1 || end === -1) { console.log("anchors not found"); process.exit(1); }
const newTest = `console.log("\\n[10] SEPARATE BASES — same-day cancel: SK sibling clawed back, LS customer untouched");
resetWorld();
{
  const d = nextNonSunday(1);
  // Same customer, same day, TWO SK rows (day total 360 ≥ 325 → 5% tier on both).
  addRawRow(skWs, { Submission_ID: "SK-DAY-A", Order_Date: d, Meal_Type: "Lunch",
    Customer_Name: "Test Customer", Phone: "9999999999", Area: "Normal Area", Society: "Soc",
    Payment_Status: "Paid", Payment_Method: "UPI", Food_Subtotal: 300, Discount_Amount: 15, Net_Total: 285 });
  addRawRow(skWs, { Submission_ID: "SK-DAY-B", Order_Date: d, Meal_Type: "Dinner",
    Customer_Name: "Test Customer", Phone: "9999999999", Area: "Normal Area", Society: "Soc",
    Payment_Status: "Paid", Payment_Method: "UPI", Food_Subtotal: 60, Discount_Amount: 3, Net_Total: 57 });
  // A DIFFERENT customer's LS order on the same day — must NEVER be touched.
  const lsW = ss.getSheetByName("LS_Orders") || mkTab("LS_Orders", ORDERS_HEADERS_ARR);
  addRawRow(lsW, { Submission_ID: "LS-DAY-C", Order_Date: d, Meal_Type: "Dinner",
    Customer_Name: "LS Person", Phone: "8888888888", Area: "Kharadi", Society: "Serio",
    Payment_Status: "Paid", Payment_Method: "UPI", Food_Subtotal: 60, Discount_Amount: 3, Net_Total: 57 });

  const res = API.deleteOrder("9999999999", "SK-DAY-A", "wallet");
  T("cancel succeeded", res && res.success === true, JSON.stringify(res).slice(0, 200));
  const skA = getRows(skWs).find(r => r.Submission_ID === "SK-DAY-A");
  const skB = getRows(skWs).find(r => r.Submission_ID === "SK-DAY-B");
  const lsC = getRows(ss.getSheetByName("LS_Orders")).find(r => r.Submission_ID === "LS-DAY-C");
  T("cancelled row marked Cancelled – Refunded to Wallet", /cancelled/i.test(String(skA.Payment_Status)) && /wallet/i.test(String(skA.Payment_Status)), String(skA.Payment_Status));
  // Clawback applies to the SAME customer's SK sibling only:
  // day drops below threshold → sibling owes ₹11 delivery; discount zeroed.
  T("SK sibling discount clawed back to 0", Number(skB.Discount_Amount) === 0, String(skB.Discount_Amount));
  T("SK sibling Net = 57 + 3 + 11 = 71", Number(skB.Net_Total) === 71, String(skB.Net_Total));
  // The LS customer's row is a DIFFERENT account — completely untouched.
  T("LS row (different customer) untouched", Number(lsC.Discount_Amount) === 3 && Number(lsC.Net_Total) === 57,
    JSON.stringify({ disc: String(lsC.Discount_Amount), net: String(lsC.Net_Total) }));
  // Refund = 285 − overDiscount 3 − deliveryOwed 11 = 271 → SK wallet (main site)
  const refundTxn = getRows(walWs).find(x => /cancellation refund/i.test(String(x.Txn_Type)));
  T("wallet refund txn ₹271 into SK_Wallet", refundTxn && Number(refundTxn.Amount) === 271, refundTxn && JSON.stringify(refundTxn));
}

`;
c = c.slice(0, start) + newTest + c.slice(end);
fs.writeFileSync("scratch/test_ls_e2e.js", c);
console.log("test [10] rewritten for separate bases");
