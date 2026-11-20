# Firefox target

One codebase, Firefox overlay manifest: `targets/firefox/manifest.json`.

To package for Firefox:
1. Copy `extension/` to a build folder.
2. Replace `manifest.json` with `targets/firefox/manifest.json`
   (paths inside it are relative to the extension root via `../`).
3. Load temporarily via `about:debugging` → This Firefox → Load Temporary
   Add-on, or sign/package with `web-ext build` + AMO signing for a
   permanent install. Temporary add-ons are removed on restart — that is a
   Firefox rule, not a Marmalade choice; a signed install persists.

What persists in Firefox:
- The **catalog** (libraries, folders by name, every video's path/title/
  size) in the extension's IndexedDB + `chrome.storage.local` snapshot.
  It survives restarts with a signed/permanent install.

What does **not** persist in Firefox, honestly:
- Firefox does not implement the File System Access API
  (`showDirectoryPicker`) and provides **no persistent directory handles**
  for extensions. There is no API — handle storage, background wake, or
  otherwise — that lets an extension re-read an arbitrary user folder after
  restart without the user picking it again. Anyone claiming otherwise is
  describing Chrome, a native app, or a local server.
- So in Firefox: catalog forever, one re-pick of a folder before
  rescan/playback in a new browser session. The library page says exactly
  this next to every catalog-only folder.
- For zero re-picks in a Mozilla-family engine, the folder must be owned by
  a native program (the Plex Media Server model) or by Marcus's own
  Minternet native module — see `../minternet/`.
