/* ============================================================
   order-chat.js — help-chat widget for order.html
   ------------------------------------------------------------
   A self-contained, namespaced assistant so customers can ASK
   their questions instead of opening the "📖 Guide to Order"
   hub and reading each guide. Deliberately NOT the index page's
   chat.js: that script overrides window.toggleFAQ (order.html
   has its OWN toggleFAQ) and offers a "Place Order" button that
   is pointless here. Everything below is wrapped in an IIFE with
   unique ids/classes so it touches nothing in the order app.

   SECURITY: the chat backend (handleChat) is stateless — it has
   NO access to any customer's account, wallet, orders, PINs or
   payment/transaction data (there is no lookup path to them). It
   only answers from public business info + the public menu. We
   also send page:"order" so the server prompt reinforces: never
   reveal another customer's data, and point personal wallet/
   order questions to the on-page dashboard. So a logged-in
   customer using this widget exposes nothing sensitive.
   ============================================================ */
(function () {
  "use strict";
  var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W/exec";
  var HISTORY_KEY = "svaadhOrderChatHistory";
  var WA = "+91 93222 46765";

  // ── Storefront detection ─────────────────────────────────────
  // The Liviano-Serio page (docs/Liviano-Serio.html) embeds this same widget.
  // When loaded there, chips/greeting/answers switch to LS-specific facts:
  // Lunch & Dinner only · always-free delivery · self pickup now (G2 804,
  // Ganga Serio, Kharadi) · doorstep delivery launching soon · wings A–G2
  // (A–D = Liviano, E1–G2 = Serio). The main order page path is unchanged.
  var IS_LS = (window.STOREFRONT === "LS") || /liviano-serio/i.test(location.pathname || "");
  var LS_CONTEXT = "[You are answering on the Svaadh Kitchen page exclusively for Ganga Serio residents, Kharadi. Facts: Lunch & Dinner ONLY (no breakfast). Delivery is ALWAYS FREE here; doorstep delivery is launching soon — Self Pickup from G2 804, Ganga Serio is available now. Wings A,B,C,D = Liviano; E1,E2,F1,F2,G1,G2 = Serio. Cutoffs: Lunch 9:00 AM, Dinner 4:30 PM; closed Sundays. Wallet & loyalty are shared with the main svaadhkitchen.in site. Discounts: 5% ≥₹325/day, 7.5% ≥₹485, 10% ≥₹750.]\n\n";

  function init() {
    var widget = document.getElementById("sk-chat-widget");
    if (!widget || widget.dataset.mounted === "1") return;
    widget.dataset.mounted = "1";

    widget.innerHTML =
      '<div class="sk-chat-invite" id="skChatInvite" role="button" tabindex="0">' +
        '<span class="sk-chat-invite-txt">Have a doubt? 💬 Chat with us — get instant answers!</span>' +
        '<button class="sk-chat-invite-x" id="skChatInviteX" aria-label="Dismiss">✕</button>' +
      '</div>' +
      '<button class="sk-chat-fab" id="skChatFab" aria-label="Open help chat">💬</button>' +
      '<div class="sk-chat-panel" id="skChatPanel" role="dialog" aria-label="Svaadh Kitchen help chat">' +
        '<div class="sk-chat-head">' +
          '<span class="sk-chat-title">Svaadh Kitchen 🧡 Help</span>' +
          '<div class="sk-chat-actions">' +
            '<button class="sk-chat-iconbtn" id="skChatNew" title="Start new chat">🔄</button>' +
            '<button class="sk-chat-iconbtn" id="skChatClose" title="Close">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="sk-chat-body" id="skChatBody"></div>' +
        '<div class="sk-chat-quick" id="skChatQuick"></div>' +
        '<div class="sk-chat-foot">' +
          '<textarea id="skChatInput" placeholder="Ask about menu, pricing, delivery…"></textarea>' +
          '<button class="sk-chat-send" id="skChatSend">Send</button>' +
        '</div>' +
      '</div>';

    var fab   = document.getElementById("skChatFab");
    var panel = document.getElementById("skChatPanel");
    var body  = document.getElementById("skChatBody");
    var quick = document.getElementById("skChatQuick");
    var input = document.getElementById("skChatInput");
    var send  = document.getElementById("skChatSend");

    // Guide-oriented starter questions (mirror the "Guide to Order" hub topics).
    // The 6 quick questions answer from CANNED text (below) — a chip click serves it
    // instantly with NO Gemini call, saving API tokens/quota on the most common taps.
    // Typing a question still goes to Gemini. NOTE: these mirror the same facts as
    // BUSINESS_CONTEXT / the FAQ — keep them in sync when prices or policies change.
    var CHIPS = IS_LS ? [
      { label: "🚚 Delivery & pickup", msg: "How does delivery work here and what does it cost?",
        answer: "**Good news — delivery on this page is always FREE.** 🎉\n\n• **Doorstep delivery** to Ganga Serio is **launching soon** — we'll notify you the moment it starts.\n• Until then, **📦 Self Pickup** is available from **G2 804, Ganga Serio, Kharadi**.\n• No delivery charges, no minimum order — ever. 💛" },
      { label: "💰 How pricing works", msg: "How does your pricing work — how do I build a meal and what does it cost?",
        answer: "You build your own meal — no fixed thali, pick exactly what you want (Lunch & Dinner):\n\n**Breads:** Chapati ₹10 · Without-oil Chapati ₹9 · Phulka ₹8 · Ghee Phulka ₹11 · Jowar/Bajra Bhakri ₹22\n**Sabji:** Mini 100ml ₹24 · Full 250ml ₹48 (dry or curry)\n**Basics:** Dal ₹24 · Dal Fry ₹40 · Rice ₹13 · Salad ₹8 · Curd ₹13\n\nA typical meal — 2 Chapati + Full Sabji + Dal + Rice — is about ₹105 before discounts. 💛" },
      { label: "🎁 Discounts & loyalty", msg: "How do the discounts and the loyalty programme work?",
        answer: "**Automatic day discounts** (on your whole day's food total):\n• 5% off at ₹325+\n• 7.5% off at ₹485+\n• 10% off at ₹750+\n\n**Loyalty:** order 6 days in a row and on day 6 you get 5% of your 6-day food total back. Sundays (closed) don't break the streak.\n\n**Review reward:** leave a 5-star Google review and get 10% off your next order. 🌟" },
      { label: "⚡ Bulk meal plans", msg: "Tell me about your weekly, 15-day and monthly bulk meal plans.",
        answer: "Order in advance and save more:\n• **Weekly** — 6 days, 5% off\n• **15-Day** — 13 days, 7.5% off\n• **Monthly** — 26 days, 10% off\n\nYou can **postpone** days if plans change (15-Day: 2 lunch + 2 dinner; Monthly: 4 + 4) instead of cancelling. Cancelling a day forfeits that meal's bulk discount. Sundays are off." },
      { label: "⏰ Order timings", msg: "What are your order cut-off timings?",
        answer: "Same-day order cut-offs:\n• ☀️ **Lunch** — by 9:00 AM\n• 🌙 **Dinner** — by 4:30 PM\n\nYou can order for **future dates anytime**. We're closed on **Sundays**. (Cut-offs can shift slightly on special days — the order page always shows the live time.)" },
      { label: "👛 Svaadh Wallet", msg: "What is the Svaadh Wallet and how do refunds work?",
        answer: "Your **Svaadh Wallet** is your prepaid balance with us.\n• Recharge any time and pay in a tap at checkout.\n• Any **refund** (e.g. a cancelled meal) goes back to your wallet **instantly** — no waiting.\n• Cancel before that meal's cut-off from '📋 Manage Orders'.\n\nSee every wallet transaction under '👛 Wallet' on the order page." },
      { label: "🏢 Who is this page for?", msg: "Which building and wings does this page serve?",
        answer: "This page is **exclusively for Ganga Serio residents, Kharadi**.\n\n• Wings **A, B, C, D** → Liviano\n• Wings **E1, E2, F1, F2, G1, G2** → Serio\n\nSelect your Wing and your Society fills in automatically. Live outside Ganga Serio? Please order from **svaadhkitchen.in/order.html**. 😊" }
    ] : [
      { label: "💰 How pricing works", msg: "How does your pricing work — how do I build a meal and what does it cost?",
        answer: "You build your own meal — no fixed thali, pick exactly what you want:\n\n**Breads:** Chapati ₹10 · Without-oil Chapati ₹9 · Phulka ₹8 · Ghee Phulka ₹11 · Jowar/Bajra Bhakri ₹22\n**Sabji:** Mini 100ml ₹24 · Full 250ml ₹48 (dry or curry)\n**Basics:** Dal ₹24 · Rice ₹13 · Salad ₹8 · Curd ₹13\n**Breakfast:** rotates daily, ₹35–₹70.\n\nA typical meal — 2 Chapati + Full Sabji + Dal + Rice — is about ₹105 before discounts. 💛" },
      { label: "🚚 Delivery & charges", msg: "What are your delivery charges and when is delivery free?",
        answer: "**Delivery:** ₹11 per meal.\n\n**It's FREE when:**\n• Your day's food total reaches ₹106 (1 meal), ₹159 (2 meals) or ₹190 (3 meals)\n• You're in Bhosale Nagar or Triveni Nagar\n• You choose Self Pickup (always free)\n\nA small ₹11 cart fee applies to a Lunch/Dinner meal under ₹53. On very busy days, orders of ₹200+ (₹100+ for breakfast) still get home delivery; otherwise you can pick Self Pickup or arrange a Porter." },
      { label: "🎁 Discounts & loyalty", msg: "How do the discounts and the loyalty programme work?",
        answer: "**Automatic day discounts** (on your whole day's food total):\n• 5% off at ₹325+\n• 7.5% off at ₹485+\n• 10% off at ₹750+\n\n**Loyalty:** order 6 days in a row and on day 6 you get 5% of your 6-day food total back. Sundays (closed) don't break the streak.\n\n**Review reward:** leave a 5-star Google review and get 10% off your next order. 🌟" },
      { label: "⚡ Bulk meal plans", msg: "Tell me about your weekly, 15-day and monthly bulk meal plans.",
        answer: "Order in advance and save more:\n• **Weekly** — 6 days, 5% off\n• **15-Day** — 13 days, 7.5% off\n• **Monthly** — 26 days, 10% off\n\nYou can **postpone** days if plans change (15-Day: 2 lunch + 2 dinner; Monthly: 4 + 4) instead of cancelling. Cancelling a day forfeits that meal's bulk discount. Sundays are off." },
      { label: "⏰ Order timings", msg: "What are your order cut-off timings?",
        answer: "Same-day order cut-offs:\n• 🌅 **Breakfast** — by 7:00 AM\n• ☀️ **Lunch** — by 9:00 AM\n• 🌙 **Dinner** — by 4:30 PM\n\nYou can order for **future dates anytime**. We're closed on **Sundays**. (Cut-offs can shift slightly on special days — the order page always shows the live time.)" },
      { label: "👛 Svaadh Wallet", msg: "What is the Svaadh Wallet and how do refunds work?",
        answer: "Your **Svaadh Wallet** is your prepaid balance with us.\n• Recharge any time and pay in a tap at checkout.\n• Any **refund** (e.g. a cancelled meal) goes back to your wallet **instantly** — no waiting.\n• Cancel before that meal's cut-off from '📋 Manage Orders'.\n\nSee every wallet transaction under '👛 Wallet' on the order page." }
    ];

    function renderChips() {
      quick.innerHTML = "";
      CHIPS.forEach(function (c) {
        var b = document.createElement("button");
        b.className = "sk-chat-chip";
        b.textContent = c.label;
        b.onclick = function () { c.answer ? answerCanned(c.msg, c.answer) : (input.value = c.msg, sendMessage()); };
        quick.appendChild(b);
      });
    }

    // Serve a pre-written answer with NO backend/Gemini call (saves tokens). A brief
    // typing indicator keeps it feeling like a real reply; both turns are saved to
    // history so a typed follow-up still has context.
    function answerCanned(question, answer) {
      if (sending) return;
      append(question, "user");
      if (typeof gtag === "function") { try { gtag("event", "order_chat_canned", { event_category: "OrderChatbot", event_label: question }); } catch (e) {} }
      var typing = showTyping();
      setTimeout(function () { typing.remove(); append(answer, "bot"); }, 320);
    }

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
    }
    // Escape FIRST (no raw HTML from bot/user ever reaches the DOM), THEN render a
    // safe subset of the markdown Gemini emits — links, **bold**, and "* " bullets —
    // so replies read cleanly instead of showing literal asterisks. All transforms run
    // on already-escaped text, so nothing here can inject HTML.
    function render(text) {
      var s = esc(text)
        .replace(
          /(https?:\/\/[^\s<]+|[\w.-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d ]{7,}\d)/gi,
          function (m) { return '<a href="' + (/^https?:/.test(m) ? m : (m.indexOf("@") > -1 ? "mailto:" + m : "tel:" + m.replace(/\s/g, ""))) + '" target="_blank" rel="noopener">' + m + "</a>"; }
        )
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")  // **bold**
        .replace(/(^|\n)[ \t]*\*[ \t]+/g, "$1• ");             // "* " / "*   " bullets → •
      return s;
    }

    function saveMsg(text, sender) {
      try {
        var h = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
        h.push({ text: text, sender: sender });
        if (h.length > 40) h.shift();
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
      } catch (e) {}
    }

    function append(text, sender, save) {
      var d = document.createElement("div");
      d.className = "sk-chat-msg " + (sender === "user" ? "sk-user" : "sk-bot");
      d.innerHTML = render(text);
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
      if (save !== false) saveMsg(text, sender);
      return d;
    }

    function showTyping() {
      var d = document.createElement("div");
      d.className = "sk-chat-msg sk-bot";
      d.innerHTML = '<div class="sk-chat-typing"><span></span><span></span><span></span></div>';
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
      return d;
    }

    // Last 10 stored messages (excl. the one we just pushed) → Gemini history.
    function historyForApi() {
      try {
        var stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
        return stored.slice(-11, -1).map(function (m) {
          return { role: m.sender === "bot" ? "model" : "user", text: m.text };
        });
      } catch (e) { return []; }
    }

    var sending = false;
    async function sendMessage() {
      var text = input.value.trim();
      if (!text || sending) return;
      sending = true;
      append(text, "user");
      input.value = "";
      var typing = showTyping();
      if (typeof gtag === "function") {
        try { gtag("event", "order_chat_message", { event_category: "OrderChatbot", event_label: text }); } catch (e) {}
      }
      try {
        var res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          body: JSON.stringify({ _action: "chat", message: IS_LS ? (LS_CONTEXT + text) : text, history: historyForApi(), page: IS_LS ? "liviano_serio" : "order" })
        });
        var data = await res.json();
        typing.remove();
        append(data && data.reply ? data.reply : "Sorry, I couldn't process that. Please WhatsApp us at " + WA + ".", "bot");
      } catch (e) {
        typing.remove();
        append("I'm having trouble connecting right now. Please try again, or WhatsApp us at " + WA + ".", "bot");
      } finally {
        sending = false;
      }
    }

    function greet() {
      if (IS_LS) {
        append("Hi! 👋 Welcome to Svaadh Kitchen for Ganga Serio! Ask me anything — Lunch & Dinner menu, pricing, free delivery, bulk plans or how to order. 🏢", "bot", false);
        return;
      }
      append("Hi! 👋 I'm the Svaadh Kitchen assistant. Ask me anything about the menu, pricing, delivery, discounts, bulk plans or how to order — no need to dig through the guides.", "bot", false);
    }

    // Restore prior conversation (kept separate from the index-page chat history).
    var prior = [];
    try { prior = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (e) {}
    if (prior.length) prior.forEach(function (m) { append(m.text, m.sender, false); });
    else greet();
    renderChips();

    // ── Invite bubble ("Have a doubt? Chat with us") ──────────────────────────
    // The widget ALWAYS starts closed (only the FAB shows). To make sure customers
    // realise they can ask questions, a small bubble nudges them until they've opened
    // the chat at least once (then it never shows again). While the bubble OR the panel
    // is visible we hide the order page's centered "Tip" pill (#tipPill/#tipBanner,
    // z-index 9800) via a class on <html> so the two never overlap on narrow screens.
    var invite = document.getElementById("skChatInvite");
    var OPENED_KEY = "svaadhOrderChatOpened";
    var root = document.documentElement;

    function hideInvite() {
      invite.classList.remove("sk-show");
      root.classList.remove("sk-chat-hint");
    }
    function showInvite() {
      var opened = false;
      try { opened = localStorage.getItem(OPENED_KEY) === "1"; } catch (e) {}
      if (opened || panel.classList.contains("sk-open")) return;
      invite.classList.add("sk-show");
      root.classList.add("sk-chat-hint");
      // Auto-tidy after a while; it re-appears next visit until the chat is opened once.
      setTimeout(hideInvite, 14000);
    }
    function openPanel() {
      panel.classList.add("sk-open");
      root.classList.add("sk-chat-open"); // hides the order-page Tip pill (CSS)
      hideInvite();
      try { localStorage.setItem(OPENED_KEY, "1"); } catch (e) {}
      setTimeout(function () { input.focus(); }, 50);
    }
    function closePanel() {
      panel.classList.remove("sk-open");
      root.classList.remove("sk-chat-open");
    }

    fab.addEventListener("click", function () {
      if (panel.classList.contains("sk-open")) closePanel(); else openPanel();
    });
    invite.addEventListener("click", function (e) {
      if (e.target && e.target.id === "skChatInviteX") return; // handled below
      openPanel();
    });
    invite.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(); }
    });
    document.getElementById("skChatInviteX").addEventListener("click", function (e) {
      e.stopPropagation();
      hideInvite();
      try { localStorage.setItem(OPENED_KEY, "1"); } catch (er) {} // dismiss = don't nag again
    });
    document.getElementById("skChatClose").addEventListener("click", closePanel);
    document.getElementById("skChatNew").addEventListener("click", function () {
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
      body.innerHTML = "";
      greet();
    });
    send.addEventListener("click", sendMessage);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // Nudge shortly after load (not instantly — let the page settle first).
    setTimeout(showInvite, 2500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
