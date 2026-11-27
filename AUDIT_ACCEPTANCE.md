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
