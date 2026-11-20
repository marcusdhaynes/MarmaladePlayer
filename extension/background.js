/* Marmalade Library Extension — service worker.
   Relays catalog requests between the web app (externally_connectable /
   content-script messages) and the extension's own storage, and opens the
   library page for playback handoffs. Handles themselves never leave the
   extension: playback happens in the extension library page, which owns the
   stored handles and can request permission from a real user click there. */
'use strict';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ installedAt: Date.now() });
});

function openLibrary(playItemId) {
  const url = chrome.runtime.getURL('library.html') +
    (playItemId ? '#play=' + encodeURIComponent(playItemId) : '');
  return chrome.tabs.create({ url });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'marmalade:open-library') {
    openLibrary(message.itemId || null).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'marmalade:ping') {
    sendResponse({ ok: true, extension: 'marmalade-library', version: '0.1.0' });
  }
});

/* Web pages on the allowlisted origins may ping and open the library.
   Catalog reads go through the content script so the request is tied to a
   real Marmalade tab. */
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'marmalade:ping') {
    sendResponse({ ok: true, extension: 'marmalade-library', version: '0.1.0' });
    return;
  }
  if (message.type === 'marmalade:open-library') {
    openLibrary(message.itemId || null).then(() => sendResponse({ ok: true }));
    return true;
  }
  sendResponse({ ok: false, error: 'unsupported' });
});
