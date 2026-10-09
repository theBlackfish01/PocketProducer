import type { NativeDocument } from "./model.js";

/** A small presentation outline of stored notes and clips so lists can tell
 * arrangements apart. It is not audio, loudness or a quality judgement. */
export interface NativeFingerprint { version: 1; columns: number; lanes: Array<{ role: string; cells: number[] }> }

const COLUMNS = 32;
const MAX_LANES = 6;
const MAX_EVENTS = 20_000;

/** Cells hold the mean stored pitch per column, normalized to the part's own
 * range (0–100); -1 is a rest. Clip-only columns sit at the middle (50). */
export function nativeFingerprint(document: NativeDocument): NativeFingerprint {
  const totalTicks = document.bars * document.ppq * document.meter.numerator * 4 / document.meter.denominator;
  const column = totalTicks / COLUMNS;
  const motifs = new Map(document.motifs.map((motif) => [motif.id, motif]));
  const index = (tick: number) => Math.min(COLUMNS - 1, Math.max(0, Math.floor(tick / column)));
  let budget = MAX_EVENTS;
  const lanes = document.parts.map((part, order) => {
    const sums = Array.from({ length: COLUMNS }, () => 0), counts = Array.from({ length: COLUMNS }, () => 0), clips = Array.from({ length: COLUMNS }, () => false);
    let low = Infinity, high = -Infinity, activity = 0;
    const add = (startTick: number, durationTicks: number, pitch: number) => {
      if (budget <= 0 || startTick >= totalTicks) return;
      budget--; activity++;
      low = Math.min(low, pitch); high = Math.max(high, pitch);
      for (let cell = index(startTick); cell <= index(startTick + durationTicks - 1); cell++) { sums[cell]! += pitch; counts[cell]!++; }
    };
    for (const note of part.notes) add(note.startTick, note.durationTicks, note.pitch);
    for (const placement of part.placements) {
      const motif = motifs.get(placement.motifId);
      if (!motif) continue;
      for (let repeat = 0; repeat < placement.repeats && budget > 0; repeat++) for (const note of motif.notes) add(placement.startTick + repeat * motif.lengthTicks + note.startTick, note.durationTicks, note.pitch + placement.transpose);
    }
    for (const region of [...part.sourceRegions, ...(part.libraryRegions ?? [])]) {
      if (region.startTick >= totalTicks) continue;
      activity++;
      for (let cell = index(region.startTick); cell <= index(region.startTick + region.durationTicks - 1); cell++) clips[cell] = true;
    }
    const cells = sums.map((sum, cell) => counts[cell] ? (high > low ? Math.round((sum / counts[cell] - low) / (high - low) * 100) : 50) : clips[cell] ? 50 : -1);
    return { order, role: part.role, cells, activity };
  });
  const chosen = lanes.filter((lane) => lane.activity > 0).sort((a, b) => b.activity - a.activity || a.order - b.order).slice(0, MAX_LANES).sort((a, b) => a.order - b.order);
  return { version: 1, columns: COLUMNS, lanes: chosen.map(({ role, cells }) => ({ role, cells })) };
}

// Accepted revisions are immutable, so a bounded identity cache is safe. Callers
// must only pass revision IDs they have already read under owner scope.
const cache = new Map<string, NativeFingerprint>();
const CACHE_LIMIT = 512;
export function revisionFingerprint(revisionId: string, document: NativeDocument): NativeFingerprint {
  const cached = cache.get(revisionId);
  if (cached) { cache.delete(revisionId); cache.set(revisionId, cached); return cached; }
  const value = nativeFingerprint(document);
  cache.set(revisionId, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return value;
}
export const cachedRevisionFingerprint = (revisionId: string): NativeFingerprint | undefined => cache.get(revisionId);
