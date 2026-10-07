# Read claude.md and bump version number for pages with changes
# label_generator.py  (New System)
# Reads SK_Orders from Google Sheet directly — no Excel file needed.
# Generates PDF labels per meal per date.
# Run standalone (python label_generator.py) or import generate_labels_for_date()

try:
    from fpdf import FPDF
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "fpdf2", "-q"])
    from fpdf import FPDF

import os
import re
import json
import requests
import gspread
import pandas as pd
from datetime import datetime
from google.oauth2.service_account import Credentials

# ── CONFIG ───────────────────────────────────────────────────
SERVICE_ACCOUNT_FILE = "service_account.json"
SHEET_ID             = "17X7JOrMe1Oj_QykH7mk6UGoBjuguLfyC1RmKYATDXlI"
TAB_ORDERS           = "SK_Orders"
LABELS_ROOT          = os.path.join(os.getcwd(), "Processed_Orders", "Labels")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── FONTS ────────────────────────────────────────────────────
FONT_URLS = {
    "Regular": "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
    "Bold":    "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Bold.ttf",
}

def _ensure_fonts() -> bool:
    """Download Devanagari fonts if not cached locally. Returns True if fonts are ready."""
    all_ready = True
    for style, url in FONT_URLS.items():
        path = f"NotoSansDevanagari-{style}.ttf"
        if not os.path.exists(path):
            print(f"⬇️  Downloading font: {path}")
            try:
                r = requests.get(url, timeout=30)
                r.raise_for_status()
                with open(path, "wb") as f:
                    f.write(r.content)
            except Exception as e:
                print(f"⚠️  Font download failed ({e}). Devanagari labels will use Latin fallback.")
                all_ready = False
    return all_ready

# ── ABBREVIATIONS ────────────────────────────────────────────
ABBREV_EN = {
    "Chapati":              "CH",
    "Without_Oil_Chapati":  "CH(O)",
    "Phulka":               "PH",
    "Ghee_Phulka":          "GPH",
    "Jowar_Bhakri":         "J",
    "Bajra_Bhakri":         "B",
    "Dry_Sabji_Mini":       "D100",
    "Dry_Sabji_Full":       "D250",
    "Curry_Sabji_Mini":     "C100",
    "Curry_Sabji_Full":     "C250",
    "Dal":                  "DAL",
    "Rice":                 "R",
    "Salad":                "S",
    "Curd":                 "CU",
    "Kanda Poha [175g]":      "KP",
    "Ghee Upma [200g]":       "GU",
    "Sabudana Khichdi [200g]": "SK",
    "5 x Tikhi Pudi with 100 ml coriander chutney": "TP",
    "4 x Idli & 100ml Chutney": "ID",
    "Aloo Paratha":           "AP",
    "Thalipeeth":             "THT",
    "Paneer Paratha":         "PP",
    "Ghee Sheera [200g]":     "SH",
    "Curd 50g":               "CU",
    "Kanda Poha":           "KP",
    "Ghee Upma":            "GU",
    "Thalipeeth":           "TH",
    "Sabudana Khichdi":     "SK",
}

ABBREV_HI = {
    "Chapati":              "च",
    "Without_Oil_Chapati":  "च बिनतेल",
    "Phulka":               "फु",
    "Ghee_Phulka":          "घी फु",
    "Jowar_Bhakri":         "जो",
    "Bajra_Bhakri":         "बाज",
    "Dry_Sabji_Mini":       "सु १००",
    "Dry_Sabji_Full":       "सु २५०",
    "Curry_Sabji_Mini":     "र १००",
    "Curry_Sabji_Full":     "र २५०",
    "Dal":                  "दाल",
    "Rice":                 "भात",
    "Salad":                "स",
    "Kanda Poha [175g]":      "कांपो",
    "Ghee Upma [200g]":       "घीऊ",
    "Sabudana Khichdi [200g]": "साबु",
    "5 x Tikhi Pudi with 100 ml coriander chutney": "तिखी",
    "4 x Idli & 100ml Chutney": "इडली",
    "Aloo Paratha":           "आलू",
    "Thalipeeth":             "था",
    "Paneer Paratha":         "पनीर",
    "Ghee Sheera [200g]":     "शिरा",
    "Curd 50g":               "दही",
    "Kanda Poha":           "कांपो",
    "Ghee Upma":            "घीऊ",
    "Thalipeeth":           "था",
    "Sabudana Khichdi":     "साबु",
}

