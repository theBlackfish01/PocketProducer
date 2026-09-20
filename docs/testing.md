# Verification record

Updated 2026-09-20. Commands were run on Windows with Node 22.14, pnpm 11.19, PostgreSQL 17.6 in Docker, Chrome and Playwright Chromium 1243.

## Automated results

- `tsc -b`: pass under strict TypeScript 5.9.3.
- `eslint . --max-warnings=0`: pass.
- Vitest unit: 3 files, 5 tests passed. Covers canonical sections, protected melody, scoped drum simplification, deterministic/non-silent PCM and honest Gemini/Nexus boundaries.
- Vitest PostgreSQL integration: 1 file, 3 tests passed. Covers idempotency mismatch, duplicate reuse, expired-lease worker recovery/fencing, failed and cancelled revision jobs and cross-owner denial.
- Playwright Chromium: 2 tests passed. Covers page/create-or-existing path, named sliders, real audio play/pause state, version dialog/focus return, phone sheet and focused composer visibility.
- Vite production build: pass, 2,142 modules; main JS approximately 386 kB / 125 kB gzip before later small changes.
- axe-core 4.12.1 WCAG A/AA audit: 16 passes, 0 incomplete, 0 violations after labeling the hidden upload input.

## Integrated live proof

- OpenAI Deep Agent succeeded on `gpt-6-astra`; the integrated job planned and rendered **Sunroom Haze** from natural language plus the owned source.
- Revision 1 and 2 are both 44.636375 seconds, 48 kHz stereo, 8,570,228 bytes and non-silent. Their SHA-256 hashes differ.
- Revision 2 removed exactly six Groove hi-hats. Protected melody structure hash is `2b9612658f342e00ad9e16e85f193126642bf7ebde5fe9d9c8f99bfb9cc3d973`; protected melody stem SHA-256 is `43a991f3f1cacb22a311acd8d2344a69867b58657c0b85ecfc72b666f9e78ecf` in both versions.
- Rendered preview byte-range request returned HTTP 206 with the expected 128-byte content range.
- Explicit restore was exercised from v2 to v1 and back to v2; both immutable rows remained.
- Nexus export is `needs_auth` and contains four `editable-stem` parts. No remote Audiotool project is claimed.
- Source and preview analysis rows are stored as `unavailable`; Gemini was not called because no key is configured.

Re-run the artifact assertions with `pnpm exec tsx scripts/verify-demo.ts` and spend reconciliation with `pnpm exec tsx scripts/audit-usage.ts`.

## Visual evidence

- [Created desktop Listening Room](testing/evidence/listening-room-created-desktop.png)
- [Phone Listening Room](testing/evidence/listening-room-mobile.png)
- [Initial/empty desktop state](testing/evidence/listening-room-desktop.png)

The final manual browser pass also verified: no Vite overlay, meaningful body content, keyboard opening/closing of the mobile sheet, focus returning to the sheet and compare triggers, reduced-motion emulation (`0.00001s` transition), named seek/volume inputs and actual WAV playback advancing the seek value.

## Not verified here

- Physical iOS/Android keyboard and notched-device safe area; the 390×844 focused-input and CSS safe-area behavior passed in Chromium emulation.
- Live Gemini listening, because no Gemini key is present.
- Live Audiotool OAuth/project mutation, because app registration is absent.
- Non-WAV uploads, because FFmpeg is absent.
