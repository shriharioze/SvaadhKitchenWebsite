/**
 * ═════════════════════════════════════════════════════════════════════════
 * 14_SimilReconciliation.gs
 * Automated Generation of Simil Aggarwal Bulk Reconciliation Google Sheet
 * ═════════════════════════════════════════════════════════════════════════
 */

function createSimilReconciliationSheet() {
  const title = 'Svaadh Kitchen — Simil Aggarwal Bulk Reconciliation';
  const newSs = SpreadsheetApp.create(title);
  const fileId = newSs.getId();

  try {
    DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    console.warn('Drive sharing warning:', e.message);
  }

  // ══════════════════════════════════════════════════════════
  // TAB 1: EXECUTIVE SUMMARY
  // ══════════════════════════════════════════════════════════
  const s1 = newSs.getActiveSheet();
  s1.setName('Executive Summary');
  s1.setHiddenGridlines(false);

  // Column widths
  s1.setColumnWidth(1, 30);
  s1.setColumnWidth(2, 360);
  s1.setColumnWidth(3, 160);
  s1.setColumnWidth(4, 160);
  s1.setColumnWidth(5, 340);

  // Title & Subtitle
  s1.getRange('B2').setValue('SVAADH KITCHEN — BULK ORDER RECONCILIATION STATEMENT')
    .setFontSize(14).setFontWeight('bold').setFontColor('#1A365D');
  s1.getRange('B3').setValue('Customer: Simil Aggarwal (Phone: 8850485319) | Batch ID: SK260916G7W4FVKTXH | Date: 01-Oct-2026')
    .setFontSize(10).setFontStyle('italic').setFontColor('#5F6368');

  // Section 1: Plan Details
  s1.getRange('B5').setValue('1. ORIGINAL BULK PLAN BOOKING DETAILS')
    .setFontSize(11).setFontWeight('bold').setFontColor('#1A365D');

  const sec1 = [
    ['Bulk Plan Type', 'Month Plan (26 Working Days, Lunch + Dinner)'],
    ['Total Meals Booked', '52 Meals (25 Lunch + 27 Dinner)'],
    ['Standard Subtotal per Meal', '₹140.00'],
    ['Month Bulk Commitment Discount (10%)', '- ₹14.00 per meal'],
    ['Effective Price Paid per Meal', '₹126.00'],
    ['Total Order Value Paid by Customer', '₹6,552.00 (52 meals × ₹126.00)']
  ];

  for (let i = 0; i < sec1.length; i++) {
    const r = 6 + i;
    s1.getRange(r, 2).setValue(sec1[i][0]).setFontSize(10)
      .setBorder(true, true, true, true, false, false, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
    s1.getRange(r, 3).setValue(sec1[i][1]).setFontSize(10).setFontWeight('bold')
      .setBorder(true, true, true, true, false, false, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
    s1.getRange(r, 3, 1, 3).merge();
  }

  // Section 2: Meal Breakdown
  s1.getRange('B13').setValue('2. MEAL STATUS BREAKDOWN (CUTOFF: 02-OCT-2026 DINNER)')
    .setFontSize(11).setFontWeight('bold').setFontColor('#1A365D');

  const h2 = ['Category', 'Meals Count', 'Effective Rate', 'Total Amount'];
  s1.getRange(14, 2, 1, 4).setValues([h2])
    .setBackground('#1A365D').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');

  s1.getRange(15, 2, 1, 4).setValues([['Consumed Meals (17-Sep to 02-Oct Lunch + prior cancels)', '22 Meals', '₹126.00 / meal', 2772]]);
  s1.getRange(16, 2, 1, 4).setValues([['Unused Meals (From 02-Oct Dinner till 21-Oct Dinner)', '30 Meals', '₹126.00 / meal', 3780]]);
  s1.getRange(17, 2, 1, 4).setValues([['Total Plan Value', '52 Meals', '—', '=SUM(E15:E16)']]);

  s1.getRange('C15:D17').setHorizontalAlignment('center');
  s1.getRange('E15:E17').setNumberFormat('₹#,##0.00').setHorizontalAlignment('right').setFontWeight('bold');
  s1.getRange(15, 2, 3, 4).setBorder(true, true, true, true, true, true, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
  s1.getRange('B17:E17').setFontWeight('bold').setBorder(true, true, true, true, false, false, '#1A365D', SpreadsheetApp.BorderStyle.DOUBLE);

  // Section 3: Final Refund & Settlement
  s1.getRange('B19').setValue('3. REFUND & NEW BOOKING ADJUSTMENT (30 UNUSED MEALS)')
    .setFontSize(11).setFontWeight('bold').setFontColor('#1A365D');

  const sec3 = [
    ['Gross Refund Due for 30 Unused Meals (30 × ₹126.00)', 3780.0, 'Full refund of what customer paid for unused meals'],
    ['Less: Refund Already Processed for these 30 Meals via Gateway', -3010.0, 'Credited directly to customer bank account'],
    ['BALANCE TO BE ADJUSTED AGAINST NEXT BULK BOOKING', 770.0, 'Credit to be deducted from new bulk plan invoice']
  ];

  for (let i = 0; i < sec3.length; i++) {
    const r = 20 + i;
    const isTot = (i === 2);
    s1.getRange(r, 2).setValue(sec3[i][0]).setFontSize(10).setFontWeight(isTot ? 'bold' : 'normal')
      .setBorder(true, true, true, true, false, false, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
    const cellVal = s1.getRange(r, 3).setValue(sec3[i][1]).setNumberFormat('₹#,##0.00').setHorizontalAlignment('right')
      .setFontWeight('bold').setFontSize(isTot ? 12 : 10)
      .setBorder(true, true, true, true, false, false, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
    if (isTot) {
      s1.getRange(r, 2).setBackground('#E6F4EA').setFontColor('#137333');
      cellVal.setBackground('#E6F4EA').setFontColor('#137333');
    }
    s1.getRange(r, 4).setValue(sec3[i][2]).setFontSize(10)
      .setBorder(true, true, true, true, false, false, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
    s1.getRange(r, 4, 1, 2).merge();
  }

  // Section 4: Notes
  s1.getRange('B24').setValue('4. NOTE ON EARLIER CANCELLATIONS (BEFORE 02-OCT DINNER)')
    .setFontSize(11).setFontWeight('bold').setFontColor('#1A365D');

  const sec4 = [
    ['Policy for Earlier Cancellations (25-Sep, 29-Sep, 30-Sep, 01-Oct)', 'Retained', 'Treated as consumed/non-refundable per owner instruction'],
    ['Gateway Refund Already Received for 30-Sep and 01-Oct Dinners', '₹182.00', 'Customer received ₹42 (30-Sep) + ₹140 (01-Oct) on gateway'],
    ['Option 1: Customer keeps ₹182.00; Balance on 30 unused meals is adjusted', '₹770.00', 'Fair & simple: 30 meals paid (₹3,780) - 30 meals gateway (₹3,010) = ₹770.00'],
    ['Option 2: If netting ₹182.00 across whole batch (22 meals @ ₹126)', '₹588.00', 'Total paid (₹6,552) - 22 consumed (₹2,772) - total gateway (₹3,192) = ₹588.00']
  ];

  for (let i = 0; i < sec4.length; i++) {
    const r = 25 + i;
    const isHL = (i === 2);
    s1.getRange(r, 2).setValue(sec4[i][0]).setFontSize(10).setFontWeight(isHL ? 'bold' : 'normal')
      .setBorder(true, true, true, true, false, false, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
    s1.getRange(r, 3).setValue(sec4[i][1]).setFontSize(10).setFontWeight('bold').setHorizontalAlignment('right')
      .setBorder(true, true, true, true, false, false, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
    s1.getRange(r, 4).setValue(sec4[i][2]).setFontSize(10)
      .setBorder(true, true, true, true, false, false, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
    s1.getRange(r, 4, 1, 2).merge();
    if (isHL) {
      s1.getRange(r, 2, 1, 4).setBackground('#EBF8FF');
    }
  }

  // ══════════════════════════════════════════════════════════
  // TAB 2: ALL 52 MEALS SCHEDULE
  // ══════════════════════════════════════════════════════════
  const s2 = newSs.insertSheet('All 52 Meals Schedule');
  s2.setHiddenGridlines(false);

  // Column widths
  const widths = [45, 105, 85, 165, 300, 95, 105, 95, 180, 170, 160, 170, 350];
  for (let c = 0; c < widths.length; c++) {
    s2.setColumnWidth(c + 1, widths[c]);
  }

  // Header Title
  s2.getRange('B2').setValue('SIMIL AGGARWAL — 52 MEALS COMPREHENSIVE RECONCILIATION SCHEDULE')
    .setFontSize(14).setFontWeight('bold').setFontColor('#1A365D');
  s2.getRange('B3').setValue('Batch ID: SK260916G7W4FVKTXH | Rate: ₹126.00/meal | 22 Consumed | 30 Unused (02-Oct Dinner onwards) | Balance: ₹770.00')
    .setFontSize(10).setFontStyle('italic').setFontColor('#5F6368');

  const tableHeaders = [
    'Sr', 'Order Date', 'Meal', 'Order ID', 'Items Ordered',
    'Full Price', 'Discount (10%)', 'Net Paid', 'Classification',
    'Refund Settled (Gateway)', 'Refund Pending (UPI)', 'Balance to Adjust (₹)', 'Audit Remarks'
  ];

  s2.getRange(5, 1, 1, tableHeaders.length).setValues([tableHeaders])
    .setBackground('#1A365D').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  s2.setFrozenRows(5);

  // Insert all 52 rows
  const rowData = [[1, "2026-09-17", "Lunch", "SK-20260916-2391", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [2, "2026-09-17", "Dinner", "SK-20260916-2788", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [3, "2026-09-18", "Lunch", "SK-20260916-6094", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [4, "2026-09-18", "Dinner", "SK-20260916-2513", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [5, "2026-09-19", "Lunch", "SK-20260916-4905", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [6, "2026-09-19", "Dinner", "SK-20260916-7161", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [7, "2026-09-21", "Lunch", "SK-20260916-2310", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [8, "2026-09-21", "Dinner", "SK-20260916-6870", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [9, "2026-09-22", "Lunch", "SK-20260916-4205", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [10, "2026-09-22", "Dinner", "SK-20260916-1433", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [11, "2026-09-23", "Dinner", "SK-20260916-9275", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [12, "2026-09-24", "Lunch", "SK-20260916-4570", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [13, "2026-09-25", "Lunch", "SK-20260916-7033", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [14, "2026-09-25", "Dinner", "SK-20260916-9197", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Prior Cancel)", 0, 0, 0, "Cancelled before 02-Oct Dinner; treated as consumed per policy"], [15, "2026-09-28", "Lunch", "SK-20260916-1223", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [16, "2026-09-29", "Lunch", "SK-20260916-7871", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [17, "2026-09-29", "Dinner", "SK-20260916-9497", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Prior Cancel)", 0, 0, 0, "Cancelled before 02-Oct Dinner; treated as consumed per policy"], [18, "2026-09-30", "Lunch", "SK-20260916-5000", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [19, "2026-09-30", "Dinner", "SK-20260916-3416", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Prior Cancel)", 42, 0, 0, "Cancelled before 02-Oct Dinner; treated as consumed per policy"], [20, "2026-10-01", "Lunch", "SK-20260916-2672", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [21, "2026-10-01", "Dinner", "SK-20260916-1129", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Prior Cancel)", 140, 0, 0, "Cancelled before 02-Oct Dinner; treated as consumed per policy"], [22, "2026-10-02", "Lunch", "SK-20260916-1554", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Consumed (Delivered)", 0, 0, 0, "Delivered & consumed (@ ₹126.00)"], [23, "2026-10-02", "Dinner", "SK-20260916-7874", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [24, "2026-10-03", "Lunch", "SK-20260916-4404", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 0, 0, 126, "Clawback absorbed in automated system; adjusted under policy"], [25, "2026-10-03", "Dinner", "SK-20260916-9683", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [26, "2026-10-05", "Lunch", "SK-20260916-4833", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 0, 0, 126, "Clawback absorbed in automated system; adjusted under policy"], [27, "2026-10-05", "Dinner", "SK-20260916-5313", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [28, "2026-10-06", "Lunch", "SK-20260916-6940", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 70, 0, 56, "Gateway refund settled to bank: ₹70"], [29, "2026-10-06", "Dinner", "SK-20260916-8408", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [30, "2026-10-07", "Lunch", "SK-20260916-9340", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [31, "2026-10-07", "Dinner", "SK-20260916-7799", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [32, "2026-10-08", "Lunch", "SK-20260916-3888", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [33, "2026-10-08", "Dinner", "SK-20260916-8877", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [34, "2026-10-09", "Lunch", "SK-20260916-7043", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [35, "2026-10-09", "Dinner", "SK-20260916-9872", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [36, "2026-10-10", "Lunch", "SK-20260916-3755", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [37, "2026-10-10", "Dinner", "SK-20260916-1494", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [38, "2026-10-12", "Lunch", "SK-20260916-5680", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [39, "2026-10-12", "Dinner", "SK-20260916-3620", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [40, "2026-10-13", "Lunch", "SK-20260916-9784", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [41, "2026-10-13", "Dinner", "SK-20260916-2892", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [42, "2026-10-14", "Lunch", "SK-20260916-5725", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [43, "2026-10-14", "Dinner", "SK-20260916-6452", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [44, "2026-10-15", "Lunch", "SK-20260916-4374", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [45, "2026-10-15", "Dinner", "SK-20260916-4361", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [46, "2026-10-16", "Lunch", "SK-20260916-1721", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 140, 0, -14, "Gateway refund settled to bank: ₹140"], [47, "2026-10-16", "Dinner", "SK-20260916-1923", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 0, 140, 126, "Gateway limit reached; queued as pending UPI ₹140"], [48, "2026-10-17", "Lunch", "SK-20260916-3776", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 0, 140, 126, "Gateway limit reached; queued as pending UPI ₹140"], [49, "2026-10-17", "Dinner", "SK-20260916-2486", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 0, 140, 126, "Gateway limit reached; queued as pending UPI ₹140"], [50, "2026-10-19", "Dinner", "SK-20260916-2604", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 0, 140, 126, "Gateway limit reached; queued as pending UPI ₹140"], [51, "2026-10-20", "Dinner", "SK-20260916-1006", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 0, 140, 126, "Gateway limit reached; queued as pending UPI ₹140"], [52, "2026-10-21", "Dinner", "SK-20260916-7599", "Jowar Bhakri (1) + Bajra Bhakri (1) + Dry Sabji Full (1) + Curry Sabji Full (1)", 140, 14, 126, "Unused (Cancelled)", 0, 140, 126, "Gateway limit reached; queued as pending UPI ₹140"]];

  const numRows = rowData.length;
  const numCols = tableHeaders.length;
  const dataRange = s2.getRange(6, 1, numRows, numCols);
  dataRange.setValues(rowData);
  dataRange.setBorder(true, true, true, true, true, true, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);

  // Formatting columns
  s2.getRange(6, 1, numRows, 4).setHorizontalAlignment('center');
  s2.getRange(6, 5, numRows, 1).setHorizontalAlignment('left');
  s2.getRange(6, 6, numRows, 3).setNumberFormat('₹#,##0.00').setHorizontalAlignment('right');
  s2.getRange(6, 9, numRows, 1).setHorizontalAlignment('center').setFontWeight('bold');
  s2.getRange(6, 10, numRows, 3).setNumberFormat('₹#,##0.00').setHorizontalAlignment('right');
  s2.getRange(6, 13, numRows, 1).setHorizontalAlignment('left').setFontColor('#5F6368').setFontSize(9);

  // Specific row styling
  for (let i = 0; i < numRows; i++) {
    const rowNum = 6 + i;
    const classification = rowData[i][8];
    const bal = rowData[i][11];

    if (classification.indexOf('Consumed') !== -1) {
      s2.getRange(rowNum, 9).setFontColor('#137333');
    } else {
      s2.getRange(rowNum, 9).setFontColor('#C5221F');
      s2.getRange(rowNum, 1, 1, numCols).setBackground(i % 2 === 0 ? '#FFFDF5' : '#FFFFFF');
    }

    if (bal > 0) {
      s2.getRange(rowNum, 12).setFontWeight('bold').setFontColor('#137333');
    } else if (bal < 0) {
      s2.getRange(rowNum, 12).setFontStyle('italic').setFontColor('#70757A');
    }
  }

  // Totals Row
  const totRow = 6 + numRows;
  const totValues = ['', 'TOTALS', '', '', '', '=SUM(F6:F57)', '=SUM(G6:G57)', '=SUM(H6:H57)', '22 Consumed / 30 Unused', '=SUM(J6:J57)', '=SUM(K6:K57)', '=SUM(L6:L57)', ''];
  s2.getRange(totRow, 1, 1, numCols).setValues([totValues])
    .setFontWeight('bold')
    .setBorder(true, true, true, true, false, false, '#1A365D', SpreadsheetApp.BorderStyle.DOUBLE);

  s2.getRange(totRow, 2).setHorizontalAlignment('center');
  s2.getRange(totRow, 6, 1, 3).setNumberFormat('₹#,##0.00').setHorizontalAlignment('right');
  s2.getRange(totRow, 9).setHorizontalAlignment('center');
  s2.getRange(totRow, 10, 1, 3).setNumberFormat('₹#,##0.00').setHorizontalAlignment('right');

  // Activate Executive Summary tab as initial view
  newSs.setActiveSheet(s1);

  return {
    status: 'ok',
    success: true,
    spreadsheetId: fileId,
    url: newSs.getUrl()
  };
}
