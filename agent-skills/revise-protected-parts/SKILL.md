---
name: revise-protected-parts
description: Revise only the requested musical scope while treating protected track hashes as hard invariants.
---

# Revise protected parts

For “simplify drums; keep melody,” alter only drum events in the requested section. Melody events, assets, timing, processing and isolated stem are immutable. The application validates before/after hashes and rejects any violation. Never ask a prompt to waive a lock.

