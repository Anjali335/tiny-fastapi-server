/**
 * AI Chat Privacy Lock - Popup Script
 * Handles PIN setup, active chat detection, and lock management.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Elements
  const pinSetupForm = document.getElementById("pin-setup-form");
  const pinConfiguredView = document.getElementById("pin-configured-view");
  const newPinInput = document.getElementById("new-pin");
  const confirmPinInput = document.getElementById("confirm-pin");
  const savePinBtn = document.getElementById("save-pin-btn");
  const changePinToggleBtn = document.getElementById("change-pin-toggle-btn");
  const pinMsg = document.getElementById("pin-msg");

  const currentChatStatus = document.getElementById("current-chat-status");
  const currentChatIdEl = document.getElementById("current-chat-id");
  const toggleLockBtn = document.getElementById("toggle-lock-btn");
  const actionMsg = document.getElementById("action-msg");

  const lockedCountEl = document.getElementById("locked-count");
  const lockedListEl = document.getElementById("locked-list");

  let currentChatId = null;

  // Crypto helpers
  function generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashPin(pin, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // 1. PIN Management
  async function refreshPinState() {
    const { pinHash } = await chrome.storage.local.get("pinHash");
    if (pinHash) {
      pinSetupForm.style.display = "none";
      pinConfiguredView.style.display = "block";
    } else {
      pinSetupForm.style.display = "block";
      pinConfiguredView.style.display = "none";
    }
  }

  savePinBtn.addEventListener("click", async () => {
    const pin = newPinInput.value.trim();
    const confirm = confirmPinInput.value.trim();

    if (pin.length < 4) {
      showMsg(pinMsg, "PIN must be at least 4 digits", true);
      return;
    }
    if (pin !== confirm) {
      showMsg(pinMsg, "PINs do not match", true);
      return;
    }

    const salt = generateSalt();
    const hash = await hashPin(pin, salt);

    await chrome.storage.local.set({ pinHash: hash, salt });
    newPinInput.value = "";
    confirmPinInput.value = "";
    showMsg(pinMsg, "Master PIN saved successfully!", false);
    setTimeout(refreshPinState, 800);
  });

  changePinToggleBtn.addEventListener("click", () => {
    pinSetupForm.style.display = "block";
    pinConfiguredView.style.display = "none";
    savePinBtn.textContent = "Update PIN";
  });

  // 2. Active Tab Detection
  function extractChatIdFromUrl(urlString) {
    try {
      const url = new URL(urlString);
      const host = url.hostname;
      const path = url.pathname;

      if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
        const match = path.match(/\/c\/([a-zA-Z0-9-]+)/);
        return match ? `chatgpt_${match[1]}` : null;
      }
      if (host.includes("claude.ai")) {
        const match = path.match(/\/chat\/([a-zA-Z0-9-]+)/);
        return match ? `claude_${match[1]}` : null;
      }
      if (host.includes("gemini.google.com")) {
        const match = path.match(/\/app\/([a-zA-Z0-9_-]+)/);
        return match ? `gemini_${match[1]}` : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function checkActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      currentChatStatus.className = "status-badge badge-none";
      currentChatStatus.textContent = "No active tab";
      return;
    }

    const chatId = extractChatIdFromUrl(tab.url);
    currentChatId = chatId;

    if (!chatId) {
      currentChatStatus.className = "status-badge badge-none";
      currentChatStatus.textContent = "No supported chat detected";
      currentChatIdEl.textContent = "Open a specific chat on ChatGPT, Claude, or Gemini";
      toggleLockBtn.style.display = "none";
      return;
    }

    currentChatIdEl.textContent = chatId;
    await updateLockBtnState();
  }

  async function updateLockBtnState() {
    if (!currentChatId) return;

    const { lockedChats = [] } = await chrome.storage.local.get("lockedChats");
    const isLocked = lockedChats.includes(currentChatId);

    toggleLockBtn.style.display = "block";
    if (isLocked) {
      currentChatStatus.className = "status-badge badge-locked";
      currentChatStatus.textContent = "🔒 Currently Locked";
      toggleLockBtn.className = "btn-danger";
      toggleLockBtn.textContent = "🔓 Remove Lock from this Chat";
    } else {
      currentChatStatus.className = "status-badge badge-unlocked";
      currentChatStatus.textContent = "🔓 Currently Public";
      toggleLockBtn.className = "btn-primary";
      toggleLockBtn.textContent = "🔒 Lock This Chat";
    }
  }

  toggleLockBtn.addEventListener("click", async () => {
    const { pinHash } = await chrome.storage.local.get("pinHash");
    if (!pinHash) {
      showMsg(actionMsg, "Please set a Master PIN first above!", true);
      return;
    }

    const { lockedChats = [] } = await chrome.storage.local.get("lockedChats");
    const index = lockedChats.indexOf(currentChatId);

    let updated;
    if (index > -1) {
      updated = lockedChats.filter((id) => id !== currentChatId);
      showMsg(actionMsg, "Chat unlocked and removed from lock list.", false);
    } else {
      updated = [...lockedChats, currentChatId];
      showMsg(actionMsg, "Chat privacy-locked successfully!", false);
    }

    await chrome.storage.local.set({ lockedChats: updated });
    await updateLockBtnState();
    await renderLockedList();
  });

  // 3. Render Locked Conversations List
  async function renderLockedList() {
    const { lockedChats = [] } = await chrome.storage.local.get("lockedChats");
    lockedCountEl.textContent = lockedChats.length;

    if (lockedChats.length === 0) {
      lockedListEl.innerHTML = `<div style="font-size: 11px; color: #64748b; padding: 4px;">No locked chats yet.</div>`;
      return;
    }

    lockedListEl.innerHTML = "";
    lockedChats.forEach((chatId) => {
      const item = document.createElement("div");
      item.className = "locked-item";
      item.innerHTML = `
        <span title="${chatId}">${chatId.length > 25 ? chatId.slice(0, 25) + "..." : chatId}</span>
        <button class="delete-btn" data-id="${chatId}">✕</button>
      `;
      lockedListEl.appendChild(item);
    });

    lockedListEl.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const idToRemove = e.target.getAttribute("data-id");
        const { lockedChats = [] } = await chrome.storage.local.get("lockedChats");
        const updated = lockedChats.filter((id) => id !== idToRemove);
        await chrome.storage.local.set({ lockedChats: updated });
        await updateLockBtnState();
        await renderLockedList();
      });
    });
  }

  function showMsg(element, text, isError) {
    element.textContent = text;
    element.className = isError ? "message msg-error" : "message msg-success";
    setTimeout(() => {
      element.textContent = "";
    }, 3000);
  }

  // Initialize
  await refreshPinState();
  await checkActiveTab();
  await renderLockedList();
});
