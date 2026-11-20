'use strict';
/* Firefox background (event page, non-persistent): same relay contract as
   the Chromium service worker, without chrome.tabs messaging differences.
   Loaded only by the Firefox manifest overlay in targets/firefox/. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'marmalade:open-library') {
    const url = chrome.runtime.getURL('library.html') +
      (message.itemId ? '#play=' + encodeURIComponent(message.itemId) : '');
    chrome.tabs.create({ url }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'marmalade:ping') {
    sendResponse({ ok: true, extension: 'marmalade-library', version: '0.1.0' });
  }
});
