const fs = require('fs');
const filePath = '03_Admin_Kitchen.gs';
let content = fs.readFileSync(filePath, 'utf8');

const startMarker = '      try {\n        var ijRaw = JSON.parse(r.Items_JSON || "{}");';
const endMarker = '      Packed: r.Packed === true || String(r.Packed).toLowerCase() === "true"\n    });';

const normContent = content.replace(/\r\n/g, '\n');

const startIdx = normContent.indexOf(startMarker);
const endIdx = normContent.indexOf(endMarker, startIdx);

if (startIdx < 0 || endIdx < 0) {
  console.error('Markers not found', { startIdx, endIdx });
  process.exit(1);
}

const replacement = `      try {
        var ijRaw = JSON.parse(r.Items_JSON || "{}");
        var already = {};
        if (meal === "Breakfast") {
          for (var qn = 1; qn <= 4; qn++) {
            var nmQ = String(r["BF_Item_" + qn] || "").trim();
            if (nmQ) already[nmQ] = true;
          }
          if ((Number(r.Curd) || 0) > 0) already["Curd"] = true;
        } else {
          ROTI_COLS.forEach(function (cc) { if ((Number(r[cc]) || 0) > 0) { already[cc] = true; already[cc.replace(/_/g, " ")] = true; } });
          ["Dry_Sabji_Mini", "Dry_Sabji_Full", "Curry_Sabji_Mini", "Curry_Sabji_Full", "Dal", "Dal_Fry", "Rice", "Salad", "Curd"].forEach(function (cc) { if ((Number(r[cc]) || 0) > 0) already[cc] = true; });
          for (var qn2 = 1; qn2 <= 4; qn2++) { var nmQ2 = String(r["BF_Item_" + qn2] || "").trim(); if (nmQ2) already[nmQ2] = true; }
        }
        var hasColData = false;
        if (meal === "Breakfast") {
          for (var qn3 = 1; qn3 <= 4; qn3++) { if (String(r["BF_Item_" + qn3] || "").trim() && (Number(r["BF_Qty_" + qn3]) || 0) > 0) { hasColData = true; break; } }
        } else {
          ROTI_COLS.forEach(function (cc) { if ((Number(r[cc]) || 0) > 0) hasColData = true; });
          ["Dry_Sabji_Mini", "Dry_Sabji_Full", "Curry_Sabji_Mini", "Curry_Sabji_Full", "Dal", "Dal_Fry", "Rice", "Salad", "Curd"].forEach(function (cc) { if ((Number(r[cc]) || 0) > 0) hasColData = true; });
        }
        if (!hasColData) {
          Object.keys(ijRaw).forEach(function (kRaw) {
            var qtyJ = Number(ijRaw[kRaw]) || 0;
            if (qtyJ <= 0) return;
            var nmJ = String(kRaw).replace(/\\s*\\[.*?\\]\\s*/g, "").replace(/\\s*\\(.*?\\)\\s*/g, "").trim();
            if (nmJ === "Breakfast Curd") nmJ = "Curd";
            if (already[nmJ] || already[nmJ.replace(/ /g, "_")]) return;
            already[nmJ] = true;
            if (meal !== "Breakfast") {
              if (ROTI_COLS.indexOf(nmJ) >= 0 || ROTI_COLS.indexOf(nmJ.replace(/ /g, "_")) >= 0) {
                var rc = (ROTI_COLS.indexOf(nmJ) >= 0) ? nmJ : nmJ.replace(/ /g, "_");
                m.rotis[rc] = (m.rotis[rc] || 0) + qtyJ;
                calculatePackets(qtyJ, ROTI_LIMITS[rc]).forEach(function (p) { m.rotiMatrix[rc][p] = (m.rotiMatrix[rc][p] || 0) + 1; });
                summaryParts.push(qtyJ + " " + rc.replace(/_/g, " "));
              } else if (nmJ === "Curd") {
                m.other.Curd.count += qtyJ;
                calculatePackets(qtyJ, 2).forEach(function (p) { m.curdMatrix[p] = (m.curdMatrix[p] || 0) + 1; });
                summaryParts.push(qtyJ + " Curd");
              } else {
                if (!m.extras) m.extras = {};
                m.extras[nmJ] = (m.extras[nmJ] || 0) + qtyJ;
                summaryParts.push(qtyJ + " " + nmJ);
              }
            } else {
              m.items[nmJ] = (m.items[nmJ] || 0) + qtyJ;
              summaryParts.push(qtyJ + " " + nmJ);
            }
          });
        }
      } catch (eIJ) { /* malformed Items_JSON — column logic above already ran */ }

      // Build item map for labels
      var orderItems = {
        Chapati: Number(r.Chapati)||0, Without_Oil_Chapati: Number(r.Without_Oil_Chapati)||0,
        Phulka: Number(r.Phulka)||0, Ghee_Phulka: Number(r.Ghee_Phulka)||0,
        Jowar_Bhakri: Number(r.Jowar_Bhakri)||0, Bajra_Bhakri: Number(r.Bajra_Bhakri)||0,
        Dry_Sabji_Mini: Number(r.Dry_Sabji_Mini)||0, Dry_Sabji_Full: Number(r.Dry_Sabji_Full)||0,
        Curry_Sabji_Mini: Number(r.Curry_Sabji_Mini)||0, Curry_Sabji_Full: Number(r.Curry_Sabji_Full)||0,
        Dal: Number(r.Dal)||0, Dal_Fry: Number(r.Dal_Fry)||0, Rice: Number(r.Rice)||0, Salad: Number(r.Salad)||0, Curd: Number(r.Curd)||0
      };
      if (meal === "Breakfast") {
        for (var bn2 = 1; bn2 <= 4; bn2++) {
          var itm = String(r["BF_Item_" + bn2] || "").trim();
          var qnty = Number(r["BF_Qty_" + bn2]) || 0;
          if (itm && qnty > 0) orderItems[itm] = (orderItems[itm] || 0) + qnty;
        }
        if (Number(r.Curd) > 0) orderItems["Curd"] = Number(r.Curd);
      }
      if (r.Items_JSON) {
        try {
          var parsedIJ = JSON.parse(r.Items_JSON);
          Object.keys(parsedIJ).forEach(function(k) {
            var cleanK = String(k).replace(/\\s*\\[.*?\\]\\s*/g, "").replace(/\\s*\\(.*?\\)\\s*/g, "").trim();
            if (cleanK === "Breakfast Curd") cleanK = "Curd";
            var qVal = Number(parsedIJ[k]) || 0;
            if (qVal > 0 && !orderItems[cleanK]) {
              orderItems[cleanK] = qVal;
            }
          });
        } catch(_) {}
      }

      orders.push({
        Submission_ID: String(r.Submission_ID || ""),
        Customer_Name: (String(r.Source || "").trim() === "LS" && String(r.Customer_Name || "").trim().indexOf("[LS]") !== 0) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),
        Meal_Type: meal,
        summary: summaryParts.join(", "),
        items: orderItems,
        Special_Notes_Kitchen: String(r.Special_Notes_Kitchen || ""),
        Special_Notes_Delivery: String(r.Special_Notes_Delivery || ""),
        Delivery_Point: String(r.Delivery_Point || ""),
        marathiNotes: String(r.marathiNotes || ""),
        Packed: r.Packed === true || String(r.Packed).toLowerCase() === "true"
      });`;

const updatedContent = normContent.substring(0, startIdx) + replacement + normContent.substring(endIdx + endMarker.length);
fs.writeFileSync(filePath, updatedContent, 'utf8');
console.log('Successfully replaced getKitchenSummary block in 03_Admin_Kitchen.gs');
