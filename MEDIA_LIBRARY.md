# Marmaladeum Local Media Library

The Library is an optional local collection browser. It is inspired by Plex's
library-creation and viewing workflow, but it is not a Plex server.

## Turn It On

Open the player's **Settings → Video → Media Library** toggle. The new left
pane takes half of the Movie & Series Information row on desktop. On smaller
screens the Library and information panel stack vertically. The default is
**Off**, so existing playback layouts stay unchanged.

## Create And Manage

1. Choose **+ Library**. Name it, then select **Movies**, **TV Shows**, or
   **Other Videos**. You may save an empty library.
2. Choose **+ Add Folder** and pick the folder once, exactly like Plex.
   There is only one folder picker: on Chrome/Edge it remembers the folder
   so the library can be rescanned and played after a reload; on other
   browsers the same button imports the folder's files for the session.
   The folder row shows how many videos were found in it before you save,
   so an empty scan is visible immediately instead of after saving.
   Add more source folders as needed. Files are scanned recursively.
3. Save. The browser indexes video filenames, sizes, modification times,
   movie years when present, and recognizable TV season/episode numbers.
   Saving never triggers a second silent scan, so the count you previewed
   is the count that is saved. From an empty library or the toolbar
   **+ Folder** button, one folder pick scans, saves, and displays the
   videos with no second Save click at all.
4. Switch libraries using the left-hand shelf. Search by name or path,
   sort, filter by movies/shows, or browse the original folder structure.
5. Select a video card to open the original media file in Marmaladeum's
   existing host player, which retains the established playback, room,
   subtitle, and resume behavior.
6. Use **+ Folder** for more folders (one pick adds and saves them),
   **⚙ Manage** to rename, reconnect, remove
   individual source folders, or delete a library, and **↻ Scan** to detect
   additions and removals. Removing a catalog never deletes video files.
7. Choose **▧ Find Artwork** to request posters. On first use, Marmaladeum
   asks permission to send movie/series *titles* to the same public metadata
   services used by Movie & Series Information. Only verified title matches
   display artwork. Video bytes, folder paths, and library files stay local.

## Permissions, Offline Use, And Native Apps

**Chrome/Edge/Chromium desktop:** The File System Access API permits explicit
read-only directory handles. The app saves these handles and catalog metadata
in IndexedDB where supported. When browsers revoke permission, use the
library editor's **Reconnect** action to restore access.

**Firefox, Safari, and restricted WebViews:** A folder-input fallback
recursively indexes the files you select. The named library and its catalog
can remain stored, but the browser cannot reopen those files automatically
after the session; select the folder again in Manage to use or rescan them.

**Windows/macOS/Linux Tauri and Android/iOS Capacitor packages:** This feature
ships with the shared web UI in each target. Native WebViews provide different
folder-picker capabilities. Without a dedicated native filesystem bridge,
persistent unattended filesystem access cannot be guaranteed on every
platform. The folder-selection fallback is available where the WebView
supports it. Validate on actual devices before claiming Plex-equivalent
folder access.

**Privacy and storage:** IndexedDB stores a lightweight catalog and, where
serializable, the permissioned directory handles—not video contents or
duplicate copies. Rescanning reads metadata from permitted files. A user's
video never goes to GitHub or the movie-information services. Public cover
lookup is opt-in and only transmits title/year metadata.

**Current differences from Plex:** There is no always-on media server,
background server-side watcher, multi-device shared catalog, server-side
transcoding, automatic universal artwork matching, subtitle acquisition per
library item, or Plex's complete account/sharing/client feature set. The
watch-together player remains independent; library selection loads a video
using its existing player pathway. Users can always use the ordinary Choose
Video button instead.

## Persistent Library: Extension And Minternet

The web library above stores its catalog in this site's IndexedDB. For a
library that survives site-data clears and browser restarts, use the
**Marmalade Library extension** in this repo's `extension/` folder
(`extension/README.md` has load-unpacked instructions for Chrome/Edge,
the Firefox overlay, and Safari wrapper notes). Its catalog lives in
extension storage; on Chromium its folder handles live there too. The web
app imports the extension catalog with
`MarmaladeMediaLibrary.syncFromExtension()`; extension-held videos play
in the extension's library page.

For **Minternet** (Marcus's own browser), the guarantee is stronger by
design — and it is NOT built into Minternet for Marmalade alone. Minternet
ships a general-purpose **Local Media Library add-on** (a Minternet add-on
any granted site can use; Marmalade is its first consumer). The add-on
stores folder **paths** in its own add-on data and rescans them natively
on startup — no handles, no permission prompts, **no reconnect, ever**.
System webviews (WebView2/WKWebView/WebKitGTK) give web pages no working
`showDirectoryPicker` and no usable `webkitdirectory` folder return, which
is why web-only fixes could never work inside Minternet: the folder must
be chosen in the add-on's native dialog. When the add-on's bridge
(`window.MinternetMediaLibrary`) is present, Marmalade's Choose Folder
routes through it, the catalog appears automatically on load, and cards
play through the add-on's scoped asset serving. Without the add-on,
Minternet shows an honest message instead of silently indexing 0 videos.
The add-on lives in the Minternet repo under `addons/local-media-library/`
with the generic add-on host documented in `addons/README.md`; the older
prototype analysis (why WebView2 extension loading was rejected) is in
`extension/minternet/README.md`. Honest per-browser limits for
Firefox/Safari are documented in `extension/targets/` — their catalogs
persist, but those engines offer no persistent folder access to any
extension.

## Recovery

Source changes and successful builds are archived by the existing
[Marmaladeum permanent version-backup process](VERSION_RECOVERY.md).
An exported Git repository snapshot will contain the library code, not
your local IndexedDB catalog or private folders. Browser-storage backup
and import/export can be added in a subsequent library-management enhancement.
