// ═══════════════════════════════════════════════════════
// SVAADH KITCHEN — i18n (English only)
// Provides t(key, vars) for dynamic UI strings used by
// order.html and reviews.js. Static HTML text is hardcoded.
// ═══════════════════════════════════════════════════════
(function () {
  var T = {
    // ── Header ──────────────────────────────────────────
    header_tagline: "Home-cooked food, made for you",

    // ── How-it-works screen ─────────────────────────────
    how_welcome: "Welcome to Svaadh Kitchen",
    how_tagline: "Fresh home-cooked food, delivered to your door",
    how_title: "How to order",
    how_step1_title: "Enter your phone number",
    how_step1_desc: "Your number is your identity — protected by a 4-digit PIN. Your address and preferences are saved automatically for next time.",
    how_step2_title: "Enter your delivery address",
    how_step2_desc: "Wing, flat number, society, and area. Each meal can go to a <strong>different address</strong> — breakfast at home, lunch at the office (e.g., Pentagon 1 or Tower 13), dinner back home.",
    how_step3_title: "Select your dates",
    how_step3_desc: "Tap one or multiple dates on the calendar. Order for the whole week in one go. We are closed on Sundays.",
    how_step4_title: "Choose your meals",
    how_step4_desc: "Pick items for Breakfast, Lunch, and Dinner. Today's fresh sabji is displayed for each meal. Type a quantity or tap + / −.",
    how_step5_title: "Review your bill & pay",
    how_step5_desc: "See your full itemized bill with discounts applied automatically. Pay via UPI QR code or UPI app.",
    how_cutoffs_label: "⏰ Order cutoffs",
    how_discounts_label: "💰 Discounts",
    how_delivery_label: "🚚 Delivery & Fees",
    how_help_label: "❓ Help",
    how_cta: "Got it, let's start! →",

    // ── Step 1 ───────────────────────────────────────────
    step1_title: "📱 Enter your phone number",
    phone_label: "Mobile Number",
    phone_hint: "We'll load your saved details if you've ordered before.",
    btn_view_orders: "📋 View / Edit upcoming orders",
    faq_title: "❓ Frequently Asked Questions",

    // ── Step 2 ───────────────────────────────────────────
    step2_details_title: "👤 Your Details",
    label_first_name: "First Name *",
    label_last_name: "Last Name *",
    label_payment_pref: "Payment Preference",
    payment_pref_can_change: "(can change anytime)",
    payment_daily_opt: "Daily Payment",
    payment_prepaid_opt: "Prepaid Wallet Billing",
    payment_helper: "💡 <strong>Daily:</strong> pay after each order &nbsp;·&nbsp; <strong>Prepaid:</strong> auto-deducts per order from your loaded Svaadh Wallet balance.",
    step2_addr_title: "📍 Delivery Address",
    same_addr_label: "Same address for all meals (Breakfast, Lunch & Dinner)",
    label_area: "Delivery Area *",
    select_area_ph: "— Select area —",
    label_wing: "Wing / Building / Tower",
    label_flat: "Flat / Office No.",
    label_floor: "Floor",
    label_society: "Society / Building / Office Park *",
    label_delivery_point: "Deliver to",
    opt_point_door: "Handover at Doorstep / Office Door (Default)",
    opt_point_bell_keep: "Keep outside & Ring bell",
    opt_point_lobby_handoff: "Handover at Lobby / Reception",
    opt_point_lobby_keep: "Keep at Lobby / Reception",
    opt_point_gate_handoff: "Handover at Security Gate",
    opt_point_gate_keep: "Keep at security cabin",
    opt_point_comedown: "I will come down",
    opt_point_other: "Other (see instructions)",
    label_maps: "📍 Google Maps Pin Link",
    label_optional: "(optional)",
    label_landmark: "🏷️ Landmark / Directions",
    per_meal_tip: "<strong>Tip:</strong> Fill in each meal's delivery address separately. Leave a section blank if you won't be ordering that meal.",
    bf_addr_title: "Breakfast Delivery Address",
    l_addr_title: "Lunch Delivery Address",
    d_addr_title: "Dinner Delivery Address",
    label_area_simple: "Area",
    label_maps_simple: "📍 Maps Link",
    label_landmark_simple: "🏷️ Landmark",
    label_delpoint_simple: "Deliver to",

    // ── Step 3 ───────────────────────────────────────────
    step3_title: "🗓️ Select Delivery Dates",
    step3_tip: "🚚 <strong>Free delivery</strong> if meal total ≥ ₹100 (or Bhosale Nagar) &nbsp;·&nbsp; 🎉 <strong>5% off</strong> ≥ ₹300/day &nbsp;·&nbsp; <strong>7.5% off</strong> ≥ ₹450/day",

    // ── Step 4 ───────────────────────────────────────────
    step4_title: "🍱 Choose Your Meals",
    copy_to_all_btn: "📋 Copy meals to all dates",

    // ── Step 5 — Bill & Payment ──────────────────────────
    step5_summary_title: "🧾 Order Summary",
    step5_payment_title: "💳 Payment",
    payment_warning_html: "⚠️ <strong>Please confirm only after payment is complete.</strong><br><span style=\"color:#78350f;\">Each transaction is verified manually. Please do not mark as paid before completing payment.</span>",
    upi_scan_hint: "Scan QR code <strong>or</strong> tap the button below to pay",
    payment_note_label: "📝 <strong>Payment note:</strong>",
    step5_wallet_title: "💳 Svaadh Wallet Balance",
    paid_confirm_label: "✅ Will pay — I'll complete the UPI payment right after placing this order",

    // ── Step 5 — Prepaid Wallet Hissab ────────────────────────
    step5_hissab_title: "📒 Your Wallet Account",
    prev_due_heading: "⚠️ Previous period due",
    prev_due_paid_note: "✅ Already paid? Ignore this — we'll update your account within 1–2 days.",
    pay_now_heading: "💳 Pay now",
    screenshot_whatsapp: "After payment, send screenshot on WhatsApp:",
    hissab_card_label: "Total owed this period",
    hissab_msg_html: "✅ This order is automatically deducted from your Prepaid Wallet balance.",
    tenday_warning_html: "⚠️ <strong>Maintain Balance.</strong> Orders require sufficient Wallet balance to process.",
    tenday_confirm_label: "I confirm to deduct this from my Wallet",

    // ── Success screen ────────────────────────────────────
    success_title: "Order Placed!",
    success_msg: "Your order is confirmed. Fresh food, on time, every time.",
    order_id_label: "Order ID:",
    success_whatsapp_hint: "Questions? WhatsApp us:",
    btn_another_order: "Place another order →",
    btn_back_website: "🏠 Back to main website",

    // ── Manage Orders ────────────────────────────────────
    manage_title: "📋 Your Upcoming Orders",
    btn_back_manage: "← Back",

    // ── Nav / Buttons ────────────────────────────────────
    btn_back_nav: "← Back",
    btn_continue: "Continue →",
    btn_save_continue: "Save & continue",
    btn_review: "Review Order →",
    btn_place: "Place Order 🎉",

    // ── Step labels ──────────────────────────────────────
    steps: ["Phone", "Your Details", "Select Dates", "Choose Meals", "Review & Pay"],

    // ── Modals ────────────────────────────────────────────
    how_modal_title: "🍛 How it works",
    how_modal_close: "Close",
    back_to_main: "← Back to main website",

    // ── JS Toast / dynamic strings ───────────────────────
    toast_valid_phone: "Enter a valid 10-digit number",
    toast_indian_phone: "Enter a valid Indian mobile number (must start with 6–9)",
    toast_first_name: "Enter your first name",
    toast_last_name: "Enter your last name",
    toast_flat: "Enter your flat number",
    toast_society: "Enter your society / building name",
    toast_area: "Select your delivery area",
    toast_at_least_one_addr: "Enter a flat number for at least one meal address",
    toast_select_date: "Select at least one date",
    toast_select_item: "Select at least one item",
    toast_server_slow: "Server is taking too long — please try again.",
    toast_confirm_order: "Please confirm your order",
    toast_confirm_payment: "Please confirm payment",
    toast_order_updated: "✅ Order updated!",
    toast_order_deleted: "Order deleted",
    toast_add_item: "Add at least one item",
    toast_enter_phone_first: "Enter your phone number first",
    toast_recharge_submitted: "Recharge Submitted! 💰 payment submitted successfully. Our team will verify it shortly. Your wallet balance will be updated soon. ✅",
    toast_payment_submitted: "Order Received! 🍱 payment submitted successfully. Our team will verify it shortly. Rest assured, your meal is confirmed and will be delivered on schedule! ✅",
    toast_server_timeout: "Request timed out. Check Manage Orders — if your order appears, you're all set. If not, place it again.",
    toast_no_meals_to_copy: "No meals selected on this date to copy",
    toast_copied: "Copied to {n} date(s) ✅",

    // ── Dynamic UI strings ───────────────────────────────
    loading_checking: "Checking…",
    loading_logging_in: "Logging you in…",
    loading_loading: "Loading…",
    loading_building: "Building summary…",
    loading_placing: "Placing order…",
    loading_menu: "Fetching today's menu…",
    loading_account: "Loading your account…",
    welcome_back: "👋 Welcome back, {name}!",
    welcome_back_hint: "Details pre-filled — tap <strong>Continue →</strong> if nothing has changed.",
    no_changes_hint: "✅ No changes needed? Just scroll down and tap <strong>Continue →</strong>",
    tap_dates_hint: "Tap dates to select (multiple OK)",
    no_upcoming_orders: "No upcoming orders found.",
    cutoff_passed_edit: "⏰ Cutoff passed — cannot edit",
    cutoff_passed_meal: "Order cutoff has passed for {meal} today.",  // only shown for today's date
    all_cutoffs_passed_title: "No more meals available today",
    bf_menu_not_set: "Today's breakfast menu hasn't been set yet. Check our WhatsApp for updates!",
    kitchen_closed: "Kitchen is closed on Sundays! 🚪 Enjoy your weekend.",
    special_instructions_label: "Special instructions (optional)",
    special_instructions_ph: "Jain, less spicy, no onion…",
    label_notes_kitchen: "Special instructions for kitchen staff (optional)",
    ph_notes_kitchen: "",
    label_notes_delivery: "Special instructions for driver staff (optional)",
    ph_notes_delivery: "Special instructions for driver staff (optional)",
    cutoff_default: "Cutoff {time}",
    cutoff_extended: "Extended to {time}",
    cutoff_reduced: "Early cut off {time}",
    day_total: "Day Total",
    bill_grand_total: "Grand Total",
    grand_total: "Grand Total",
    all_dates_label: "All dates",
    period_label: "Period: {p} · Includes this order (₹{amt})",
    period_this_order: "This order: ₹{amt} · Period: {p}",
    copy_confirm: "Copy meals from {date} to {n} other date(s)?",
    delete_confirm: "Delete your {meal} order for {date}?",
    empty_dates_warn: "⚠️ {n} date(s) have no meals selected:\n{dates}\n\nContinue anyway?",
    upi_copy_label: "📋 Copy UPI ID",
    upi_pay_btn: "👆 Click here to pay ₹{amt} via any UPI app",
    upi_copied_toast: "UPI ID copied! Open GPay / PhonePe / Paytm to pay ₹{amt}",
    ios_hint: "📱 <strong>iPhone users:</strong> Scan the QR above with your camera, or copy the UPI ID and open GPay / PhonePe / Paytm to pay ₹{amt}.",
    manage_no_items: "No items available for this meal.",
    today_breakfast_label: "Today's Breakfast",
    extras_label: "Extras",
    prev_period_label: "{label} · Payment not yet received",
    qr_amount_label: "₹{amt} due for {label}",

    // ── Reviews widget (index.html) ───────────────────────
    idx_reviews_title: "What Our Customers Say",
    idx_reviews_count: "reviews on Google",
    idx_review_us: "Review us on Google",
    idx_read_more: "Read more",
    idx_read_less: "Show less",

    upi_or: "or",
    review_thanks_title: "Thank you! ❤️",
    review_thanks_msg: "Your 5-star rating and review really means a lot to us. We hope you enjoyed your discounted meals!",
    review_promo_text: "Loved the food? Get 10% OFF on your next 3 orders!",
    review_promo_sub: "Leave us a 5-star rating & review on Google to unlock your reward.",
    review_promo_cta: "Leave a Review & Get Discount",
    review_promo_link: "https://g.page/r/CasEH8gGAhzLEAE/review"
  };

  // ── Core API ─────────────────────────────────────────────
  window.t = function (key, vars) {
    var str = T[key] !== undefined ? T[key] : key;
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (_, k) {
      return vars[k] !== undefined ? vars[k] : '{' + k + '}';
    });
  };

  window.applyLang = function () {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = window.t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = window.t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = window.t(el.getAttribute('data-i18n-placeholder'));
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.applyLang();
  });
})();
