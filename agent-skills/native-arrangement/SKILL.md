---
name: native-arrangement
description: Construct an editable native musical arrangement from a user's direction using Pocket Producer's validated tools.
---

Use `compose_native_form` to choose an original meter, section lengths, instrument roles, explicit motif notes and placements, processing and automation. This converts your choices into validated domain operations; it is not a fixed arrangement template. A small sketch can use three parts and two sections; a larger piece can use more, within the tool bounds. Read the pinned workspace or use catalogue discovery when device details matter. Catalogue discovery is not permission to write an entity. Keep stable IDs and step keys for further edits. Inspect the tool's actual diff and refine an identifiable musical detail with `apply_native_batch` if useful.

Use sections to give the piece a beginning, development and ending. Prefer distinct roles and instrument colors over copies of one phrase. Define motifs as reusable note relationships, place them in sections, then vary later occurrences deliberately. Beatbox8 is an on/off drum grid: notes use only MIDI 36/38/42/46, sixteenth-step beat positions, quarter-beat duration and velocity 1. Pitched instruments can use expressive velocity and duration. Device/effect parameter names and ranges are in `native-sound-design` and the capability inspector. Route only through supported operations; if a requested device or sample cannot be validated, choose a supported alternative and say so.

Owned sources are optional. A placed interval is only “placed/referenced,” never “audibly used” until its selected bytes and a future render are checked. Do not invent sample IDs, presets or rights metadata. Make assumptions explicit in the structural explanation. No native audio is available in this milestone; do not claim to have listened or judged mix quality.
