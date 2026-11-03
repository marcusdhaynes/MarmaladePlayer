# 🍊 Marmalade Player

A small, zero-build watch-together app. The host plays a movie from their own device; guests watch the host's video/audio through low-latency WebRTC.

**Source:** `index.html` is a complete standalone app. You can also use the separate-source ZIP distributed with the project.

## Features

- Host a room and share a link with an 8-character invite code.
- Stream from a local video/audio file. The file is **not uploaded** to GitHub or the room service.
- Guest joins from another device with no copy of the file.
- Host and guest playback controls share the authoritative movie timeline. Each guest keeps independent volume, subtitles, and fullscreen.
- Compact Link and Share buttons sit beneath Buffer: Share copies the room invitation; Link lets connected guests choose a local video file and hold to switch local playback off/on.
- Local video verification first checks a SHA-256 fingerprint sampled from file contents. Alternative encodes must pass conservative title, film release year or exact TV season/episode, runtime, and picture-proportion checks. Metadata-only matches are **probable**, not proof of identical movie content.
- A verified local copy plays from the guest's disk rather than streaming the video; room commands still synchronize play/pause/seek with frequent drift correction. Hold Link to request the remote stream again without stopping the local movie before the incoming stream arrives. Re-enable Link by holding it again. The movie can be switched via another click.
- Synchronization is as close as network, device clocks, and browser playback permit; **zero-latency or perfectly frame-identical playback cannot be guaranteed**.
- Browser-based window/tab share fallback for files the browser can't decode (system-audio sharing depends on browser/OS).
- WebRTC peer-to-peer streams; one data connection per guest. No build step, account, or application installation.

## Deploy to the requested URL

Repository must be named **`marcusdhaynes/marmaladeplayer`** for the address **https://marcusdhaynes.github.io/marmaladeplayer/**.

1. In this repository, select **Settings → General → Repository name**, and rename it to **`marmaladeplayer`**.
2. If GitHub Pages isn't available for this private repository on your plan, under **Settings → General → Danger Zone → Change repository visibility**, choose **Public**. Be aware that doing so makes the source publicly visible.
3. Select **Settings → Pages → Build and deployment → Source: Deploy from a branch → main / (root) → Save**.
4. Visit **https://marcusdhaynes.github.io/marmaladeplayer/** once GitHub finishes publishing.

**Quick test:** Open the live website in two different browsers/devices. Create a room on one; pick a supported video, copy its link; join from the other; click **Start watching** on the host. If autoplay with sound is blocked on the guest, click Play in the theater controls to enable sound.

## Technical notes / limitations

