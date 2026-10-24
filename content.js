/**
 * AI Chat Privacy Lock - Content Script
 * Injected into ChatGPT, Claude, and Gemini pages.
 * Handles chat identification, SPA route changes, DOM obscuring, and PIN verification.
 */

(() => {
  let currentOverlay = null;
  let activeChatId = null;
  let activeChatIdIsLocked = false;
  let isSessionUnlocked = false;

  // Utility: SHA-256 Hashing with Salt using Web Crypto API
  async function hashPin(pin, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Extract unique conversation ID based on current platform URL
  function extractChatId(url = window.location.href) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const path = parsed.pathname;

      // ChatGPT: https://chatgpt.com/c/<uuid> or /g/<model>/c/<uuid>
      if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
        const match = path.match(/\/c\/([a-zA-Z0-9-]+)/);
        return match ? `chatgpt_${match[1]}` : null;
      }

      // Claude: https://claude.ai/chat/<uuid>
      if (host.includes("claude.ai")) {
        const match = path.match(/\/chat\/([a-zA-Z0-9-]+)/);
        return match ? `claude_${match[1]}` : null;
      }

      // Gemini: https://gemini.google.com/app/<id> or /u/0/app/<id>
      if (host.includes("gemini.google.com")) {
        const match = path.match(/\/app\/([a-zA-Z0-9_-]+)/);
        return match ? `gemini_${match[1]}` : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  // Target main chat container to blur/hide content behind modal
  function getChatContainer() {
    return (
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.querySelector("#chat-history") ||
      document.body
    );
  }

  // Obscure chat and display PIN prompt modal
  async function showLockOverlay(chatId) {
    if (currentOverlay) return; // Already showing

    const container = getChatContainer();
    if (container && container !== document.body) {
      container.classList.add("ai-chat-obscured");
    }

    const overlay = document.createElement("div");
    overlay.className = "ai-chat-lock-overlay";
    overlay.id = "ai-chat-privacy-lock-screen";

    overlay.innerHTML = `
      <div class="ai-chat-lock-modal" id="ai-chat-modal-box">
        <div class="ai-chat-lock-icon">🔒</div>
        <h2 class="ai-chat-lock-title">Protected Conversation</h2>
        <p class="ai-chat-lock-desc">This conversation has been privacy-locked. Enter your security PIN to view.</p>
        <div class="ai-chat-lock-input-group">
          <input type="password" id="ai-chat-pin-input" class="ai-chat-lock-input" placeholder="••••" maxlength="8" autofocus />
          <button id="ai-chat-unlock-btn" class="ai-chat-lock-btn">Unlock</button>
        </div>
        <div id="ai-chat-error-msg" class="ai-chat-lock-error"></div>
      </div>
    `;

    document.documentElement.appendChild(overlay);
    currentOverlay = overlay;
    activeChatIdIsLocked = true;
    isSessionUnlocked = false;

    const input = overlay.querySelector("#ai-chat-pin-input");
    const unlockBtn = overlay.querySelector("#ai-chat-unlock-btn");
    const errorMsg = overlay.querySelector("#ai-chat-error-msg");
    const modalBox = overlay.querySelector("#ai-chat-modal-box");

    setTimeout(() => input?.focus(), 100);

    async function attemptUnlock() {
      const enteredPin = input.value.trim();
      if (!enteredPin) {
        errorMsg.textContent = "Please enter your PIN.";
        return;
      }

      const storage = await chrome.storage.local.get(["pinHash", "salt"]);
      if (!storage.pinHash || !storage.salt) {
        errorMsg.textContent = "No master PIN set. Click the extension icon to set a PIN.";
        return;
      }

      const computedHash = await hashPin(enteredPin, storage.salt);
      if (computedHash === storage.pinHash) {
        // Correct PIN!
        isSessionUnlocked = true;
        activeChatIdIsLocked = false;
        await chrome.runtime.sendMessage({ type: "SET_SESSION_UNLOCK", chatId });
        removeLockOverlay();
      } else {
        // Incorrect PIN
        errorMsg.textContent = "Incorrect PIN. Try again.";
        input.value = "";
        modalBox.classList.remove("ai-chat-lock-shake");
        void modalBox.offsetWidth; // Trigger reflow for animation restart
        modalBox.classList.add("ai-chat-lock-shake");
        input.focus();
      }
    }

    unlockBtn.addEventListener("click", attemptUnlock);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") attemptUnlock();
    });
  }

  function removeLockOverlay() {
    if (currentOverlay) {
      currentOverlay.remove();
      currentOverlay = null;
    }
    const container = getChatContainer();
    if (container) {
      container.classList.remove("ai-chat-obscured");
    }
  }

  // Defender: MutationObserver to defend against DevTools DOM deletion
  const defender = new MutationObserver(() => {
    const overlayExists = document.getElementById("ai-chat-privacy-lock-screen");
    if (activeChatIdIsLocked && !overlayExists && !isSessionUnlocked) {
      const container = getChatContainer();
      if (container && container.innerHTML !== "") {
        container.innerHTML = ""; // Wipe DOM if tampered with
      }
    }
  });
  defender.observe(document.documentElement, { childList: true, subtree: true });

  // Core evaluation logic: checks if current URL needs to be locked
  async function evaluateCurrentChat() {
    const chatId = extractChatId();
    activeChatId = chatId;

    if (!chatId) {
      // User is on homepage / new chat without saved ID
      activeChatIdIsLocked = false;
      isSessionUnlocked = false;
      removeLockOverlay();
      return;
    }

    const { lockedChats = [] } = await chrome.storage.local.get("lockedChats");
    const isLocked = lockedChats.includes(chatId);

    if (!isLocked) {
      activeChatIdIsLocked = false;
      isSessionUnlocked = false;
      removeLockOverlay();
      return;
    }

    // Check if unlocked in current active browser session
    chrome.runtime.sendMessage({ type: "CHECK_SESSION_UNLOCK", chatId }, (response) => {
      if (response && response.isUnlocked) {
        isSessionUnlocked = true;
        activeChatIdIsLocked = false;
        removeLockOverlay();
      } else {
        isSessionUnlocked = false;
        showLockOverlay(chatId);
      }
    });
  }

  // Hook into Single Page Application (SPA) navigation
  // Modern web apps use pushState & replaceState without reloading the page
  const patchHistory = (type) => {
    const orig = history[type];
    return function (...args) {
      const result = orig.apply(this, args);
      window.dispatchEvent(new Event("locationchange"));
      return result;
    };
  };

  history.pushState = patchHistory("pushState");
  history.replaceState = patchHistory("replaceState");

  window.addEventListener("popstate", () => window.dispatchEvent(new Event("locationchange")));
  window.addEventListener("locationchange", () => evaluateCurrentChat());

  // Listen for background tab updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "URL_CHANGED") {
      evaluateCurrentChat();
    }
    if (message.type === "GET_CURRENT_CHAT") {
      return Promise.resolve({ chatId: extractChatId() });
    }
  });

  // React to storage changes immediately (e.g. if user locks from the popup)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.lockedChats) {
      evaluateCurrentChat();
    }
  });

  // Periodic safety check for dynamic DOM re-renders in React / Angular
  setInterval(() => {
    const newChatId = extractChatId();
    if (newChatId !== activeChatId) {
      evaluateCurrentChat();
    }
  }, 1000);

  // Initial execution
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", evaluateCurrentChat);
  } else {
    evaluateCurrentChat();
  }
})();
