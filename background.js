/**
 * AI Chat Privacy Lock - Background Service Worker (Manifest V3)
 * Manages tab state, session locks, and communications.
 */

// Initialize defaults on install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["lockedChats", "pinHash", "salt"]);
  if (!data.lockedChats) {
    await chrome.storage.local.set({ lockedChats: [] });
  }
});

// Listen for tab URL updates (essential for Single Page Applications like ChatGPT/Claude/Gemini)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    // Send a message to content script to re-evaluate URL locking
    chrome.tabs.sendMessage(tabId, { type: "URL_CHANGED", url: tab.url }).catch(() => {
      // Content script may not be loaded yet or tab not matching host permissions; safe to ignore
    });
  }
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_SESSION_UNLOCK") {
    const chatId = message.chatId;
    chrome.storage.session.get([`unlocked_${chatId}`]).then((result) => {
      sendResponse({ isUnlocked: Boolean(result[`unlocked_${chatId}`]) });
    });
    return true; // Keep channel open for async response
  }

  if (message.type === "SET_SESSION_UNLOCK") {
    const chatId = message.chatId;
    chrome.storage.session.set({ [`unlocked_${chatId}`]: true }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "LOCK_SESSION_CHAT") {
    const chatId = message.chatId;
    chrome.storage.session.remove([`unlocked_${chatId}`]).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});
