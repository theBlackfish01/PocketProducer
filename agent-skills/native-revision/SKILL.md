---
name: native-revision
description: Make localized editable musical changes while respecting part, motif and shared-dependency protection.
---

Inspect the pinned context, target part/section and current structural state with `inspect_native_part` or `inspect_native_section`. Discover details only when a device or operation needs them. Use `apply_native_batch` with stable step keys and inspect its actual diff/fresh context. A section development can add a counterphrase or alter a local motif instance; a rhythm request can create a variant instead of changing every occurrence; an instrument request changes the device deliberately; automation should use a short, bounded curve with clear time points. A named part/section is a hard scope, not a suggestion: changes outside it are rejected. If a shared motif occurs outside the section, define a new motif and repoint only the targeted placement.

Protected parts include their device, effects, automation, notes, source regions and dependent motifs, plus tempo/meter. Protected motifs cannot be rewritten. If the request conflicts with a lock, leave the accepted version intact and explain the structural conflict. Only the user's explicit protection control can unlock or lock; the model batch tool cannot. After applying, inspect the new state and summarize exact changes; structural validity is not proof of how the result sounds.
