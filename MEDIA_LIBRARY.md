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
2. Choose **+ Choose Folder** and grant read access. Add more source folders
   as needed. Files are scanned recursively.
3. Save. The browser indexes video filenames, sizes, modification times,
   movie years when present, and recognizable TV season/episode numbers.
4. Switch libraries using the left-hand shelf. Search by name or path,
   sort, filter by movies/shows, or browse the original folder structure.
5. Select a video card to open the original media file in Marmaladeum's
   existing host player, which retains the established playback, room,
   subtitle, and resume behavior.
6. Use **+ Folder** for more folders, **⚙ Manage** to rename, reconnect, remove
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

## Recovery

Source changes and successful builds are archived by the existing
[Marmaladeum permanent version-backup process](VERSION_RECOVERY.md).
An exported Git repository snapshot will contain the library code, not
your local IndexedDB catalog or private folders. Browser-storage backup
and import/export can be added in a subsequent library-management enhancement.
