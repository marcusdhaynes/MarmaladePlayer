# Safari target

Safari Web Extensions are the same WebExtension code wrapped in a native
app container by Xcode's converter:

```bash
xcrun safari-web-extension-converter /path/to/MarmaladePlayer/extension \
  --project-location ~/MarmaladeLibrarySafari --app-name "Marmalade Library"
```

Then build/run the generated Xcode project once, and enable the extension
in Safari → Settings → Extensions. An Apple Developer account is required
to distribute it beyond your own Mac; unsigned conversions run only via
Xcode on that machine (Safari → Develop → Allow Unsigned Extensions is a
per-session developer toggle).

Persistence reality on Safari:
- The **catalog** persists in the extension's storage, same as Chromium.
- Safari has no `showDirectoryPicker` and no persistent directory handles
  for web extensions; folder **file access** needs a re-pick per session,
  exactly like Firefox. The catalog does not.
- Zero-reconnect on Apple platforms is achievable only through a native
  app holding real filesystem access — for Marcus that is the Minternet
  native route (WKWebView shell + native library module), not a Safari
  Web Extension. See `../../minternet/README.md`.
