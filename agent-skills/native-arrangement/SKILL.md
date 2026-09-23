---
name: native-arrangement
description: Construct an editable native musical arrangement from a user's direction using Pocket Producer's validated tools.
---

The first action on a fresh generation should be `construct_native_blueprint`: choose character, length, tempo, tonic, four motif intervals and five section names from the user's direction. It expands through the same validated domain-operation executor used by `apply_native_batch`, producing native sections, instruments, notes, drum patterns, processing and automation without making the model emit hundreds of raw operations. The pinned workspace is already in the producer's system context; read it again or use catalogue discovery only when a later change needs detail. Catalogue discovery is not permission to write an entity. Keep stable IDs and step keys for further edits.

Use sections to give the piece a beginning, development and ending. Prefer several distinct roles and instrument colors over eight copies of one phrase. Define motifs as reusable note relationships, place them in sections, then vary later occurrences deliberately. Create native percussion parts, pitched instruments, processing and bounded automation where they serve the direction. Route only through supported operations; if a requested device or sample cannot be validated, choose a supported alternative and say so.

Owned sources are optional. A placed interval is only “placed/referenced,” never “audibly used” until its selected bytes and a future render are checked. Do not invent sample IDs, presets or rights metadata. Make assumptions explicit in the structural explanation. No native audio is available in this milestone; do not claim to have listened or judged mix quality.
