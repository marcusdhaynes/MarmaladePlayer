# MarmaladePlayer for Windows, macOS and Linux

These Tauri 2 desktop apps package the **same** HTML/CSS/JavaScript used by the public web app and Capacitor mobile builds, without a separate media player implementation.

Local build (requires Rust, system webview headers, Node 22 and the Tauri desktop prerequisites):
```sh
cd desktop
npm install
npm run prepare
npm run icon
npx tauri build
```

CI: **MarmaladePlayer Desktop Windows macOS Linux** workflow produces unsigned Windows NSIS, macOS DMG and Linux AppImage artifacts. macOS Gatekeeper may block unsigned packages; distributed signed/notarized production releases require code-signing credentials. System WebView media capture features differ; desktop host/guest parity requires actual device tests.

All platforms share room codes and the public invitation link `https://marcusdhaynes.github.io/MarmaladePlayer/?room=CODE`. Local source and stream switching behavior remain inside `index.html`.