# ── DATA FETCH ───────────────────────────────────────────────
def fetch_orders(date_str: str, meal_type: str) -> pd.DataFrame:
    """Fetch SK_Orders rows for the given date + meal, return as DataFrame."""
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    gc    = gspread.authorize(creds)
    sh    = gc.open_by_key(SHEET_ID)
    ws    = sh.worksheet(TAB_ORDERS)
    data  = ws.get_all_records()
    df    = pd.DataFrame(data)

    if df.empty:
        return df

    df.columns = df.columns.str.strip()
    df = df[
        (df["Order_Date"].astype(str).str.strip() == date_str) &
        (df["Meal_Type"].astype(str).str.strip().str.title() == meal_type.title())
    ].copy()
    return df


# ── LABEL BUILDING ───────────────────────────────────────────
def _abbr(key: str, abbr_dict: dict) -> str:
    """Lookup abbreviation; fall back to key itself."""
    if key in abbr_dict:
        return abbr_dict[key]
    # Try case-insensitive
    for k, v in abbr_dict.items():
        if k.lower() == key.lower():
            return v
    return key


def build_label_text(row: pd.Series, meal_type: str, abbr_dict: dict) -> str:
    """Build the short item summary string for a label."""
    parts = []

    if meal_type.lower() == "breakfast":
        # Read BF_Item_N / BF_Qty_N columns
        for n in range(1, 5):
            item_col = f"BF_Item_{n}"
            qty_col  = f"BF_Qty_{n}"
            if item_col not in row.index or qty_col not in row.index:
                continue
            item = str(row[item_col]).strip()
            qty  = pd.to_numeric(row[qty_col], errors="coerce")
            if not item or item in ("", "nan", "0") or pd.isna(qty) or qty <= 0:
                continue
            abbr = _abbr(item, abbr_dict)
            parts.append(f"{int(qty)}×{abbr}")
        # Curd for breakfast
        curd_qty = pd.to_numeric(row.get("Curd", 0), errors="coerce")
        if not pd.isna(curd_qty) and curd_qty > 0:
            parts.append(f"{int(curd_qty)}×{_abbr('Curd', abbr_dict)}")
    else:
        # Lunch / Dinner — named columns
        item_cols = [
            "Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka",
            "Jowar_Bhakri","Bajra_Bhakri",
            "Dry_Sabji_Mini","Dry_Sabji_Full",
            "Curry_Sabji_Mini","Curry_Sabji_Full",
            "Dal","Rice","Salad","Curd",
        ]
        for col in item_cols:
            if col not in row.index:
                continue
            qty = pd.to_numeric(row[col], errors="coerce")
            if pd.isna(qty) or qty <= 0:
                continue
            parts.append(f"{int(qty)}×{_abbr(col, abbr_dict)}")

    # Also parse Items_JSON as fallback if named cols all empty
    if not parts:
        try:
            items_json = json.loads(str(row.get("Items_JSON", "{}")))
            for key, qty in items_json.items():
                if pd.to_numeric(qty, errors="coerce") > 0:
                    parts.append(f"{int(qty)}×{_abbr(key, abbr_dict)}")
        except Exception:
            pass

    return ", ".join(parts)


