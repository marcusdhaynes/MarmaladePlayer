'use strict';
chrome.storage.local.get('catalogSnapshot', (result) => {
  const libs = result.catalogSnapshot || [];
  const videos = libs.reduce((n, l) => n + (l.items || []).length, 0);
  document.getElementById('summary').textContent =
    libs.length + ' librar' + (libs.length === 1 ? 'y' : 'ies') + ' · ' + videos + ' videos saved';
});
document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
});
