# Marmalade Player — Stability Engine

Marmalade retains the working browser-only WebRTC system, with a host-authoritative **versioned timeline**. A transport command is sent to the host, then shared with every guest. **Quality is fixed when selected; the system never changes the user's selected quality automatically.**

## Delivery and fallback

| Path | Who sends the video? | Forward buffering | Use |
|---|---|---|---|
| Live WebRTC | Host's browser uploads to each guest | Browser WebRTC jitter buffer (roughly 0.16–3 seconds where APIs exist) | Default for locally selected files. |
| Verified local copy | Guest's own disk | Normal media-element file buffering | The optional *Use my local copy* button; host and guest files are compared using size plus SHA-256 sampled regions. No movie pixels or bytes are sent. |
| Buffered HLS / HTTPS MP4 | An **external HTTPS media server or CDN you provide** | Configured 10–120-second HLS forward buffer with 30-second back buffer; browser native buffering for MP4 | The *Buffer-first / CDN* link box. Source requires compatible codec, proper CORS, publicly accessible HTTPS file/playlist/segments. |

The browser-only GitHub Pages app **does not create a transcoding server, media CDN, private TURN relay, or true server-authoritative clock** by itself. It also cannot prebuffer future frames of a real-time live WebRTC stream. Choosing an HLS link enables the deep-buffered architecture without breaking the local-file WebRTC fallback.

## Stability features

- Smooth, Balanced, Lowest Delay presets adjust **supported** WebRTC jitter/receiver playout delay hints (unsupported browser properties are ignored). The quality setting never changes automatically.
- HLS.js loads lazily for supported browsers and uses `autoStartLoad: false`, a bounded forward buffer (initially 60, configurable between 10 and 120 seconds), 120-second maximum, 30-second back buffer, worker decoding, hole nudging and capped retries. Manual HLS rendition selection is locked; Safari native HLS can only promise what its native rendition controls expose.
- Peer-rescue option caches up to 20 MiB of host-downloaded HLS fragments. **Only after HTTP segment download fails**, a guest may request a fragment (at most 1.5 MiB) over the existing PeerJS data connection. This does not require a separate P2P file server; a missing/late fragment returns to HLS.js's network error and retry/failover behavior. There is no peer assistance for regular MP4 or live WebRTC media.
- Primary hosted playlist/MP4 links may specify a backup URL. HLS network errors use bounded exponential backoff and media-recovery attempts before alternate-source failover.
- `Keep everyone together` can coordinate pauses/resumption while guests prebuffer a hosted source. Movie control remains shared; guest file or HLS delivery has independent buffers and a host-authoritative timeline.
- Drift <100 ms is ignored; 100 ms–1 s uses ±2% local playback-speed correction for **seekable** local/hosted guest files; more than 1 s, or a command revision jump, seeks. This does not seek live WebRTC MediaStreams (which are not timeline-seekable).
- Guest diagnostics show actual decoded FPS statistics where reported, packet loss, jitter, RTT, buffer ahead, and drift. The separate FPS overlay still shows rendered frames at the viewer's screen.
- WebRTC tracks hint `motion` to encoders and prioritize 24-FPS pacing and `maintain-framerate` with independently selected 144/240/360/480/540/720/1080p limits. Maximum video bitrates are still constrained by room upload capacity.
- When a stream stalls, retry/recovery uses bounded delays and keyframe requests where available; attempting more network work cannot overcome a fully disconnected or overloaded route.

## Content-aware / per-title encoding (optional FFmpeg)

`bash tools/encode-hls.sh "movie.mp4" "site-movie"` generates a constrained-CRF H.264/AAC multi-quality HLS ladder, aligned 24-FPS constant-GOP segments. This makes it possible for a properly configured CDN to serve independent viewers without the host uploading a separate live encode to each of them. Do not assume a fixed compression saving—results depend on material, codec, available CPU and encoding settings. Host the generated directory with HTTPS and appropriate CORS; then paste its `master.m3u8` URL in Marmalade's CDN field.

## Engineering limits

- No system can guarantee **24 genuine new frames every second** during bandwidth outages, frozen source video, hardware decoding failure or severe latency. Duplicating existing frames would make an FPS counter look higher, but would not recreate missing motion. Therefore Marmalade reports actual presented FPS; it does **not** fake FPS through interpolation. Optional AI optical-flow reconstruction would require a separate compute-heavy decoder/renderer and could introduce visual artifacts.
- No browser can instantaneously force all devices across an ocean to decode a new frame at the same physical instant. The authoritative movie timeline, per-viewer buffers and drift correction reduce perceived desynchronization rather than claiming impossibility.
- Adaptive deep buffering trades latency for resilience. The host-file WebRTC default remains available for quick connections; buffered hosted/local modes are preferred for prolonged poor internet.
- A managed TURN relay and geographically distributed CDN require independent infrastructure/credentials and ongoing bandwidth costs. They are not supplied by GitHub Pages.

## Testing checklist

Test separately on desktop Firefox/Edge/Chrome, Safari, iOS and Android. Verify (1) three viewers with independent locked quality, (2) a verified local file, (3) HLS levels and CORS, (4) fallback when a segment returns 404/503, (5) guest prebuffer pauses, (6) 0.5/1/3 Mbps download limits, 50–300ms jitter, 1–10% packet loss, offline/reonline transitions, (7) video frame rate and audio sync over 15+ minutes. Prior browser smoke tests are not proof that an overseas network will maintain 24 FPS.
