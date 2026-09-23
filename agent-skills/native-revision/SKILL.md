---
name: native-revision
description: Make localized editable musical changes while respecting part, motif and shared-dependency protection.
---

Inspect the pinned context, target part/section and current structural state. Discover details only when a device or operation needs them. Use `apply_native_batch` with stable step keys. A section development can add a counterphrase or alter a local motif instance; a rhythm request can create a variant instead of changing every occurrence; an instrument request changes the device deliberately; automation should use a short, bounded curve with clear time points.

Protected parts include their device, effects, automation, notes, source regions and dependent motifs, plus tempo/meter. Protected motifs cannot be rewritten. If the request conflicts with a lock, leave the accepted version intact and explain the structural conflict. Do not silently unlock or move a protection. After applying, inspect the new state and summarize exact changes; structural validity is not proof of how the result sounds.