- GitHub Pages hosts only the application files; it is **not** a video relay.
- [PeerJS](https://peerjs.com/) 1.5.5 is loaded from jsDelivr, and the public PeerJS service handles signaling. The app needs an internet connection.
- WebRTC sends audio/video directly when a peer-to-peer connection is possible. Some NAT/firewall combinations **require an authenticated TURN relay**, which this zero-configuration version does not provide. The public PeerJS service may also be rate-limited or unavailable.
- **No app can guarantee zero internet latency.** Actual end-to-end delay depends on devices, encoding, connection quality, and guest bandwidth.
- **Any format is not possible with a browser decoder alone.** Browser-supported MP4/WebM/media can be played locally; for MKV/AVI and unusual codecs, play them in a desktop video player and use the window/tab-share fallback. Audio for that fallback is OS/browser-dependent.
- Media is not uploaded to a backend, but WebRTC networking can expose peers' IP addresses to each other and signaling metadata passes through PeerJS. Room codes are not passwords.
- Every additional viewer needs more host uplink bandwidth; this version is best for small rooms.

## AI-free movie and TV information

The small **ⓘ** button beside the subtitles control opens the information drawer.
When a host selects a local video, Marmalade attempts to identify it from its
filename (including season/episode numbers), embedded tags via MediaInfo.js, and
optionally an OpenSubtitles moviehash lookup. No frames, audio, or video files
are uploaded for identification. The OpenSubtitles hash reads only the beginning
and end of the local file; only the hash/filename query leaves the browser.

**Optional enhanced setup:** movie/series information can load from public Wikipedia and TVmaze sources without a key. To unlock detailed TMDB filmography, open the ⓘ drawer → **Information Sources · API Access** and add a personal [TMDB](https://www.themoviedb.org/settings/api) key or read-access token. Optional
[OMDb](https://www.omdbapi.com/apikey.aspx) and
[OpenSubtitles](https://www.opensubtitles.com/en/consumers) keys add
IMDb/Metacritic/Rotten Tomatoes ratings and filehash identification.
Keys remain in this browser's localStorage and are sent only to their matching
API services. On shared devices, clear keys using **Forget keys**.

The drawer provides an automatic title match and manual search/correction,
movie posters, synopsis, episode titles, cast/characters/creators, dates,
studios, release status, runtime, genre, TMDB ratings, budgets and revenue
where reported, optional OMDb ratings and awards, plus sourced Wikipedia
production background or an external IMDb trivia link. Unreported values are
marked unavailable, not filled in by AI. Wikipedia/IMDb trivia may be missing
because they do not offer an unrestricted comprehensive public trivia API.

Identified information is copied to connected guests using the existing data
channel (no keys or video bytes). The info feature is separate from playback,
local-file verification, synchronization, streaming and bandwidth controls.
Lookup needs an internet connection. It may be unavailable due to API quotas,
browser CORS policies, incomplete embedded metadata, or missing database
records. TMDB's developer API is free for permitted non-commercial uses with
attribution; commercial uses require a separate agreement.

## Local development

Serve the files on localhost (rather than opening `file://`):

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`. Chrome, Edge, and Firefox provide the strongest browser-based file/streaming support; Safari uses the canvas capture fallback.

Made for lightweight movie nights.

## One Player Across Web, Windows, macOS, Linux, Android and iOS

MarmaladePlayer is an **omni-platform application** with one shared HTML/CSS/JavaScript playback engine. The web edition is available at
[https://marcusdhaynes.github.io/MarmaladePlayer/](https://marcusdhaynes.github.io/MarmaladePlayer/).
The packaged editions preserve its room, player, subtitles and synchronization logic rather than maintaining independent forks.

| Platform | Package | Build or download |
|---|---|---|
| Web | HTTPS/PWA | [Live MarmaladePlayer](https://marcusdhaynes.github.io/MarmaladePlayer/) |
| Windows | Tauri native installer (.exe) | [Windows, macOS, Linux build artifacts](https://github.com/marcusdhaynes/MarmaladePlayer/actions/workflows/desktop-native.yml) |
| macOS | Tauri DMG | Same desktop build workflow |
| Linux | Tauri AppImage | Same desktop build workflow |
| Android | Capacitor APK | [Android APK builds](https://github.com/marcusdhaynes/MarmaladePlayer/actions/workflows/android-apk.yml); [latest verified preview release](https://github.com/marcusdhaynes/MarmaladePlayer/releases) |
| iOS | Capacitor Xcode project and unsigned simulator build | [iOS simulator builds](https://github.com/marcusdhaynes/MarmaladePlayer/actions/workflows/ios-native.yml). Signing with an Apple developer identity is required for iPhone/App Store deployment. |

**Android installation:** Download a signed **debug preview** APK from a successful Android build or its release; install with Android's package installer after explicitly allowing installation from your file manager/browser. Preview builds may use different debug-signing keys, so installing a subsequent preview might require uninstalling the earlier preview first. User app data can be lost on uninstall. Do not treat the debug APK as a Play Store-certified release.

**Build instructions:** [Mobile](mobile/README.md) · [Desktop](desktop/README.md).
The native apps bundle the same public web assets, require signaling connectivity, and share normal public HTTPS room invitation links. A native browser WebView is not functionally identical to Chrome/Safari; file codecs, capture APIs, fullscreen behavior, autoplay, and background audio vary by OS. Real-device acceptance testing remains required.

Additional compatibility details:

- Touch-friendly controls and mobile-responsive layout.
- iPhone/iPad: device hardware controls set volume; playback stays inline unless native video fullscreen is available. A CSS theater-mode fallback provides expanded viewing.
- Mobile hosts use a lower capture ceiling (720p / 24 fps) to reduce encoding load, heat, and lag.
- Where available, Screen Wake Lock helps keep an active hosting tab awake. Mobile OSes may still stop capture if the tab is backgrounded; **keep the hosting tab foregrounded**.
- Different browsers decode different video/audio codecs. There is no reliable universal-format support without host-side conversion or a native helper.
- Connections need HTTPS and internet signaling. TURN relay infrastructure is required for reliable connectivity on more restrictive Wi-Fi, mobile networks, and corporate/firewall setups.
- Tested using Chromium desktop and mobile viewport emulations, not a physical-device certification program. Verify with real iOS Safari, Android, and target desktop browsers before promising production compatibility.

GitHub Pages deployment requires a public Pages-capable repository or a paid plan that supports private Pages. The source repository is `marcusdhaynes/MarmaladePlayer`.