# ── PDF GENERATOR ────────────────────────────────────────────
def generate_label_pdf(
    labels: list,           # [(name, summary_text, notes), ...]
    output_path: str,
    width_mm: float = 50,
    height_mm: float = 25,
    gap_mm: float = 2.7,
    font_size: int = 13,
    language: str = "English",
):
    block_h     = height_mm + gap_mm
    total_h     = len(labels) * block_h
    left_margin = 2
    max_w       = width_mm - 4
    min_fs      = 8

    pdf = FPDF(orientation="P", unit="mm", format=(width_mm, total_h))
    pdf.set_margins(0, 0, 0)
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()

    if language.lower() == "devanagari" and _ensure_fonts():
        pdf.add_font("NotoSansDev", "",  "NotoSansDevanagari-Regular.ttf")
        pdf.add_font("NotoSansDev", "B", "NotoSansDevanagari-Bold.ttf")
        base_font = "NotoSansDev"
    else:
        if language.lower() == "devanagari":
            print("⚠️  Falling back to Helvetica — Devanagari font unavailable offline.")
        base_font = "Helvetica"

    for i, (name, summary, notes) in enumerate(labels):
        start_y      = i * block_h
        label_bottom = start_y + height_mm

        # Name line (always Helvetica bold for legibility)
        # Auto-shrink then ellipsize so long names never wrap into the next label.
        name_text = f"Name: {name.strip()}"
        name_fs   = font_size
        pdf.set_font("Helvetica", style="B", size=name_fs)
        while pdf.get_string_width(name_text) > max_w and name_fs > min_fs:
            name_fs -= 0.5
            pdf.set_font("Helvetica", style="B", size=name_fs)
        # If still too wide at min font, truncate with a real ellipsis character.
        if pdf.get_string_width(name_text) > max_w:
            while len(name_text) > 3 and pdf.get_string_width(name_text + "…") > max_w:
                name_text = name_text[:-1]
            name_text = name_text.rstrip() + "…"
        pdf.set_xy(left_margin, start_y + 2)
        pdf.cell(max_w, 6, name_text, ln=1, align="L")
        # Restore default name-line font size for downstream math that assumes `font_size`
        pdf.set_font("Helvetica", style="B", size=font_size)

        # Summary line
        pdf.set_font(base_font, size=font_size)
        cur_y   = pdf.get_y() + 1
        cur_fs  = font_size
        text    = summary.strip()
        while pdf.get_string_width(text) > max_w * 1.05 and cur_fs > min_fs:
            cur_fs -= 0.5
            pdf.set_font(base_font, size=cur_fs)
        pdf.set_xy(left_margin, cur_y)
        pdf.multi_cell(max_w, 5.5 * (cur_fs / font_size), text, align="L")

        # Notes line
        cur_y = pdf.get_y() + 1
        if notes:
            avail = label_bottom - cur_y
            lh    = 5.5 * (cur_fs / font_size)
            if avail > lh:
                pdf.set_font(base_font, size=max(cur_fs - 1, min_fs))
                note = notes.strip()
                if pdf.get_string_width(note) > max_w:
                    note = note[:40] + "…"
                pdf.set_xy(left_margin, cur_y)
                pdf.cell(max_w, lh, note, ln=1, align="L")

        # Separator line
        pdf.set_draw_color(0, 0, 0)
        pdf.set_line_width(0.2)
        pdf.line(1, (i + 1) * block_h - gap_mm, width_mm - 1, (i + 1) * block_h - gap_mm)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    pdf.output(output_path)
    print(f"✅ PDF saved → {output_path}  ({len(labels)} labels)")


# ── MAIN ENTRY ───────────────────────────────────────────────
def generate_labels_for_date(
    date_str:  str,
    meal_type: str,
    language:  str = "English",
):
    """
    Fetch orders from Sheet, build labels, save PDF.
    Returns output_path.
    """
    print(f"📋 Fetching {meal_type} orders for {date_str}…")
    df = fetch_orders(date_str, meal_type)

    if df.empty:
        print(f"⚠️  No {meal_type} orders found for {date_str}.")
        return None

    abbr_dict = ABBREV_HI if language.lower() == "devanagari" else ABBREV_EN
    labels    = []

    for _, row in df.iterrows():
        name    = str(row.get("Customer_Name", "")).strip().title()
        notes   = ""  # User requested removal from labels
        summary = build_label_text(row, meal_type, abbr_dict)

        if not name or name.lower() == "nan":
            continue
        if not summary:
            continue

        labels.append((
            name,
            summary,
            notes if notes.lower() not in ("nan", "") else "",
        ))

    if not labels:
        print("⚠️  No valid labels to generate.")
        return None

    dt         = datetime.strptime(date_str, "%Y-%m-%d")
    lang_tag   = "hindi" if language.lower() == "devanagari" else "eng"
    meal_slug  = meal_type.lower()
    out_dir    = os.path.join(
        LABELS_ROOT, str(dt.year), dt.strftime("%B"), meal_slug
    )
    out_path   = os.path.join(
        out_dir, f"labels_{meal_slug}_{lang_tag}_{date_str}.pdf"
    )

    generate_label_pdf(
        labels, out_path,
        width_mm=50, height_mm=25, gap_mm=2.7,
        font_size=13, language=language,
    )
    return out_path


# ── STANDALONE CLI ───────────────────────────────────────────
if __name__ == "__main__":
    date_in = input("📅 Date (YYYY-MM-DD) or Enter for today: ").strip()
    if not date_in:
        date_in = datetime.today().strftime("%Y-%m-%d")

    meal_in = input("🍽️  Meal (Breakfast/Lunch/Dinner): ").strip().title()
    if meal_in not in ("Breakfast", "Lunch", "Dinner"):
        print("❌ Invalid meal. Choose Breakfast, Lunch, or Dinner.")
        exit(1)

    lang_in = input("🔤 Language (English/Devanagari) [Enter=English]: ").strip() or "English"

    result = generate_labels_for_date(date_in, meal_in, lang_in)
    if result:
        print(f"\n✅ Done → {result}")
