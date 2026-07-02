document.addEventListener("DOMContentLoaded", () => {
  // All chat and order API calls go through the same Apps Script endpoint
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W/exec";
  const ORDER_URL       = "https://www.svaadhkitchen.in/order.html";

  const widget = document.getElementById("chat-widget");
  widget.innerHTML = `
    <button id="chat-toggle" class="chat-button">💬</button>
    <div class="chat-box" id="chat-box">
      <div class="chat-header">
        <span>Svaadh Kitchen 🧡</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="new-chat-btn" class="new-chat-btn" title="Start New Chat">🔄</button>
          <button id="chat-close-btn" title="Close" style="background:rgba(255,255,255,0.2);border:none;color:#fff;font-size:1.1rem;line-height:1;width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="quick-replies" id="quick-replies"></div>
      <div class="chat-input">
        <textarea id="user-input" placeholder="Type your message..."></textarea>
        <button id="send-btn">Send</button>
      </div>
    </div>
  `;

  const toggle      = document.getElementById("chat-toggle");
  const chatBox     = document.getElementById("chat-box");
  const sendBtn     = document.getElementById("send-btn");
  const userInput   = document.getElementById("user-input");
  const messages    = document.getElementById("chat-messages");
  const quickReplies = document.getElementById("quick-replies");
  const newChatBtn  = document.getElementById("new-chat-btn");
  const closeBtn    = document.getElementById("chat-close-btn");

  // Start minimized — user clicks 💬 to open
  chatBox.style.display = "none";

  toggle.addEventListener("click", () => {
    chatBox.style.display = chatBox.style.display === "none" ? "flex" : "none";
  });

  closeBtn.addEventListener("click", () => {
    chatBox.style.display = "none";
  });

  newChatBtn.addEventListener("click", () => {
    localStorage.removeItem("svaadhChatHistory");
    messages.innerHTML = "";
    setTimeout(() => {
      appendMessage("Hello! 👋 Welcome to Svaadh Kitchen! How can I help you today?", "bot");
      showQuickReplies();
    }, 500);
  });

  function showQuickReplies() {
    const buttons = [
      { text: "🍛 Today's Menu",    message: "What's today's menu?" },
      { text: "⏰ Order Timings",   message: "What are your order timings?" },
      { text: "📍 Delivery Areas",  message: "Which areas do you deliver to?" },
      { text: "📞 Place Order",     isOrder: true }
    ];
    quickReplies.innerHTML = "";
    buttons.forEach(b => {
      const btn = document.createElement("button");
      btn.className = "quick-reply-btn";
      btn.textContent = b.text;
      btn.onclick = () => {
        if (b.isOrder) {
          window.open(ORDER_URL, "_blank");
          appendMessage("Opening order form…", "bot");
        } else {
          userInput.value = b.message;
          sendMessage();
        }
      };
      quickReplies.appendChild(btn);
    });
  }

  function showFullMenu() {
    const menuHTML = `
      <div class="menu-display">
        <h4>🍛 Make Your Own Meal — Menu & Prices</h4>
        <div class="menu-category">
          <strong>Breads (per piece):</strong>
          <div class="menu-item">• Chapati — ₹9</div>
          <div class="menu-item">• Without Oil Chapati — ₹8</div>
          <div class="menu-item">• Phulka — ₹7</div>
          <div class="menu-item">• Ghee Phulka — ₹10</div>
          <div class="menu-item">• Jowar / Bajra Bhakri — ₹20</div>
        </div>
        <div class="menu-category">
          <strong>Sabji (today's changes daily):</strong>
          <div class="menu-item">• Dry Sabji Mini (100ml) — ₹22</div>
          <div class="menu-item">• Dry Sabji Full (250ml) — ₹45</div>
          <div class="menu-item">• Curry Sabji Mini (100ml) — ₹22</div>
          <div class="menu-item">• Curry Sabji Full (250ml) — ₹45</div>
        </div>
        <div class="menu-category">
          <strong>Basics:</strong>
          <div class="menu-item">• Dal (200ml) — ₹22</div>
          <div class="menu-item">• Rice (100g) — ₹12</div>
          <div class="menu-item">• Salad (40g) — ₹6</div>
          <div class="menu-item">• Curd (50g) — ₹12</div>
        </div>
        <div class="menu-category">
          <strong>Breakfast (rotating daily):</strong>
          <div class="menu-item">• Kanda Poha, Aloo Paratha, Paneer Paratha + Curd</div>
          <div class="menu-item">• Prices vary — check the order form!</div>
        </div>
        <div class="menu-note">
          💡 <em>Mix and match to build your perfect meal!</em><br>
          🎉 5% off ≥ ₹325/day &nbsp;|&nbsp; 7.5% off ≥ ₹485/day &nbsp;|&nbsp; 10% off ≥ ₹750/day
        </div>
      </div>
    `;
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = menuHTML;
    appendMessage(tempDiv.innerHTML, "bot");
  }

  // ── HISTORY HELPERS ────────────────────────────────────────
  function saveMessage(text, sender) {
    try {
      const history = JSON.parse(localStorage.getItem("svaadhChatHistory") || "[]");
      history.push({ text, sender, timestamp: new Date().toISOString() });
      if (history.length > 50) history.shift();
      localStorage.setItem("svaadhChatHistory", JSON.stringify(history));
    } catch(e) {}
  }

  function loadChatHistory() {
    try {
      const history = JSON.parse(localStorage.getItem("svaadhChatHistory") || "[]");
      history.forEach(msg => appendMessage(msg.text, msg.sender, false)); // false = don't resave!
    } catch(e) {}
  }

  // Build Gemini-format history from the last N stored messages
  function buildGeminiHistory() {
    try {
      const stored = JSON.parse(localStorage.getItem("svaadhChatHistory") || "[]");
      // Take up to last 20 messages (10 turns), exclude the one we're about to send
      return stored.slice(-21, -1)
        .filter(m => m.sender === "user" || m.sender === "bot")
        .map(m => ({ role: m.sender === "bot" ? "model" : "user", text: m.text }));
    } catch(e) { return []; }
  }

  // ── RENDER ─────────────────────────────────────────────────
  function appendMessage(text, sender, save = true) {
    const div = document.createElement("div");
    div.classList.add("message", sender);
    div.innerHTML = text.replace(
      /(https?:\/\/[^\s]+|[\w.-]+@[\w.-]+|\+?\d{7,})/g,
      '<a href="$1" target="_blank" style="color:#f47c3c;text-decoration:none;">$1</a>'
    );
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    if (save && !sender.includes("loading")) saveMessage(text, sender);
  }

  function showLoading() {
    const div = document.createElement("div");
    div.classList.add("message", "bot", "loading");
    div.innerHTML = '<div class="typing-indicator"><span>Svaadh Kitchen is typing</span><div class="typing-dots"><span></span><span></span><span></span></div></div>';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  // ── SEND MESSAGE ────────────────────────────────────────────
  async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    appendMessage(text, "user");
    userInput.value = "";
    const loadingDiv = showLoading();

    if (typeof gtag === "function") {
      gtag("event", "chat_message", { event_category: "Chatbot", event_label: text, value: 1 });
    }

    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
          _action: "chat",
          message: text,
          history: buildGeminiHistory()
        })
      });

      const data = await res.json();
      loadingDiv.remove();
      const reply = data.reply || "Sorry, I couldn't process your request.";
      appendMessage(reply, "bot");

      if (typeof gtag === "function") {
        gtag("event", "chatbot_reply", { event_category: "Chatbot", event_label: reply, value: 1 });
      }
    } catch (error) {
      console.error("Chat error:", error);
      loadingDiv.remove();
      appendMessage("Sorry, I'm having trouble connecting right now. Please try again in a moment or WhatsApp us at +91 99307 48908.", "bot");
    }
  }

  // ── INIT ───────────────────────────────────────────────────
  loadChatHistory();
  let existing = [];
  try {
    existing = JSON.parse(localStorage.getItem("svaadhChatHistory") || "[]");
  } catch(e) {}
  
  // Only add welcome if history is empty AND no messages already rendered
  if (existing.length === 0 && messages.children.length === 0) {
    setTimeout(() => {
      appendMessage("Hello! 👋 Welcome to Svaadh Kitchen! How can I help you today?", "bot");
      showQuickReplies();
    }, 500);
  } else {
    showQuickReplies();
  }

  sendBtn.addEventListener("click", sendMessage);
  userInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  function toggleFAQ(button) {
    const answer = button.nextElementSibling;
    const isOpen = answer.style.display === "block";
    if (isOpen) {
      answer.style.display = "none";
      answer.style.maxHeight = "0";
      answer.style.padding = "0 20px";
      button.querySelector("span:last-child").textContent = "+";
    } else {
      answer.style.display = "block";
      answer.style.maxHeight = "500px";
      answer.style.padding = "20px";
      button.querySelector("span:last-child").textContent = "-";
    }
  }
  window.toggleFAQ = toggleFAQ;
});
