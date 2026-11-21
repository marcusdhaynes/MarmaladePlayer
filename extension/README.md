# Marmalade Library — Independent Browser Extensions v0.2.0

This is one shared five-file WebExtension packaged for Chrome, Edge, Brave, Opera, Vivaldi, Minternet, Firefox and Safari. **No Minternet native module, .mext media server, local HTTP server or native file bridge is required.**

## What is retained

- Marmaladeum library names, folders, videos, titles, years and metadata are automatically backed up to extension storage, independently of marmaladeum.com site storage.
- The site restores missing library metadata from the extension when installed. Existing local entries are preserved, never replaced by empty extension data.
- The extension page can independently index a folder, add selected videos, rescan/relink, and export/import a JSON catalog backup.
- Video contents are neither copied into extension storage nor uploaded. Local playback uses browser-authorized original files.
- A Chromium-specific Remember Folder option can store an authorized directory handle. Browser or OS revocation still requires reauthorization.

## Installation

**Chrome, Edge, Brave, Opera, Vivaldi:** Download your browser ZIP from [Marmalade Library releases](https://github.com/marcusdhaynes/MarmaladePlayer/releases). Extract it, enable Extensions > Developer Mode, then Load unpacked using the extracted folder.

**Minternet:** Download the separate Minternet ZIP (same pure WebExtension functionality as Chromium), then in Minternet use Extensions > Chrome > Import ZIP if its WebView2 extension runtime accepts the package. This does not use a .mext or any Minternet-native media service. Browser file-access support must still be verified on the installed Minternet build.

**Firefox:** Download the Firefox ZIP; temporarily test through about:debugging > This Firefox > Load Temporary Add-on. Permanent installation requires Mozilla add-on signing. The provided development XPI is **unsigned** and is not a permanently installable release.

**Safari (macOS, iOS/iPadOS):** The Safari ZIP is source only, not a signed installable app. Run Apple's current Safari Web Extension Packager on a Mac with Xcode:

    xcrun safari-web-extension-packager --copy-resources --app-name "Marmalade Library" /path/to/extracted/safari

Then sign and build in Xcode, or use the App Store Connect web packager. CI may provide an unsigned Xcode project artifact. Apple Developer distribution requirements apply.

## File access is a separate capability

| Browser | Catalog retention | Original file access across restarts |
|---|---|---|
| Chromium family | Browser extension storage | Remembered handles where supported, subject to permission renewal |
| Firefox | Browser extension storage | Reselect the original folder/files after restarting |
| Safari | Signed browser extension storage | Reselect the original folder/files after restarting |

No browser extension can silently bypass a system-files protection warning or permanently override revoked filesystem permissions. Use + Folder or + Videos for media in a protected directory, rather than attempting to authorize the drive root with Remember Folder. Backups include metadata, **not video bytes**. Uninstalling the extension can remove its data; export a catalog backup before uninstalling.

## Per-package files

Each installable package contains exactly five files: manifest.json, background.js, content.js, library.html, and library.js. The catalog and IndexedDB source modules are bundled into library.js during the build, so all browser packages share the same tested implementation without extra runtime files.

The GitHub Actions workflow in .github/workflows/media-library-extensions.yml builds the ZIP packages and uploads them to a dedicated prerelease after verification.
