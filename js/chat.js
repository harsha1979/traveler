/**
 * Floating chat agent widget.
 * For now this only handles UI (open/close, rendering messages).
 * When the user sends a message we just echo an acknowledgement -
 * wire this up to a real agent/backend later (see TODO below).
 */
(function () {
  function init() {
    const launcher = document.getElementById("chat-launcher");
    const panel = document.getElementById("chat-panel");
    const closeBtn = document.getElementById("chat-close");
    const form = document.getElementById("chat-form");
    const input = document.getElementById("chat-input");
    const messages = document.getElementById("chat-messages");

    if (!launcher || !panel || !form || !input || !messages) return;

    function openChat() {
      panel.classList.add("open");
      launcher.classList.add("hidden");
      input.focus();
    }

    function closeChat() {
      panel.classList.remove("open");
      launcher.classList.remove("hidden");
    }

    function addMessage(text, sender) {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${sender}`;
      bubble.textContent = text;
      messages.appendChild(bubble);
      messages.scrollTop = messages.scrollHeight;
    }

    launcher.addEventListener("click", openChat);
    closeBtn.addEventListener("click", closeChat);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      addMessage(text, "user");
      input.value = "";

      // TODO: send `text` to the travel-booking agent/backend and
      // render its real reply here. For now we just acknowledge
      // receipt so the flow is visible end-to-end.
      setTimeout(() => {
        addMessage("Got it! I'll help you with that shortly. (Agent logic coming soon.)", "agent");
      }, 400);
    });

    // Greet once when chat is opened the very first time.
    let greeted = false;
    launcher.addEventListener("click", function () {
      if (!greeted) {
        addMessage("Hi! How can I help you plan your trip today?", "agent");
        greeted = true;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
