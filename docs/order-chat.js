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

  function init() {
    var widget = document.getElementById("sk-chat-widget");
    if (!widget || widget.dataset.mounted === "1") return;
    widget.dataset.mounted = "1";

    widget.innerHTML =
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
    var CHIPS = [
      { label: "💰 How pricing works",      msg: "How does your pricing work — how do I build a meal and what does it cost?" },
      { label: "🚚 Delivery & charges",     msg: "What are your delivery charges and when is delivery free?" },
      { label: "🎁 Discounts & loyalty",    msg: "How do the discounts and the loyalty programme work?" },
      { label: "⚡ Bulk meal plans",        msg: "Tell me about your weekly, 15-day and monthly bulk meal plans." },
      { label: "⏰ Order timings",          msg: "What are your order cut-off timings?" },
      { label: "👛 Svaadh Wallet",          msg: "What is the Svaadh Wallet and how do refunds work?" }
    ];

    function renderChips() {
      quick.innerHTML = "";
      CHIPS.forEach(function (c) {
        var b = document.createElement("button");
        b.className = "sk-chat-chip";
        b.textContent = c.label;
        b.onclick = function () { input.value = c.msg; sendMessage(); };
        quick.appendChild(b);
      });
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
          body: JSON.stringify({ _action: "chat", message: text, history: historyForApi(), page: "order" })
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
      append("Hi! 👋 I'm the Svaadh Kitchen assistant. Ask me anything about the menu, pricing, delivery, discounts, bulk plans or how to order — no need to dig through the guides.", "bot", false);
    }

    // Restore prior conversation (kept separate from the index-page chat history).
    var prior = [];
    try { prior = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (e) {}
    if (prior.length) prior.forEach(function (m) { append(m.text, m.sender, false); });
    else greet();
    renderChips();

    fab.addEventListener("click", function () {
      panel.classList.toggle("sk-open");
      if (panel.classList.contains("sk-open")) setTimeout(function () { input.focus(); }, 50);
    });
    document.getElementById("skChatClose").addEventListener("click", function () { panel.classList.remove("sk-open"); });
    document.getElementById("skChatNew").addEventListener("click", function () {
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
      body.innerHTML = "";
      greet();
    });
    send.addEventListener("click", sendMessage);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
