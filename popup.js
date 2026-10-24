/**
 * AI Chat Privacy Lock - Popup Script
 * Handles PIN setup, active tab detection, friendly chat titles,
 * lock toggle with PIN verification, and real-time messaging.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const pinSetupForm = document.getElementById("pin-setup-form");
  const pinConfiguredView = document.getElementById("pin-configured-view");
  const newPinInput = document.getElementById("new-pin");
  const confirmPinInput = document.getElementById("confirm-pin");
  const savePinBtn = document.getElementById("save-pin-btn");
  const changePinToggleBtn = document.getElementById("change-pin-toggle-btn");
  const pinMsg = document.getElementById("pin-msg");

  const currentChatStatus = document.getElementById("current-chat-status");
  const currentChatTitleEl = document.getElementById("current-chat-title");
  const currentChatIdEl = document.getElementById("current-chat-id");
  const toggleLockBtn = document.getElementById("toggle-lock-btn");
  const actionMsg = document.getElementById("action-msg");

  const verifyBox = document.getElementById("verify-box");
  const verifyPinInput = document.getElementById("verify-pin-input");
  const confirmUnlockBtn = document.getElementById("confirm-unlock-btn");
  const cancelUnlockBtn = document.getElementById("cancel-unlock-btn");

  const lockedCountEl = document.getElementById("locked-count");
  const lockedListEl = document.getElementById("locked-list");

  let currentChatId = null;
  let currentChatTitle = null;
  let activeTabId = null;
  let pendingUnlockTargetId = null;

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

    activeTabId = tab.id;
    const chatId = extractChatIdFromUrl(tab.url);
    currentChatId = chatId;

    if (!chatId) {
      currentChatStatus.className = "status-badge badge-none";
      currentChatStatus.textContent = "No supported chat detected";
      currentChatTitleEl.style.display = "none";
      currentChatIdEl.textContent = "Open a specific chat on ChatGPT, Claude, or Gemini";
      toggleLockBtn.style.display = "none";
      return;
    }

    // Try finding human-readable title
    let titleCandidate = null;
    if (tab.title) {
      const clean = tab.title
        .replace(/ - (Gemini|ChatGPT|Claude)$/i, "")
        .replace(/Gemini - /i, "")
        .replace(/ChatGPT - /i, "")
        .trim();
      if (clean && !["Gemini", "ChatGPT", "Claude", "New chat"].includes(clean)) {
        titleCandidate = clean;
      }
    }

    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_CHAT_TITLE", chatId });
      if (res && res.title) titleCandidate = res.title;
    } catch {}

    const { lockedChatTitles = {} } = await chrome.storage.local.get("lockedChatTitles");
    currentChatTitle = titleCandidate || lockedChatTitles[chatId] || "Conversation";

    currentChatTitleEl.textContent = currentChatTitle;
    currentChatTitleEl.style.display = "block";
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

    const { lockedChats = [], lockedChatTitles = {} } = await chrome.storage.local.get([
      "lockedChats",
      "lockedChatTitles",
    ]);
    const isLocked = lockedChats.includes(currentChatId);

    if (isLocked) {
      pendingUnlockTargetId = currentChatId;
      verifyBox.style.display = "block";
      verifyPinInput.value = "";
      verifyPinInput.focus();
    } else {
      const updated = [...lockedChats, currentChatId];
      if (currentChatTitle) {
        lockedChatTitles[currentChatId] = currentChatTitle;
      }
      await chrome.storage.local.set({ lockedChats: updated, lockedChatTitles });
      showMsg(actionMsg, `🔒 "${currentChatTitle}" locked!`, false);

      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, {
          type: "LOCK_IMMEDIATELY",
          chatId: currentChatId,
        }).catch(() => {});
      }

      await updateLockBtnState();
      await renderLockedList();
    }
  });

  confirmUnlockBtn.addEventListener("click", async () => {
    const enteredPin = verifyPinInput.value.trim();
    if (!enteredPin) {
      showMsg(actionMsg, "Please enter your Master PIN.", true);
      return;
    }

    const { pinHash, salt, lockedChats = [], lockedChatTitles = {} } = await chrome.storage.local.get([
      "pinHash",
      "salt",
      "lockedChats",
      "lockedChatTitles",
    ]);
    const computedHash = await hashPin(enteredPin, salt);

    if (computedHash === pinHash) {
      const targetId = pendingUnlockTargetId || currentChatId;
      const updated = lockedChats.filter((id) => id !== targetId);
      delete lockedChatTitles[targetId];

      await chrome.storage.local.set({ lockedChats: updated, lockedChatTitles });

      showMsg(actionMsg, "🔓 Lock removed successfully.", false);
      verifyBox.style.display = "none";
      pendingUnlockTargetId = null;

      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, {
          type: "UNLOCK_IMMEDIATELY",
          chatId: targetId,
        }).catch(() => {});
      }

      await updateLockBtnState();
      await renderLockedList();
    } else {
      showMsg(actionMsg, "Incorrect Master PIN! Cannot remove lock.", true);
      verifyPinInput.value = "";
      verifyPinInput.focus();
    }
  });

  cancelUnlockBtn.addEventListener("click", () => {
    verifyBox.style.display = "none";
    pendingUnlockTargetId = null;
  });

  async function renderLockedList() {
    const { lockedChats = [], lockedChatTitles = {} } = await chrome.storage.local.get([
      "lockedChats",
      "lockedChatTitles",
    ]);
    lockedCountEl.textContent = lockedChats.length;

    if (lockedChats.length === 0) {
      lockedListEl.innerHTML = `<div style="font-size: 11px; color: #64748b; padding: 4px;">No locked chats yet.</div>`;
      return;
    }

    lockedListEl.innerHTML = "";
    lockedChats.forEach((chatId) => {
      const friendlyName = lockedChatTitles[chatId] || chatId;
      const item = document.createElement("div");
      item.className = "locked-item";
      item.innerHTML = `
        <span title="${chatId}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 230px;">
          🔒 ${friendlyName}
        </span>
        <button class="delete-btn" data-id="${chatId}" title="Unlock this chat">✕</button>
      `;
      lockedListEl.appendChild(item);
    });

    lockedListEl.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idToRemove = e.target.getAttribute("data-id");
        pendingUnlockTargetId = idToRemove;
        verifyBox.style.display = "block";
        verifyPinInput.value = "";
        verifyPinInput.focus();
        showMsg(actionMsg, `Enter Master PIN to unlock this conversation`, false);
      });
    });
  }

  function showMsg(element, text, isError) {
    element.textContent = text;
    element.className = isError ? "message msg-error" : "message msg-success";
    setTimeout(() => {
      element.textContent = "";
    }, 3500);
  }

  await refreshPinState();
  await checkActiveTab();
  await renderLockedList();
});
