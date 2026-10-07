# Read claude.md and bump version number for pages with changes
# kitchen_live_manager.py  (New System)
# Reads a processed results dict (from auto_svaadh_summary) and pushes
# live kitchen totals to the Kitchen Dashboard Google Sheet.
#
# Item columns in SK_Orders (individual qty):
#   Chapati, Without_Oil_Chapati, Phulka, Ghee_Phulka, Jowar_Bhakri, Bajra_Bhakri
#   Dry_Sabji_Mini, Dry_Sabji_Full, Curry_Sabji_Mini, Curry_Sabji_Full
#   Dal, Rice, Salad, Curd
#   BF_Item_1/BF_Qty_1 … BF_Item_4/BF_Qty_4

import gspread
import pandas as pd
from datetime import datetime, timedelta
from google.oauth2.service_account import Credentials

# ── CONFIG ───────────────────────────────────────────────────
SERVICE_ACCOUNT_FILE   = "service_account.json"
LIVE_DASHBOARD_SHEET_ID = "1xdqwunCCMOOYRT8ewtn7kZoN440dJF5oB2fCY0ctsPE"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Cooking multipliers (same as before)
COOK_FACTORS = {
    "Dry_Sabji_Mini":   0.65,   # 100ml → weight factor
    "Dry_Sabji_Full":   1.40,   # 250ml
    "Curry_Sabji_Mini": 0.65,
    "Curry_Sabji_Full": 1.40,
    "Dal":              1.33,
}

# Marathi display names → new column name
ROTI_ITEMS = {
    "चपाती":             "Chapati",
    "विना तेल चपाती":    "Without_Oil_Chapati",
    "फुलका":             "Phulka",
    "तूप फुलका":         "Ghee_Phulka",
    "ज्वारी भाकरी":      "Jowar_Bhakri",
    "बाजरी भाकरी":       "Bajra_Bhakri",
    "भात (Rice)":        "Rice",
    "सलाड":              "Salad",
    "दही":               "Curd",
}

def update_live_dashboard(results: dict):
    """
    results: dict produced by process_data() in auto_svaadh_summary.
    Keys: "Breakfast", "Lunch", "Dinner" → DataFrames with new column names.
    """
    try:
        creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
        gc    = gspread.authorize(creds)
        sh    = gc.open_by_key(LIVE_DASHBOARD_SHEET_ID)
        ws    = sh.get_worksheet(0)

        ist_now   = datetime.utcnow() + timedelta(hours=5, minutes=30)
        if ist_now.hour < 8:
            meal_key = "Breakfast"
        elif ist_now.hour < 13:
            meal_key = "Lunch"
        else:
            meal_key = "Dinner"

        df = results.get(meal_key)
        if df is None or df.empty:
            print(f"❌ No {meal_key} data found.")
            return

        def col_sum(col_name):
            if col_name not in df.columns:
                return 0
            # Exclude last 2 rows (totals)
            s = df[col_name].iloc[:-2] if len(df) > 2 else df[col_name]
            return round(float(pd.to_numeric(s, errors="coerce").fillna(0).sum()), 2)

        # Sabji cooking quantities
        total_dry   = round(col_sum("Dry_Sabji_Mini") * 0.65 + col_sum("Dry_Sabji_Full") * 1.40, 2)
        total_curry = round(col_sum("Curry_Sabji_Mini") * 0.65 + col_sum("Curry_Sabji_Full") * 1.40, 2)
        total_dal   = round(col_sum("Dal") * 1.33, 2)

        display_data = [
            ["SVAADH KITCHEN LIVE", ""],
            ["MEAL TYPE:", meal_key.upper()],
            ["LAST UPDATED:", ist_now.strftime('%d %b | %I:%M %p')],
            ["----------------------------", "----------"],
            ["सुकी भाजी (एकूण)",  total_dry],
            ["रस्सा भाजी (एकूण)", total_curry],
            ["वरण (Dal)",          total_dal],
            ["----------------------------", "----------"],
        ]

        print("📋 Extraction Report:")
        for display_name, col_name in ROTI_ITEMS.items():
            qty = int(col_sum(col_name))
            print(f"   ✅ {display_name}: {qty}")
            display_data.append([f"🔹 {display_name}", qty])

        ws.clear()
        ws.update(range_name="A1", values=display_data)
        ws.format("A1:B3", {"textFormat": {"bold": True, "fontSize": 15}})
        ws.format("A5:B7", {"textFormat": {"bold": True, "fontSize": 15}})

        print(f"📊 Summary: Dry={total_dry}, Curry={total_curry}, Dal={total_dal}")
        print("✅ Kitchen Dashboard updated.")

    except Exception as e:
        print(f"❌ Dashboard Error: {e}")
