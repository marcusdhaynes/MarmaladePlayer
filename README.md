# 🍊 Marmalade Player

A small, zero-build watch-together app. The host plays a movie from their own device; guests watch the host's video/audio through low-latency WebRTC.

**Source:** `index.html` is a complete standalone app. You can also use the separate-source ZIP distributed with the project.

## Features

- Host a room and share a link with an 8-character invite code.
- Stream from a local video/audio file. The file is **not uploaded** to GitHub or the room service.
- Guest joins from another device with no copy of the file.
- Host-driven playback, scrubbing, volume, and fullscreen; guest manages their own volume and fullscreen.
- Browser-based window/tab share fallback for files the browser can't decode (system-audio sharing depends on browser/OS).
- WebRTC peer-to-peer streams; one data connection per guest. No build step, account, or application installation.

## Deploy to the requested URL

Repository must be named **`marcusdhaynes/marmaladeplayer`** for the address **https://marcusdhaynes.github.io/marmaladeplayer/**.

1. In this repository, select **Settings → General → Repository name**, and rename it to **`marmaladeplayer`**.
2. If GitHub Pages isn't available for this private repository on your plan, under **Settings → General → Danger Zone → Change repository visibility**, choose **Public**. Be aware that doing so makes the source publicly visible.
3. Select **Settings → Pages → Build and deployment → Source: Deploy from a branch → main / (root) → Save**.
4. Visit **https://marcusdhaynes.github.io/marmaladeplayer/** once GitHub finishes publishing.

**Quick test:** Open the live website in two different browsers/devices. Create a room on one; pick a supported video, copy its link; join from the other; click **Start watching** on the host. If playback with sound is blocked on the guest, click the central play button.

## Technical notes / limitations

- GitHub Pages hosts only the application files; it is **not** a video relay.
- [PeerJS](https://peerjs.com/) 1.5.5 is loaded from jsDelivr, and the public PeerJS service handles signaling. The app needs an internet connection.
- WebRTC sends audio/video directly when a peer-to-peer connection is possible. Some NAT/firewall combinations **require an authenticated TURN relay**, which this zero-configuration version does not provide. The public PeerJS service may also be rate-limited or unavailable.
- **No app can guarantee zero internet latency.** Actual end-to-end delay depends on devices, encoding, connection quality, and guest bandwidth.
- **Any format is not possible with a browser decoder alone.** Browser-supported MP4/WebM/media can be played locally; for MKV/AVI and unusual codecs, play them in a desktop video player and use the window/tab-share fallback. Audio for that fallback is OS/browser-dependent.
- Media is not uploaded to a backend, but WebRTC networking can expose peers' IP addresses to each other and signaling metadata passes through PeerJS. Room codes are not passwords.
- Every additional viewer needs more host uplink bandwidth; this version is best for small rooms.

## Local development

Serve the files on localhost (rather than opening `file://`):

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`. Chrome, Edge, and Firefox provide the strongest browser-based file/streaming support; Safari uses the canvas capture fallback.

Made for lightweight movie nights.

## Cross-platform support

Marmalade Player is a **responsive web app**, not an OS-specific executable. Guests open the same HTTPS link in a modern browser. No guest installation is needed.

| Platform | Local-file hosting | Guest playback | Window sharing |
|---|---|---|---|
| Windows, macOS, Linux (modern desktop browsers) | Supported for browser-decodable files | Supported | Supported if the browser/OS allows it |
| Android browsers | Supported for browser-decodable files | Supported; touch to enable sound if prompted | Generally unavailable in mobile browsers |
| iPhone / iPad Safari and other iOS browsers | Supported when the installed WebKit version can capture and encode media | Supported; tap-to-play may be required | Usually unavailable on iOS/iPadOS browsers |
| Other platforms with current HTML5 + WebRTC browsers | Capability-dependent | Capability-dependent | Capability-dependent |

Additional compatibility details:

- Touch-friendly controls and mobile-responsive layout.
- iPhone/iPad: device hardware controls set volume; playback stays inline unless native video fullscreen is available. A CSS theater-mode fallback provides expanded viewing.
- Mobile hosts use a lower capture ceiling (720p / 24 fps) to reduce encoding load, heat, and lag.
- Where available, Screen Wake Lock helps keep an active hosting tab awake. Mobile OSes may still stop capture if the tab is backgrounded; **keep the hosting tab foregrounded**.
- Different browsers decode different video/audio codecs. There is no reliable universal-format support without host-side conversion or a native helper.
- Connections need HTTPS and internet signaling. TURN relay infrastructure is required for reliable connectivity on more restrictive Wi-Fi, mobile networks, and corporate/firewall setups.
- Tested using Chromium desktop and mobile viewport emulations, not a physical-device certification program. Verify with real iOS Safari, Android, and target desktop browsers before promising production compatibility.

GitHub Pages deployment requires a **public** Pages-capable repository or a paid plan that supports private Pages, plus a repo rename to `marmaladeplayer`. The current source repository is still `marmaladeplayer05-21118134`.
