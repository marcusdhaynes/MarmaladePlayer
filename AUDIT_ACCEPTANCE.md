# Marmaladeum audit acceptance register

Reference: Comprehensive Application Audit, 26 November 2026. Status is
requirement-specific; a passing build is not blanket audit closure.

## Section 04 — Intelligent playback diagnostics (page 8)

Functional implementation accepted for supported browser telemetry at commit
`988ff0803a3a2b6c11bceac553b0f8353fad03fb`, with subsequent audit and streaming
workflows passing on `1e74b5d7350eb5c929fef15dbb011cee5502117a`.

| Requirement | Evidence |
| --- | --- |
| Compact optional diagnostic window | Three-engine audit: [46065045665](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46065045665) |
| Resolution, decoded and non-dropped FPS, dropped frames, bandwidth, route, decoder, playback mode | Real two-browser media and live diagnostics: [46065045532](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46065045532) |
| Clock drift | Verified-local-file transition in same real media test |
| Buffer | Measured contiguous media buffer, target shown where available; full 180-second performance belongs to sections 03 and 15 |
| Audio synchronization | Optional measured RTP playout estimate; unavailable values are reported as unavailable, not stable |
| Automatic problem identification and corrective actions | Cross-engine classification tests, including stall, sender CPU, bandwidth and rendering distinctions |

Not a certification of acoustic lip sync, hardware acceleration on every device,
or all physical platform combinations. Device-level validation remains open
under sections 15, 17 and 20.

## Section 08 — Scrubber and timeline (page 12)

Nine initial implementations; dedicated real media test [46064425096](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46064425096)
verifies thumbnails, bookmarks, chapter markers, exact timestamps, nearby
scene boundaries, actual adjacent decoded pictures, guest thumbnail requests,
and paused navigation. Remaining: measure preview latency and playback stutter
under active playback load, verify buffered-range visualization and cancellation
under repeated requests. Dedicated real-media acceptance tests for these now
exist and await CI. Fixture budgets: cached preview <500 ms, uncached <1500 ms,
no pause/seek/wait/stall events and bounded frame loss during stress. These
are regression budgets, not guarantees of instant preview on every device.
VFR stepping is not guaranteed frame-accurate.

## Section 19 — Updates, checkpoints and regression prevention (page 23)

Previous production deployment [46066691271](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46066691271)
and Pages [46066691206](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46066691206)
verified all 34 staged asset hashes. Permanent version backup passed
[46066691212](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46066691212).
New contract and archive-restore checks added: deterministic web stamping,
tamper rejection, extracted archive integrity and forward/back cache migration.
These checks passed on commit `1d5000973300d2ab7c1cde8238543ca8f321858a`: [contract suite](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46067391710) and [restored archive](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46067391682). Actual production rollback is not performed; native build reproducibility and persistent user-data schema migration coverage are still open.

Other sections remain open until a comparable item-level acceptance record
is supported by implementation and verification evidence.
