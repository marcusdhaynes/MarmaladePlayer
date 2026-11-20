# Marmalade Library Extension

The persistent library holder for Marmalade Player, built as a browser
extension instead of a separate program. One codebase, four targets:

| Target | How it ships | Folder persistence |
|---|---|---|
| Chrome / Edge (Chromium) | This folder, MV3 (`manifest.json`) | Catalog **and** directory handle in extension IndexedDB. After a browser restart Chrome may ask for one click (Rescan/Play in the extension page) to re-grant reading — Chrome's rule for every extension. Catalog itself never needs re-adding. |
| Minternet (Marcus's browser) | Native module, see `minternet/` | **Never reconnect.** Paths stored natively, rescanned on startup. This is the primary target. |
| Firefox | `targets/firefox/` overlay manifest | Catalog persists (signed install). No persistent directory handles exist in Firefox: re-pick a folder once per session to rescan/play. Stated plainly, not hidden. |
| Safari | `targets/safari/` Xcode wrapper notes | Catalog persists. No persistent handles: re-pick per session, like Firefox. |

## Load it in Chrome / Edge (unpacked)
1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` folder from the
   MarmaladePlayer repo.
4. Click the Marmalade Library toolbar icon → **Open Library**, name a
   library, and choose **+ Add Folder** once.

## What persists, where
- Extension IndexedDB (`marmalade-extension-library:v1`, chrome-extension
  origin): libraries, folders, full catalog, and — Chromium only — the
  `FileSystemDirectoryHandle`s.
- `chrome.storage.local` key `catalogSnapshot`: metadata-only mirror the
  content script can serve to marmaladeum.com (handles and file bytes are
  never in it).
- Clearing marmaladeum.com's site data or its service-worker cache does
  **not** touch extension storage. Removing the extension does — that is
  the browser's rule for all extensions.

## Talking to marmaladeum.com
`content.js` is injected on `https://marmaladeum.com/*`,
`https://marcusdhaynes.github.io/MarmaladePlayer/*`, and localhost. It
relays a `window.postMessage` protocol (documented in `content.js`):
the page can `ping`, `get-catalog`, and ask the extension to open its
library page at a video (`play`). Playback itself happens in the
extension library page, which owns the handles — the web page never
receives file handles or bytes from the extension. The web app's
`MarmaladeMediaLibrary.syncFromExtension()` imports the extension catalog
into the on-page library so titles show up in Marmalade's own UI.

`background.js` also accepts `externally_connectable` ping/open-library
messages from the two Marmalade origins only.

## Honest limits (no magic)
- No extension on any browser can silently read arbitrary folders with
  zero interaction forever. Chromium comes closest (stored handle + one
  click re-grant when Chrome demotes permission to `prompt`); Firefox
  and Safari cannot retain folder access across sessions at all.
- The only architecture with a true never-reconnect guarantee is native
  code holding real paths — Plex Media Server, or, for Marcus, the
  Minternet native module in `minternet/`. That is why Minternet is the
  primary target and the extension is the best-possible fallback for
  other people's browsers.
