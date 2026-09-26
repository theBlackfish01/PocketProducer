import type { NativeDocument } from "./model.js";

type Curve = NativeDocument["parts"][number]["automation"][number];
type Point = Curve["points"][number];

function valueAt(points: Point[], tick: number): number | null {
  if (!points.length || tick < points[0]!.tick) return null;
  const index = points.findIndex((point) => point.tick > tick);
  if (index < 0) return points.at(-1)!.value;
  const left = points[index - 1]!, right = points[index]!;
  if ((left.interpolation ?? "step") === "step") return left.value;
  if (left.interpolation === "sloped") throw new Error("Exact local comparison of a sloped automation segment is unsupported");
  return left.value + (right.value - left.value) * (tick - left.tick) / (right.tick - left.tick);
}

// Compare the represented automation function outside [start,end), rather
// than requiring unchanged arrays. Linear and stepped segments are exact at
// every integer tick if they agree at their breakpoints and interval midpoints.
// Sloped curves are deliberately rejected when changed: the SDK's easing law
// is not inferred from its slope parameter.
export function automationOutsideEqual(before: Curve[], after: Curve[], start: number, end: number, total: number): boolean {
  const old = new Map(before.map((curve) => [curve.id, curve]));
  const next = new Map(after.map((curve) => [curve.id, curve]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id), b = next.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (!a || !b || a.target !== b.target || a.points.some((point) => point.interpolation === "sloped") || b.points.some((point) => point.interpolation === "sloped")) return false;
    if (start > 0 && (a.points[0]!.tick > start || b.points[0]!.tick > start)) return false;
    const ticks = new Set([0, Math.max(0, start - 1), end, total]);
    for (const point of [...a.points, ...b.points]) for (const tick of [point.tick - 1, point.tick, point.tick + 1]) if (tick >= 0 && tick <= total) ticks.add(tick);
    const sorted = [...ticks].filter((tick) => tick < start || tick >= end).sort((x, y) => x - y);
    const probes = [...sorted];
    for (let i = 1; i < sorted.length; i++) {
      const left = sorted[i - 1]!, right = sorted[i]!;
      if ((left < start && right < start) || (left >= end && right >= end)) probes.push(Math.floor((left + right) / 2));
    }
    if (probes.some((tick) => { const x = valueAt(a.points, tick), y = valueAt(b.points, tick); return x === null || y === null ? x !== y : Math.abs(x - y) > 1e-7; })) return false;
  }
  return true;
}

// Used for a "keep this role in this section" promise. Curves with changed
// sloped easing are not asserted equivalent from sparse points alone.
export function automationInsideEqual(before: Curve[], after: Curve[], start: number, end: number): boolean {
  const old = new Map(before.map((curve) => [curve.id, curve]));
  const next = new Map(after.map((curve) => [curve.id, curve]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id), b = next.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (!a || !b || a.target !== b.target || a.points.some((point) => point.interpolation === "sloped") || b.points.some((point) => point.interpolation === "sloped")) return false;
    const ticks = new Set([start, end - 1]);
    for (const point of [...a.points, ...b.points]) for (const tick of [point.tick - 1, point.tick, point.tick + 1]) if (tick >= start && tick < end) ticks.add(tick);
    const sorted = [...ticks].sort((x, y) => x - y);
    for (let index = 1; index < sorted.length; index++) ticks.add(Math.floor((sorted[index - 1]! + sorted[index]!) / 2));
    if ([...ticks].some((tick) => { const x = valueAt(a.points, tick), y = valueAt(b.points, tick); return x === null || y === null ? x !== y : Math.abs(x - y) > 1e-7; })) return false;
  }
  return true;
}

export function spliceSectionAutomation(curve: Curve, points: Point[], start: number, end: number): Curve {
  if (points.length < 2 || points[0]!.tick !== start || points.at(-1)!.tick !== end || points.some((point) => point.tick < start || point.tick > end)) throw new Error("Section automation needs exact start/end boundary points and an interior shape");
  if (curve.points.some((point) => point.interpolation === "sloped")) throw new Error("Sloped automation cannot be split without changing its outside easing; use an explicit full-curve edit");
  if (curve.points[0]!.tick > start) throw new Error("Existing automation has no defined value at the section start");
  const startValue = valueAt(curve.points, start);
  const endValue = valueAt(curve.points, end);
  const left = [...curve.points].reverse().find((point) => point.tick < start);
  if (left && (left.interpolation ?? "step") !== "step" && Math.abs(points[0]!.value - startValue!) > 1e-7) throw new Error("Start boundary must retain the earlier linear ramp's value");
  if (endValue !== null && Math.abs(points.at(-1)!.value - endValue) > 1e-7) throw new Error("End boundary must retain the later automation value");
  const updated = { ...curve, points: [...curve.points.filter((point) => point.tick < start), ...points, ...curve.points.filter((point) => point.tick > end)] };
  if (!automationOutsideEqual([curve], [updated], start, end, Math.max(end, curve.points.at(-1)!.tick))) throw new Error("Local automation edit would change values outside the selected section");
  return updated;
}
