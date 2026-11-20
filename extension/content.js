/* Marmalade Library Extension — content script bridge.
   Injected on marmaladeum.com, the GitHub Pages copy, and localhost.
   Protocol (window.postMessage, same window):
     Page -> extension: { source:'marmalade-web', type:'ping' }
                        { source:'marmalade-web', type:'get-catalog' }
                        { source:'marmalade-web', type:'play', itemId }
     Extension -> page: { source:'marmalade-extension', type:'pong', version }
                        { source:'marmalade-extension', type:'catalog', libraries }
                        { source:'marmalade-extension', type:'play-accepted' }
   The catalog is read from the EXTENSION's IndexedDB by opening an
   extension-context read via chrome.runtime message to a helper page is not
   possible from a service worker (no IndexedDB handles clone), so the
   catalog snapshot is mirrored into chrome.storage.local by the library
   page after every scan (metadata only — never handles, never file bytes). */
'use strict';

document.documentElement.dataset.marmaladeExtension = 'installed';

function postToPage(payload) {
  window.postMessage({ source: 'marmalade-extension', ...payload }, location.origin);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'marmalade-web' || typeof data.type !== 'string') return;

  if (data.type === 'ping') {
    chrome.runtime.sendMessage({ type: 'marmalade:ping' }, (reply) => {
      postToPage({ type: 'pong', version: reply?.version || '0.1.0' });
    });
  } else if (data.type === 'get-catalog') {
    chrome.storage.local.get('catalogSnapshot', (result) => {
      postToPage({ type: 'catalog', libraries: result.catalogSnapshot || [] });
    });
  } else if (data.type === 'play') {
    chrome.runtime.sendMessage(
      { type: 'marmalade:open-library', itemId: String(data.itemId || '') },
      () => postToPage({ type: 'play-accepted' }));
  }
});
