# Minternet: the zero-reconnect route (Marcus's own browser)

Minternet is NOT Chromium or Firefox. It is native system-webview apps:
Windows WebView2, macOS/iOS WKWebView, Linux WebKitGTK, Android System
WebView, desktop via Tauri 2. Its README states standard OS webviews
cannot run every Chrome/Firefox extension. So a plain WebExtension can
never be the guarantee here. Two routes were investigated:

## Route (a): WebView2 `AddBrowserExtension` — rejected as the guarantee
- Windows-only (WebView2). macOS/iOS/Linux/Android Minternet shells get
  nothing from it.
- Even where it loads the Chromium extension, folder access still goes
  through Chromium's File System Access permission model: handles can
  come back as `prompt` after restart and need a click to re-grant.
  That is exactly the reconnect behaviour Marcus rejected.

## Route (b): built-in native library module — IMPLEMENTED (prototype)
`media_library.rs` in this folder is a drop-in Rust module for
Minternet's Tauri desktop app (`native/desktop/src-tauri/src/`):

- The chrome's native folder dialog picks a folder **once**. The module
  stores the folder's absolute **path** in Minternet's app data
  (`media-library.v1.json` in `app_data_dir`, same pattern as
  `browsing_history.rs`), together with the scanned catalog.
- On every Minternet startup the native side rescans those paths with
  real filesystem access. **No permission prompt, no handle, no expiry,
  no reconnect — ever.** A folder on an unplugged drive scans empty but
  stays registered and comes back when the drive does.
- Playback: files are served to the Marmalade tab through Tauri's asset
  protocol (already enabled: `protocol-asset` in Cargo.toml), scoped at
  runtime to registered library folders only.
- Exposure: Minternet's capability file already states remote sites get
  NO Tauri capabilities. So the catalog reaches marmaladeum.com through a
  bridge the **chrome** injects only into exact Marmalade origins
  (`window.MarmaladeNativeLibrary.getCatalog()`), mirroring the password
  vault's exact-origin autofill pattern. Arbitrary sites get nothing and
  never see a filesystem path beyond the catalog metadata Marmalade
  already displays.
- Local only: this module introduces **no cloud backend** (per
  Minternet's AGENTS.md Supabase-only rule for new persistent/cloud
  backends — this feature is neither; it is local filesystem data and
  stays on the machine, no Firebase, no Supabase).

Status / honest limits:
- Desktop (Windows/macOS/Linux Tauri) module is written with unit tests
  (root + nested scan, missing-folder retention). It was **not compiled
  in this environment** (no Rust toolchain on the build VM); Minternet's
  existing GitHub Actions native builds are the compile check, and the
  module uses only crates already in Minternet's Cargo.toml
  (serde, serde_json, tauri).
- It is delivered as a prototype inside the MarmaladePlayer repo, not yet
  pushed to the Minternet repo: that repo's local work copy has unrelated
  uncommitted changes (tauri.conf.json, ui/index.html, updates/) that must
  not be swept into this change. Dropping it in is: copy the .rs file,
  add `mod media_library;`, register the state, route the four
  `media-library-*` actions in `browser_action`, add the chrome UI +
  origin-gated bridge injection — all spelled out in the module header.
- Android/iOS Minternet shells need the same design in Kotlin/Swift
  (store paths in app-private storage, rescan natively); the JSON schema
  in the Rust module is the shared contract. Not built in this pass.

## Why this is the only true "never reconnect" answer
Every browser-sandbox route (web page, WebExtension, WebView2 extension)
ultimately asks the web platform for file access, and every web platform
reserves the right to re-ask. A native module in Marcus's own browser
asks the **operating system** instead, with a path he granted once in a
native dialog. That difference is the whole design.
