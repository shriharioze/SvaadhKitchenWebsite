const fs = require('fs');

const replacement = `
  // BUILD EMAIL HTML
  const brandColor = "#0f766e"; // Teal
  const bgLight = "#f0fdfa";
  
  let html = \`<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; background-color: #f8fafc; padding: 20px; border-radius: 16px;">\`;
  
  // Header
  html += \`<div style="background: linear-gradient(135deg, #0f766e, #0369a1); color: #fff; padding: 30px 20px; border-radius: 12px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">\`;
  html += \`<div style="font-size: 2.5rem; margin-bottom: 10px;">🌙</div>\`;
  html += \`<h2 style="margin: 0; font-size: 1.8rem; font-weight: 800; letter-spacing: 0.5px;">Svaadh Kitchen</h2>\`;
  html += \`<div style="font-size: 1.1rem; opacity: 0.9; margin-top: 5px;">End of Day Report · \${todayStr}</div>\`;
  html += \`</div>\`;
  
  // 1. Financials
  html += \`<div style="background: #fff; padding: 25px; border-radius: 12px; margin-top: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">\`;
  html += \`<h3 style="margin-top: 0; color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">💰 Revenue & Finance</h3>\`;
  
  html += \`<div style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 15px; border-radius: 10px; margin-bottom: 15px; text-align: center;">\`;
  html += \`<div style="color: #065f46; font-size: 0.85rem; font-weight: 700; text-transform: uppercase;">Total Gross Revenue</div>\`;
  html += \`<div style="color: #059669; font-size: 2.2rem; font-weight: 800; margin-top: 5px;">₹\${totalGross.toFixed(2)}</div>\`;
  html += \`</div>\`;
  
  html += \`<table width="100%" cellpadding="10" cellspacing="0" style="background:#f8fafc; border-radius:8px;"><tr>\`;
  html += \`<td width="50%" style="border-right:1px solid #e2e8f0; text-align:center;">\`;
  html += \`<div style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">💳 Wallet Recharges</div>\`;
  html += \`<div style="font-size: 1.2rem; font-weight: 700; color: #3b82f6; margin-top: 4px;">₹\${totalRecharges.toFixed(2)}</div>\`;
  html += \`</td><td width="50%" style="text-align:center;">\`;
  html += \`<div style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">💸 Refunds</div>\`;
  html += \`<div style="font-size: 1.2rem; font-weight: 700; color: #ef4444; margin-top: 4px;">₹\${totalRefunds.toFixed(2)}</div>\`;
  html += \`</td></tr></table>\`;
  
  if (Object.keys(payMethods).length > 0) {
    html += \`<div style="margin-top: 15px; font-size: 0.9rem; color: #475569;"><b>Breakdown:</b> \`;
    let pParts = [];
    Object.keys(payMethods).forEach(function(k) { pParts.push(k + ": ₹" + payMethods[k].toFixed(2)); });
    html += pParts.join(" &nbsp;•&nbsp; ") + \`</div>\`;
  }
  html += \`</div>\`;
  
  // 2. Orders & Operations
  html += \`<div style="background: #fff; padding: 25px; border-radius: 12px; margin-top: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">\`;
  html += \`<h3 style="margin-top: 0; color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">📦 Fulfillment</h3>\`;
  
  html += \`<table width="100%" cellpadding="8" cellspacing="0"><tr>\`;
  html += \`<td width="50%" valign="top">\`;
  html += \`<div style="font-size: 1.8rem; font-weight: 800; color: #0ea5e9;">\${totalOrders} <span style="font-size:0.9rem; color:#64748b; font-weight:600;">Orders</span></div>\`;
  html += \`<div style="font-size: 0.85rem; color: #ef4444; margin-bottom: 15px;">\${cancelled} Cancelled</div>\`;
  html += \`<div style="font-size: 0.9rem; color: #334155; line-height: 1.6;">\`;
  html += \`🥞 Breakfast: <b>\${mealCounts.Breakfast}</b><br>\`;
  html += \`🍛 Lunch: <b>\${mealCounts.Lunch}</b><br>\`;
  html += \`🥘 Dinner: <b>\${mealCounts.Dinner}</b>\`;
  html += \`</div>\`;
  html += \`</td><td width="50%" valign="top" style="border-left:1px solid #f1f5f9; padding-left:15px;">\`;
  html += \`<div style="font-size: 0.85rem; font-weight: 700; color: #64748b; margin-bottom: 8px; text-transform: uppercase;">Storefronts</div>\`;
  html += \`<div style="font-size: 0.9rem; color: #334155; line-height: 1.6;">\`;
  html += \`🏠 Main (Hadapsar): <b>\${storefrontCounts.SK}</b><br>\`;
  html += \`🏢 Liviano-Serio: <b>\${storefrontCounts.LS}</b><br>\`;
  html += \`💼 IntentAmplify: <b>\${storefrontCounts.IA}</b>\`;
  html += \`</div>\`;
  html += \`</td></tr></table>\`;
  html += \`</div>\`;
  
  // 3. Customers & Highlights
  html += \`<div style="background: #fff; padding: 25px; border-radius: 12px; margin-top: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">\`;
  html += \`<h3 style="margin-top: 0; color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">👥 Customer Highlights</h3>\`;
  
  html += \`<div style="background: #eff6ff; border-radius: 8px; padding: 12px 15px; margin-bottom: 15px;">\`;
  html += \`<span style="font-size: 1.2rem;">👋</span> <span style="font-weight: 700; color: #1e3a8a;">\${newCusts}</span> <span style="color: #3b82f6; font-size: 0.9rem;">New customers joined today!</span>\`;
  html += \`</div>\`;
  
  html += \`<div style="font-size: 0.85rem; font-weight: 700; color: #64748b; margin-bottom: 8px; text-transform: uppercase;">🏆 Top Selling Items</div>\`;
  if (topItems.length > 0) {
    html += \`<div style="font-size: 0.95rem; color: #334155;">\`;
    topItems.forEach(function(i, idx) {
      const medals = ["🥇", "🥈", "🥉"];
      html += \`<div style="margin-bottom: 6px;">\${medals[idx] || "▪️"} <b>\${i.name}</b> (\${i.qty})</div>\`;
    });
    html += \`</div>\`;
  } else {
    html += \`<div style="font-size: 0.9rem; color: #94a3b8;">No items sold today.</div>\`;
  }
  html += \`</div>\`;
  
  // 4. Alerts
  html += \`<div style="background: #fff; padding: 25px; border-radius: 12px; margin-top: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); border-top: 4px solid #f59e0b;">\`;
  html += \`<h3 style="margin-top: 0; color: #b45309; border-bottom: 1px solid #fef3c7; padding-bottom: 10px;">🚨 Action Items</h3>\`;
  
  const mColor = missedCount > 0 ? (missedUnrecovered > 0 ? "#dc2626" : "#f59e0b") : "#10b981";
  const mIcon = missedCount > 0 ? (missedUnrecovered > 0 ? "⚠️" : "⚡") : "✅";
  html += \`<div style="margin-bottom: 15px; font-size: 0.95rem; color: #334155;">\`;
  html += \`\${mIcon} <b>Missed Orders:</b> <span style="color: \${mColor}; font-weight: 700;">\${missedCount} total (\${missedUnrecovered} unrecovered)</span>\`;
  html += \`</div>\`;
  
  // Pending
  if (pendingList.length > 0) {
    html += \`<div style="font-size: 0.85rem; font-weight: 700; color: #991b1b; margin-top: 15px; margin-bottom: 8px; text-transform: uppercase;">⏳ Pending Gateway Drops (\${pendingList.length})</div>\`;
    html += \`<ul style="margin: 0; padding-left: 20px; color: #334155; font-size: 0.9rem;">\`;
    pendingList.forEach(function(p) { html += \`<li style="margin-bottom:4px;"><b>\${p.Order_ID}</b> - \${p.Customer_Name} (₹\${p.Net_Total})</li>\`; });
    html += \`</ul>\`;
  } else {
    html += \`<div style="margin-bottom: 10px; font-size: 0.95rem; color: #334155;">✅ <b>Pending Orders:</b> None!</div>\`;
  }
  
  // On Account
  if (onAccountList.length > 0) {
    html += \`<div style="font-size: 0.85rem; font-weight: 700; color: #b45309; margin-top: 15px; margin-bottom: 8px; text-transform: uppercase;">📓 Unpaid On-Account (\${onAccountList.length})</div>\`;
    html += \`<ul style="margin: 0; padding-left: 20px; color: #334155; font-size: 0.9rem;">\`;
    onAccountList.forEach(function(p) { html += \`<li style="margin-bottom:4px;"><b>\${p.Order_ID}</b> - \${p.Customer_Name} (₹\${p.Net_Total})</li>\`; });
    html += \`</ul>\`;
  } else {
    html += \`<div style="margin-top: 10px; font-size: 0.95rem; color: #334155;">✅ <b>On Account Dues:</b> None!</div>\`;
  }
  html += \`</div>\`;
  
  html += \`<div style="text-align: center; margin-top: 25px; font-size: 0.8rem; color: #94a3b8;">\`;
  html += \`Generated automatically by Svaadh Kitchen Systems<br>Have a great night! 🌙\`;
  html += \`</div>\`;
  
  html += \`</div>\`;
`;

const file = '04_Reports_Misc.gs';
let c = fs.readFileSync(file, 'utf8');
const start = c.indexOf('// BUILD EMAIL HTML');
const end = c.indexOf('const recipient = Session.getEffectiveUser().getEmail();');
if (start !== -1 && end !== -1) {
  c = c.substring(0, start) + replacement + '\n  ' + c.substring(end);
  fs.writeFileSync(file, c, 'utf8');
  console.log('Replaced HTML builder successfully');
} else {
  console.log('Could not find boundaries');
}
