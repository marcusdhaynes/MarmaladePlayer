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

Functional implementation accepted for supported sources and constant-rate frame stepping. All nine requirements have implementations; dedicated real media test [46064425096](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46064425096)
verifies thumbnails, bookmarks, chapter markers, exact timestamps, nearby
scene boundaries, actual adjacent decoded pictures, guest thumbnail requests,
and paused navigation. The [final targeted acceptance test](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46068164749) passed on commit 497fdced139f96b4f4c773d6bedf44ffa851217a: cached preview 14.27 ms, uncached preview 30.89 ms, no playback interruption events and no dropped frames across the short stress window. Disjoint buffer geometry and absence of invented live buffer also passed. Extended load tests and physical-device performance are still open under sections 15, 17 and 20. VFR stepping is not guaranteed frame-accurate.

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

## Section 18 — Settings improvements

Versioned allowlisted preference backup, validated import and category-specific reset added. Imports are staged before explicit apply/reload; room codes, credentials, library contents and viewing history are excluded. Import, reload persistence, invalid room-code rejection and scoped reset passed all three browser engines on commit a1e0f362d05a28bde3dfcfdfadf8445cfd111751 ([audit](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46068622321)). Expanded eight-category resets and actual JSON export passed [46069028881](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46069028881). Persistent preferred subtitle search language and ninth reset category passed [46069615398](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46069615398). Mini-player fade and persistent diagnostics passed [46070313182](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46070313182). Privacy (remember/forget room) and Updates (automatic checks) add the final two initial category reset implementations. Their browser and update identity tests passed [46071062489](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46071062489). All 13 categories have initial reset support. Direct category navigation and global backup/update search now have dedicated layout tests awaiting CI. Complete preference coverage and exhaustive category reset round-trips remain open.

Timeline follow-up: run 46069028731 failed an uncached thumbnail stress test. Corrected real hover geometry and fade setup passed [46069615457](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46069615457) on aa02aaa275f900cf67ceab1b7ee2814cf444c722: cached 86.21 ms, uncached 83.89 ms, zero interruption events, zero dropped frames in the controlled window. Functional acceptance restored within the stated scope.

Release identity follow-up: staged HTML carries its own full commit identifier, checked by the archive verifier. Running build and available deployment are displayed independently. Web update checks compare deployed manifest identity rather than a hard-coded semantic version. Update application refuses active playback or connected rooms; preference and identity tests await CI. Native installer version detection and reproducibility remain open.

Build identity and deployment verification passed [46071062530](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46071062530); native builds and the subsequent Android emulator run [46071333805](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46071333805) also passed. An earlier emulator run was skipped, not a failure.

Settings acceptance follow-up: 46073337338 timed out focusing the disabled host-side Quality control. Navigation now focuses the labelled row when the control cannot receive focus. Added real reset/reload checks for all 13 categories with cross-category preservation and corrected brightness validation to the actual 0–100% range. These tests await CI. Streaming run 46073337515 measured 24.10 capture FPS but 19.69 decoded FPS at 480p; increased encoder budget from 760 to 950 kbps without lowering thresholds. Root cause not conclusively established; retest required.


## Latest verified baseline and compatibility capture follow-up

Commit `347178ef320e47ef8f2ad118afd105c6cb73b685` passed [three-engine audit](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46073972266), [settings layout](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46073972265), [production deployment and byte verification](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46073972153), [permanent version backup](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46073972263), and [Android emulator](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46074186594). Section 18 now has passing initial reset/reload coverage for all thirteen categories, direct navigation and global backup/update search; exhaustive preference coverage remains open. Section 19 still needs native reproducibility, persistent user-data migration and actual rollback verification. These are not blanket section closures.

[Real host/guest run 46073972127](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46073972127) failed at 144p (19.69 decoded FPS, 17.93 presented FPS, 23.51 capture FPS). The prior 480p regression was above the existing floor on that run. This follow-up removes redundant sender scaling for low-tier compatibility captures, shares capture by requested tier, releases unused tracks/timers and raises the 144p bitrate ceiling within the existing room cap. The real-room test now asserts exact low-tier source height and retains all prior frame-rate thresholds. Root cause and new runtime results are **not yet verified**; sections 02, 03 and 15 remain open.


Settings follow-up: add validated subtitle appearance (legacy storage key) to export, import and scoped reset, excluding per-movie timing. New exports explicitly identify a full snapshot; older version-1 imports remain merge-only. Snapshot restore clears omitted allowlisted settings back to defaults, without touching media, history, credentials or private room codes (unless the user's explicit remember-room preference disables storage). Poster column validation now matches the actual 1–12 integer limit. Added browser regression assertions for appearance, invalid import, full snapshot restore, and preservation of subtitle timing records. These new assertions await CI; section 18 remains open until verified.


Verified follow-up: [real room run 46086804767](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46086804767) passed all seven resolution tiers without changing FPS thresholds. 144p decoded 23.21 FPS versus 19.69 previously; exact low-tier capture dimensions passed. [Repeat real room run](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46087199748) and [three-engine settings snapshot audit](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46087199823) passed on `1c8e07b2cfef342e453c4c243545393da1641532`, along with [settings layout](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46087199874), [deployment](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46087199871) and [backup](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46087199678). Section 18 core portable settings functions have passing coverage, but exhaustive individual preference round trips and missing future feature settings remain open.

## Section 07 — Audio engine (progress)

Personal volume, optional peak protection, night compression, dialogue emphasis, seven-band EQ with bass and treble shelves, bounded RMS leveling, audio delay, preferred track language and permission-aware output switching are implemented. The prior cross-engine audit measured delay impulse response, relative filter response and leveling bounds. This follow-up adds a boost-only soft sample ceiling to all personal Web Audio routes; normal-volume paths are unchanged and pre-gain room broadcast remains independent. New offline rendered sample tests exercise quiet and loud 600% amplification. The new tests await CI. This is a digital sample ceiling, not guaranteed distortion-free playback or a true-peak limiter. Independent microphone controls, real multi-track/device coverage and reconnection audio acceptance remain open.


Audio verification: all 19 workflows passed for `7ec3912311ce1bbe7595a7db75ec400f1bba2f1a`, including [three-engine rendered boost tests](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46087596466), [real room](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46087596310), [live deployment](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46087596432) and [Android emulator](https://github.com/marcusdhaynes/MarmaladePlayer/actions/runs/46087740394). New follow-up initializes personal relay gain before connecting the output, releases partially constructed audio nodes on failure, and scopes track-change handlers to the active stream. The real-room recovery test now verifies preserved host and guest listening levels, explicit guest mute, same room identity, successful unmute and audible decoded PCM after call replacement. New tests await CI. Microphone volume requires an explicit opt-in voice-chat subsystem, not a background microphone permission request; it remains open. Physical-device audio acceptance also remains open.
