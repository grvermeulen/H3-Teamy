# GTA H3 — implementation and acceptance plan

The merged 0.2.3 PR and its current checks are documented in [PR verification](pr-verification.md).

Baseline: `18cee84`, [audit](report.md). Scope: every S1–S5, P1–P4 and G1–G3 finding. The audit scores remain the baseline until the changes are verified. Checkboxes describe acceptance, not merely code written.

## 1. Identity and protocol safety

- [x] **S1** Require a verified server session for every multiplayer mutation/token; reject raw user-ID anonymous cookies. Preserve UUID guest identities for guest features. Apply shared pre-authentication IP/global limits before identity database work. Regressions must prove forged IDs and unauthenticated requests cannot create arena identities or tokens.
- [x] **S3** Validate untrusted input and snapshot messages before storing/decoding, with bounded sizes, counts, numeric ranges, versions and sequences. Invalid peers must not stop the host or generate repeated error reports. Exercise hostile containers, oversized arrays, NaN/infinity, stale frames and healthy peers together.

## 2. Server-owned multiplayer lifecycle

- [x] **S2** Add durable room membership, capacity enforcement, expiring host leases and monotonically increasing epochs in PostgreSQL. Serialize competing joins/lease claims. Separate host state from input channels; issue short-lived room/epoch-specific Ably capabilities in a new namespace that old wildcard tokens cannot access. Device role hints cannot confer authority. Integrate create/join/leave/reconnect/renew/migration through the actual hooks and transport.
- [x] **S4** Start matches on the server, retain participant history and accept exactly one result per server-issued match ID. Validate duration, chronology, unique eligible participants, bounded scores and the authorized host. Preserve legitimate departed participants. Label casual host-reported results as unverified; surface submission failures and support idempotent retries.
- [x] Test room capacity races, cross-room access, forged hosts, stale leases/tokens, host migration, duplicate completion, premature completion and departed-player results. Add an additive Prisma migration and verify against an isolated local PostgreSQL database; never migrate a remote database as part of this task.

## 3. Performance and diagnostics

- [x] **P1** Reduce network input frequency to at most 20 Hz active and about 2 Hz idle while retaining 30 Hz local prediction. Preserve acknowledgements and input expiry under jitter; avoid simulating unrelated entities during reconciliation. Measure snapshot bandwidth and apply a compatible reduction with regular resynchronization. Verify deterministic parity and multi-client convergence.
- [x] **P2** Separate simulation/network maintenance from presentation. Hidden clients send neutral input; hidden tabs perform no canvas/HUD rendering. Coordinate background host lease handover and recover on visibility changes without stuck input.
- [x] **P3** Record raw wall-clock frame intervals independently of clamped simulation time. Expose p50/p95/p99/worst, long frames, simulation/draw/raster time and missing chunks. Retain useful session summaries. Regression: a 500 ms stall remains observable as 500 ms.
- [x] **P4** Cache street-label plans, budget cold raster work by elapsed time, warm visible chunks and adapt cache/render scale/effects to quality and viewport. Cap device pixel ratio, update budgets on resize/orientation and fix native fetch binding. Verify chunk traversal in renderer tests and live quality transitions without permanently cached blank tiles or unbounded cache growth.

## 4. Graphics and usability

- [x] **G1** Compact the phone HUD to primary status and move secondary actions into settings. Preserve usable touch targets and safe areas. Check portrait at 390×844 and landscape at 844×390 with the selectable phone controls (physical coarse-pointer validation remains a release check); target HUD ≤80 CSS px and playfield ≥78% of portrait height.
- [x] **G2** Document a coherent visual style; add roof depth/detail and landmark silhouettes in cached static rendering, distinct vehicle silhouettes, consistent pedestrian/police art, stronger player orientation and shape-coded pickups/threats. Verify readability, contrast, reduced motion and performance at normal gameplay scale.
- [x] **G3** Let players collapse the lobby into a crew/room strip to explore and reopen it. Verify keyboard focus, Escape, touch input, countdown and transitions to play/results.

## 5. Dependencies and release verification

- [x] **S5** Recheck advisory versions and production reachability, fix through compatible dependency changes, retain TypeScript 6.0.3, and verify Prisma generation/migration/build. Save the updated security scan and explain any remaining advisories with evidence.
- [x] Bump the app version and add matching Dutch `CHANGELOG` content for the finished improvements.
- [x] Run formatting/de-slop and diff review, lint, typecheck, relevant tests, full tests, production build and security scan on the target Node 22 runtime.
- [x] Verify authenticated end-to-end create/join/play/host-disconnect/reconnect/results, unauthorized requests, responsive graphics and network stress. Record actual environment, timings, errors, screenshots and limitations. Local substitutes do not count as live-service or physical-device evidence.
- [x] Run a sustained multi-client scenario and report measured frame/bandwidth/cache changes against the audit baseline. Distinguish observed results from targets or estimates.
- [x] Write a final implementation/verification report with evidence per finding, remaining risks and revised justified ratings. No item is complete solely because its unit tests pass.

## Rollout and recovery

Deploy the additive migration before the application. Versioned channels force existing games to reconnect, preventing old wildcard tokens from reaching new rooms; old tokens expire naturally. Keep historical result tables compatible. On rollback, disable multiplayer access rather than restore the vulnerable token issuer. No production deployment or external messaging is included in this local implementation task.

## Work log

- Plan created before implementation; baseline working tree contained only user-owned untracked files plus the audit artifacts. Implementation branch: `codex/gta-h3-audit-improvements`.

## Acceptance record — 13 September 2026

Implementation and local acceptance are complete for S1–S5, P1–P4 and G1–G3. See [the final report](implementation-report.md) for evidence per finding, scores and explicit validation limits. The checked items refer to these recorded local checks; physical-device background throttling, thermal performance and coarse-pointer hardware are release checks, not claimed results.

- Server authority: 12 isolated PostgreSQL/API integration tests passed; a real Ably match migrated host, accepted the returning original player and persisted once with both accounts and the server's 180-second duration.
- Performance: 61–63% less snapshot payload traffic; active input 15 Hz and idle input 2 Hz. Five simulated minutes with eight players, 10% packet loss and 33–167 ms delay converged within 6 cm after idle.
- Browser: authenticated create/join/play/disconnect/reconnect/results, compact portrait and landscape layouts, quality switching, lobby focus and production smoke checks. Physical hardware and actual background throttling were unavailable and are documented separately.
- Verification: 1,551 full-suite tests, 12 database/API tests, Node 22 typecheck and production build passed; lint has no errors and two pre-existing non-arena warnings; npm audit reports zero advisories.
- Release: version 0.2.2 and matching Dutch changelog; additive migration tested only on the disposable database. Prepared for pull-request review; no deployment or remote migration performed.
