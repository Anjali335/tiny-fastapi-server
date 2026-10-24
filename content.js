/**
 * AI Chat Privacy Lock - Content Script
 * Injected into ChatGPT, Claude, and Gemini pages.
 * Handles instant chat identification, human-readable titles,
 * leave/back navigation, instant re-lock on chat switch, and brute-force lockout.
 */

(() => {
  let currentOverlay = null;
  let activeChatId = null;
  let activeChatIdIsLocked = false;
  let isSessionUnlocked = false;
  let lockoutInterval = null;

  // Track the currently unlocked chat strictly while the user stays on it
  let currentViewingUnlockedChatId = null;

  // In-memory cache for zero-delay synchronous checks
  const lockedChatsCache = new Set();
  const lockedChatTitlesCache = {};

  // Extract human-readable chat title from sidebar or document title
  function extractChatTitle(targetChatId = extractChatId()) {
    try {
      if (!targetChatId) return null;
      const rawId = targetChatId.replace(/^(gemini|chatgpt|claude)_/, "");

      // 1. Check sidebar anchor link or conversation element
      const link = document.querySelector(`a[href*="${rawId}"], [data-chat-id*="${rawId}"]`);
      if (link) {
        const text = link.innerText || link.textContent;
        const clean = text ? text.replace("🔒", "").trim().split("\n")[0] : null;
        if (clean && clean.length > 1) return clean;
      }

      // 2. Check main page heading or document.title
      if (document.title) {
        const clean = document.title
          .replace(/ - (Gemini|ChatGPT|Claude)$/i, "")
          .replace(/Gemini - /i, "")
          .replace(/ChatGPT - /i, "")
          .trim();
        if (clean && !["Gemini", "ChatGPT", "Claude", "New chat"].includes(clean)) {
          return clean;
        }
      }
    } catch {}
    return null;
  }

  // Sync initial lockedChats cache from storage
  chrome.storage.local.get(["lockedChats", "lockedChatTitles"]).then((data) => {
    lockedChatsCache.clear();
    (data.lockedChats || []).forEach((id) => lockedChatsCache.add(id));
    if (data.lockedChatTitles) {
      Object.assign(lockedChatTitlesCache, data.lockedChatTitles);
    }
    updateSidebarBadges();
    evaluateCurrentChat();
  });

  // Keep cache synchronized in real-time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.lockedChats) {
        lockedChatsCache.clear();
        (changes.lockedChats.newValue || []).forEach((id) => lockedChatsCache.add(id));
      }
      if (changes.lockedChatTitles) {
        Object.assign(lockedChatTitlesCache, changes.lockedChatTitles.newValue || {});
      }
      updateSidebarBadges();
      evaluateCurrentChat();
    }
  });

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
      document.querySelector("chat-window") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.querySelector(".conversation-container") ||
      document.querySelector("#chat-history") ||
      document.body
    );
  }

  // Synchronous pre-obscure: Immediately blurs content before async storage reads finish
  function preObscureIfLocked() {
    const chatId = extractChatId();
    if (chatId && lockedChatsCache.has(chatId) && currentViewingUnlockedChatId !== chatId) {
      const container = getChatContainer();
      if (container && container !== document.body) {
        container.classList.add("ai-chat-obscured");
      }
    }
  }

  // Obscure chat and display PIN prompt modal with Back button and friendly title
  async function showLockOverlay(chatId) {
    if (currentOverlay && document.getElementById("ai-chat-privacy-lock-screen")) {
      return; // Already displaying
    }
    if (currentOverlay) {
      currentOverlay.remove();
      currentOverlay = null;
    }

    const container = getChatContainer();
    if (container && container !== document.body) {
      container.classList.add("ai-chat-obscured");
    }

    // Try finding the friendly title
    const friendlyTitle =
      lockedChatTitlesCache[chatId] ||
      extractChatTitle(chatId) ||
      "Confidential Conversation";

    const overlay = document.createElement("div");
    overlay.className = "ai-chat-lock-overlay";
    overlay.id = "ai-chat-privacy-lock-screen";

    overlay.innerHTML = `
      <div class="ai-chat-lock-modal" id="ai-chat-modal-box">
        <div class="ai-chat-lock-icon">🔒</div>
        <h2 class="ai-chat-lock-title">Protected Conversation</h2>
        <div class="ai-chat-lock-subtitle">${friendlyTitle}</div>
        <p class="ai-chat-lock-desc">This conversation has been privacy-locked. Enter your security PIN to view.</p>
        <div class="ai-chat-lock-input-group">
          <input type="password" id="ai-chat-pin-input" class="ai-chat-lock-input" placeholder="••••" maxlength="8" autofocus />
          <button id="ai-chat-unlock-btn" class="ai-chat-lock-btn">Unlock</button>
        </div>
        <div id="ai-chat-error-msg" class="ai-chat-lock-error"></div>
        <div style="margin-top: 18px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 14px;">
          <button id="ai-chat-back-btn" class="ai-chat-lock-btn-secondary">← Back to New / Unlocked Chat</button>
        </div>
      </div>
    `;

    const target = document.body || document.documentElement;
    target.appendChild(overlay);
    currentOverlay = overlay;
    activeChatIdIsLocked = true;
    isSessionUnlocked = false;

    const input = overlay.querySelector("#ai-chat-pin-input");
    const unlockBtn = overlay.querySelector("#ai-chat-unlock-btn");
    const backBtn = overlay.querySelector("#ai-chat-back-btn");
    const errorMsg = overlay.querySelector("#ai-chat-error-msg");
    const modalBox = overlay.querySelector("#ai-chat-modal-box");

    // Handle "Leave / Back to Unlocked Chat" button
    backBtn.addEventListener("click", () => {
      removeLockOverlay();
      const host = window.location.hostname;
      if (host.includes("gemini.google.com")) {
        window.location.href = "https://gemini.google.com/app";
      } else if (host.includes("claude.ai")) {
        window.location.href = "https://claude.ai/new";
      } else {
        window.location.href = "https://chatgpt.com/";
      }
    });

    function startLockoutCountdown(lockoutUntil) {
      input.disabled = true;
      unlockBtn.disabled = true;
      clearInterval(lockoutInterval);

      const updateTimer = () => {
        const remainingSec = Math.ceil((lockoutUntil - Date.now()) / 1000);
        if (remainingSec <= 0) {
          clearInterval(lockoutInterval);
          input.disabled = false;
          unlockBtn.disabled = false;
          errorMsg.textContent = "";
          chrome.storage.local.set({ failedPinAttempts: 0, pinLockoutUntil: 0 });
          input.focus();
        } else {
          errorMsg.textContent = `Too many incorrect attempts. Locked out for ${remainingSec}s.`;
        }
      };

      updateTimer();
      lockoutInterval = setInterval(updateTimer, 500);
    }

    const { pinLockoutUntil = 0 } = await chrome.storage.local.get("pinLockoutUntil");
    if (Date.now() < pinLockoutUntil) {
      startLockoutCountdown(pinLockoutUntil);
    } else {
      setTimeout(() => input?.focus(), 100);
    }

    async function attemptUnlock() {
      const enteredPin = input.value.trim();
      if (!enteredPin) {
        errorMsg.textContent = "Please enter your PIN.";
        return;
      }

      const storage = await chrome.storage.local.get([
        "pinHash",
        "salt",
        "failedPinAttempts",
        "pinLockoutUntil",
      ]);

      const currentLockout = storage.pinLockoutUntil || 0;
      if (Date.now() < currentLockout) {
        startLockoutCountdown(currentLockout);
        return;
      }

      if (!storage.pinHash || !storage.salt) {
        errorMsg.textContent = "No master PIN set. Click the extension icon to set a PIN.";
        return;
      }

      const computedHash = await hashPin(enteredPin, storage.salt);
      if (computedHash === storage.pinHash) {
        clearInterval(lockoutInterval);
        await chrome.storage.local.set({ failedPinAttempts: 0, pinLockoutUntil: 0 });

        isSessionUnlocked = true;
        activeChatIdIsLocked = false;
        // Mark strictly active for this current view
        currentViewingUnlockedChatId = chatId;

        removeLockOverlay();
      } else {
        const currentFailed = (storage.failedPinAttempts || 0) + 1;
        input.value = "";
        modalBox.classList.remove("ai-chat-lock-shake");
        void modalBox.offsetWidth;
        modalBox.classList.add("ai-chat-lock-shake");

        if (currentFailed >= 5) {
          const newLockoutUntil = Date.now() + 30000;
          await chrome.storage.local.set({ failedPinAttempts: 0, pinLockoutUntil: newLockoutUntil });
          startLockoutCountdown(newLockoutUntil);
        } else {
          await chrome.storage.local.set({ failedPinAttempts: currentFailed });
          const remaining = 5 - currentFailed;
          errorMsg.textContent = `Incorrect PIN. (${remaining} attempt${remaining > 1 ? "s" : ""} remaining before 30s lockout)`;
          input.focus();
        }
      }
    }

    unlockBtn.addEventListener("click", attemptUnlock);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") attemptUnlock();
    });
  }

  function removeLockOverlay() {
    clearInterval(lockoutInterval);
    if (currentOverlay) {
      currentOverlay.remove();
      currentOverlay = null;
    }
    const container = getChatContainer();
    if (container) {
      container.classList.remove("ai-chat-obscured");
    }
  }

  // Sidebar Badges: Place a lock icon next to locked conversations in the sidebar
  function updateSidebarBadges() {
    lockedChatsCache.forEach((lockedKey) => {
      const rawId = lockedKey.replace(/^(gemini|chatgpt|claude)_/, "");
      const links = document.querySelectorAll(`a[href*="${rawId}"], [data-chat-id*="${rawId}"]`);
      links.forEach((link) => {
        if (!link.querySelector(".ai-lock-sidebar-badge")) {
          const badge = document.createElement("span");
          badge.className = "ai-lock-sidebar-badge";
          badge.textContent = " 🔒";
          badge.title = "Privacy-Locked Chat";
          badge.style.cssText = "margin-left: 6px; font-size: 13px; vertical-align: middle; display: inline-block;";
          link.appendChild(badge);

          // Update friendly title cache if we find it
          const text = link.innerText || link.textContent;
          if (text) {
            const cleanTitle = text.replace("🔒", "").trim().split("\n")[0];
            if (cleanTitle && cleanTitle.length > 1 && !lockedChatTitlesCache[lockedKey]) {
              lockedChatTitlesCache[lockedKey] = cleanTitle;
              chrome.storage.local.get("lockedChatTitles").then(({ lockedChatTitles = {} }) => {
                lockedChatTitles[lockedKey] = cleanTitle;
                chrome.storage.local.set({ lockedChatTitles });
              });
            }
          }
        }
      });
    });

    // Clean up badges if chat was unlocked
    document.querySelectorAll(".ai-lock-sidebar-badge").forEach((badge) => {
      const parent = badge.closest("a") || badge.parentElement;
      if (parent) {
        const href = parent.getAttribute("href") || "";
        let isStillLocked = false;
        lockedChatsCache.forEach((lockedKey) => {
          const rawId = lockedKey.replace(/^(gemini|chatgpt|claude)_/, "");
          if (href.includes(rawId)) isStillLocked = true;
        });
        if (!isStillLocked) badge.remove();
      }
    });
  }

  // Defender: MutationObserver to defend against DevTools DOM deletion
  const defender = new MutationObserver(() => {
    const overlayExists = document.getElementById("ai-chat-privacy-lock-screen");
    if (activeChatIdIsLocked && !overlayExists && !isSessionUnlocked) {
      const container = getChatContainer();
      if (container && container.innerHTML !== "") {
        container.innerHTML = ""; // Wipe DOM immediately if tampered with
      }
    }
  });
  defender.observe(document.documentElement, { childList: true, subtree: true });

  // Core evaluation logic: checks if current URL needs to be locked
  async function evaluateCurrentChat() {
    const chatId = extractChatId();

    // FEATURE 3: Auto re-lock when switching chats!
    // If the user navigates to a different chat, any prior unlock is revoked immediately
    if (chatId !== currentViewingUnlockedChatId) {
      currentViewingUnlockedChatId = null;
    }

    activeChatId = chatId;

    if (!chatId) {
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

    // If strictly unlocked during this active view, allow reading
    if (currentViewingUnlockedChatId === chatId) {
      isSessionUnlocked = true;
      activeChatIdIsLocked = false;
      removeLockOverlay();
      return;
    }

    // Chat is locked and user moved to it: display lock screen immediately
    isSessionUnlocked = false;
    showLockOverlay(chatId);
  }

  // Hook into SPA navigation
  const patchHistory = (type) => {
    const orig = history[type];
    return function (...args) {
      const result = orig.apply(this, args);
      preObscureIfLocked();
      window.dispatchEvent(new Event("locationchange"));
      return result;
    };
  };

  history.pushState = patchHistory("pushState");
  history.replaceState = patchHistory("replaceState");

  window.addEventListener("popstate", () => {
    preObscureIfLocked();
    window.dispatchEvent(new Event("locationchange"));
  });
  window.addEventListener("locationchange", () => {
    preObscureIfLocked();
    evaluateCurrentChat();
  });

  // Listen for direct messages from background and popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "URL_CHANGED") {
      preObscureIfLocked();
      evaluateCurrentChat();
      updateSidebarBadges();
    }
    if (message.type === "LOCK_IMMEDIATELY") {
      currentViewingUnlockedChatId = null;
      const currentId = extractChatId();
      if (currentId === message.chatId) {
        isSessionUnlocked = false;
        activeChatIdIsLocked = true;
        showLockOverlay(message.chatId);
      }
      updateSidebarBadges();
    }
    if (message.type === "UNLOCK_IMMEDIATELY") {
      currentViewingUnlockedChatId = null;
      isSessionUnlocked = false;
      activeChatIdIsLocked = false;
      removeLockOverlay();
      updateSidebarBadges();
    }
    if (message.type === "GET_CHAT_TITLE") {
      sendResponse({ title: extractChatTitle(message.chatId) });
      return true;
    }
  });

  // Target Node MutationObserver on the main DOM container
  let lastObservedUrl = window.location.href;
  let lastObservedChatId = extractChatId();

  const routeObserver = new MutationObserver(() => {
    const currentUrl = window.location.href;
    const currentChatId = extractChatId(currentUrl);

    if (currentUrl !== lastObservedUrl || currentChatId !== lastObservedChatId) {
      lastObservedUrl = currentUrl;
      lastObservedChatId = currentChatId;
      preObscureIfLocked();
      evaluateCurrentChat();
    }
    updateSidebarBadges();
  });

  routeObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false,
  });

  // Initial execution
  preObscureIfLocked();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      evaluateCurrentChat();
      updateSidebarBadges();
    });
  } else {
    evaluateCurrentChat();
    updateSidebarBadges();
  }
})();
