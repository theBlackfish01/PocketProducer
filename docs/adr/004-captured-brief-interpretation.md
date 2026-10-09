# ADR 004: captured brief interpretation replaces regex parsing

Accepted 2026-10-08 by explicit user direction ("regex-based approaches are a poor-quality approach"; the user approved a small paid Luna call per submission).

## Context

`intent.ts` turned a direction into hard checks with about fifty hand-written patterns. Plausible wording produced false locks and dead ends:

- "leave room for the pad" became "keep a section called pad unchanged";
- "in bars 13 and 15" became a section name;
- part names containing conjunctions ("Now and Then") were split apart.

Every new phrasing needed another pattern. The completion gate, admission and the per-keystroke preservation preview all re-parsed the same text.

## Decision

The direction is read **once, at submit**, by a small structured Luna call (`POST /projects/:id/native/interpretations`, Responses API strict JSON schema, low reasoning). The reply is only a proposal. `captureNativeBrief` (`packages/core/src/native/brief.ts`) validates it deterministically before anything becomes a hard check:

- every item quotes the user's own words, compared as Unicode word sequences;
- every number (tempo, meter, bars) is written in that quote, as digits or number words;
- every part, phrase and section identity exists in the selected version. A new piece's sections are matched by name once built.

A written start or end bar plus a length implies the whole span, so every written position is checked. A section can't be given two different extents (different lengths, or different start bars); such items are rejected together. In a revision, an extent that differs from a section's current bars is a resize, shown for confirmation rather than enforced. Bar ranges that only say where a note applies (as in pinned notes) are scope, not section extents.

The proposal is read **item by item**. An item outside a checkable range (tempo 40–220 BPM, 1–128 bars, meters 2–12 over 4 or 8, progressions of 3–16 chords) or beyond a list's limit is rejected with its reason; it never voids the other items or the paid check. Stored guidance and rejected lists are capped at 64. Chords match their written roots in either case.

Items that fail validation are **rejected**. The person sees them in a "Check these words" dialog and can send them as guidance or edit the direction. They never become a hidden lock. Items that cannot apply (keeping something in a new piece, conflicting whole-piece instructions) become guidance.

The validated capture is stored with the interpretation's effect and copied into the job request as `_brief` when `createNativeJob` receives a matching `interpretationId`. The match is checked against the same direction hash, selected version and scope, otherwise `INTERPRETATION_STALE`. Completion checks, preservation and the producer's `briefChecks` read only `_brief`. No server path parses the direction text.

If the check is unavailable (no key, budget, provider failure or output that is not an object), the person can send the direction as guidance only, with no enforced checks. That choice is recorded on the job as an explicit `provenance: "none"` brief and shown in its request scope ("Sent without enforced checks"). A request from before captured briefs has no `_brief`; when it next runs (Continue or a retry), the producer makes one best-effort check of its original direction under a stable per-job key and attaches it, or continues as guidance only if the check is unavailable. Fixture mode returns an empty capture. Tests capture explicit interpretations through the same validation (`capturedBrief`, `scriptedBrief`).

## Consequences

- Every submission pays for one interpretation call, well under a cent at Luna pricing. It shares the job-less provider ledger, budgets and idempotency with writing help (`runJoblessProviderCall`). An unchanged resend replays its paid check; a failed check is never replayed.
- The live "Keep unchanged" chip shows only explicit protections. Words that keep a part are reported with the request ("Keeping as written: …").
- Explicit controls (scope, part target, Keep unchanged) remain authoritative and independent of the interpreter.
- Format validation (ids, hashes, routes, automation paths, chord symbols) still uses patterns; that is the right tool for a fixed grammar.
