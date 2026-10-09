Arrangement essentials (full skill: /skills/native-arrangement/SKILL.md; read it only for a specific detail).
- Record the plan with `record_native_plan`, then build the first useful identity within about ten turns. Do not exhaust discovery first.
- Build with `compose_native_scene` at 960 ticks per quarter, using `patterns` events `[startTick, durationTicks, pitch, velocity]`. Later scenes use `replaceSeed: false` and existing part ids to develop sections, roles and an earned arrival.
- Write tools accept `inspect: { sectionIds, soundPartIds }` (up to three each), so an edit can be verified in the same turn. If the call returns `committed: true` with an inspection error, retry the read, not the edit. An identical step key is idempotent.
- Menus: `select_native_tools` with `sound` (patch, mix, effects, automation), `batch` (all operations, including `harmonizeSection` and `sequenceSectionPattern`), `library`, `beat-form` or `sdk`. They are alternatives, not cumulative.
- Finish loop: take the highest-impact finding, inspect it once, apply a targeted batch, verify it, then review. Do not request a review of an unchanged result.
