import { barTicks, materializedNotes, type NativeDocument } from "./model.js";
import { automationValueAt } from "./section.js";

// Structural evidence only: a connected feedback/room-size control decreased.
// This is not a measurement of the unheard acoustic tail.
export function hasShorterConnectedAmbience(before: NativeDocument, after: NativeDocument, sectionId?: string | null): boolean {
  const section = before.sections.find((value) => value.id === sectionId);
  const start = section ? section.startBar * barTicks(before) : 0;
  const end = section ? section.endBar * barTicks(before) : before.bars * barTicks(before);
  type Chain = { effects?: NativeDocument["parts"][number]["effects"] | undefined; parallel?: NativeDocument["parts"][number]["parallel"] | undefined; automation?: NativeDocument["parts"][number]["automation"] | undefined };
  const reduction = (old: Chain, next: Chain): boolean => {
    const effects = (chain: Chain) => [...(chain.effects ?? []), ...(chain.parallel?.effects ?? [])];
    return effects(old).some((effect) => {
      if (!["stompboxReverb", "stompboxDelay", "stompboxPitchDelay"].includes(effect.type)) return false;
      const updated = effects(next).find((value) => value.id === effect.id && value.type === effect.type);
      if (!updated) return false;
      const parallel = old.parallel?.effects.some((value) => value.id === effect.id);
      if (parallel !== next.parallel?.effects.some((value) => value.id === effect.id)) return false;
      const controls = effect.type === "stompboxReverb" ? ["roomSizeFactor", "feedbackFactor"] as const : ["feedbackFactor"] as const;
      const valueAt = (chain: Chain, target: string, baseline: number, tick: number) => {
        const curve = chain.automation?.find((item) => item.target === target);
        return curve ? automationValueAt(curve.points, tick) ?? baseline : baseline;
      };
      return controls.some((control) => {
        const beforeControl = effect.parameters[control], afterControl = updated.parameters[control];
        if (beforeControl === undefined || afterControl === undefined) return false;
        const targets = [`effect.${effect.id}.${control}`, `effect.${effect.id}.mix`, ...(parallel ? ["parallel.wetMix"] : [])];
        const curves = [...(old.automation ?? []), ...(next.automation ?? [])].filter((curve) => targets.includes(curve.target));
        if (curves.some((curve) => curve.points.some((point) => point.interpolation === "sloped"))) return false;
        const boundaries = [...new Set([start, end - 1, ...curves.flatMap((curve) => curve.points.map((point) => point.tick)).filter((tick) => tick >= start && tick < end)])].sort((x, y) => x - y);
        return boundaries.some((tick) => {
          const oldWet = valueAt(old, `effect.${effect.id}.mix`, effect.parameters.mix ?? 1, tick) * (parallel ? valueAt(old, "parallel.wetMix", old.parallel?.wetMix ?? 0, tick) : 1);
          const newWet = valueAt(next, `effect.${effect.id}.mix`, updated.parameters.mix ?? 1, tick) * (parallel ? valueAt(next, "parallel.wetMix", next.parallel?.wetMix ?? 0, tick) : 1);
          return oldWet > 1e-7 && newWet > 1e-7 && valueAt(next, `effect.${effect.id}.${control}`, afterControl, tick) < valueAt(old, `effect.${effect.id}.${control}`, beforeControl, tick) - 1e-7;
        });
      });
    });
  };
  return before.parts.some((part) => {
    const next = after.parts.find((value) => value.id === part.id);
    const hasMaterial = materializedNotes(before, part.id).some((note) => note.startTick < end && note.startTick + note.durationTicks > start) || [...part.sourceRegions, ...(part.libraryRegions ?? [])].some((clip) => clip.startTick < end && clip.startTick + clip.durationTicks > start);
    if (!next || !hasMaterial) return false;
    if (reduction(part, next)) return true;
    let groupId = part.groupId;
    const seen = new Set<string>();
    while (groupId && !seen.has(groupId)) {
      seen.add(groupId);
      const group = before.groups?.find((value) => value.id === groupId), updated = after.groups?.find((value) => value.id === groupId);
      if (!group) break;
      // Require the part still to pass through this group.
      let nextId = next.groupId;
      const nextSeen = new Set<string>();
      while (nextId && nextId !== groupId && !nextSeen.has(nextId)) { nextSeen.add(nextId); nextId = after.groups?.find((value) => value.id === nextId)?.parentId; }
      if (updated && nextId === groupId && reduction(group, updated)) return true;
      groupId = group.parentId;
    }
    const connected = (id: string) => part.sends?.some((send) => send.busId === id && send.gain > 0) && next.sends?.some((send) => send.busId === id && send.gain > 0);
    if (before.delayBus && after.delayBus?.id === before.delayBus.id && connected(before.delayBus.id) && after.delayBus.feedbackFactor < before.delayBus.feedbackFactor) return true;
    return !!(before.reverbBus && after.reverbBus?.id === before.reverbBus.id && connected(before.reverbBus.id) && after.reverbBus.roomSize < before.reverbBus.roomSize);
  });
}
