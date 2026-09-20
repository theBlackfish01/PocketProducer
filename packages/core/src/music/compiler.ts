import type { ArrangementPlan, Composition, Track } from "../domain/composition.js";

const PPQ = 960;
const BAR = PPQ * 4;

function event(id: string, assetId: string, startTick: number, durationTicks: number, gainDb = 0) {
  return { id, assetId, startTick, durationTicks, gainDb };
}

export function compileArrangement(plan: ArrangementPlan, sourceAssetId?: string, seed = 20260920): Composition {
  const bars = 16;
  const durationTicks = bars * BAR;
  const drumEvents: Track["events"] = [];
  const bassEvents: Track["events"] = [];
  const melodyEvents: Track["events"] = [];
  const textureEvents: Track["events"] = [];
  let index = 0;

  for (let bar = 0; bar < bars; bar += 1) {
    const sectionDensity = bar < 2 ? 0.45 : bar >= 12 ? 0.55 : bar >= 8 ? 1 : 0.8;
    const base = bar * BAR;
    drumEvents.push(event(`kick-${index++}`, "builtin:kick", base, PPQ / 2, -2));
    if (bar > 0) drumEvents.push(event(`kick-${index++}`, "builtin:kick", base + PPQ * 2, PPQ / 2, -3));
    if (bar >= 2 && bar < 15) {
      drumEvents.push(event(`snare-${index++}`, "builtin:snare", base + PPQ, PPQ / 2, -4));
      drumEvents.push(event(`snare-${index++}`, "builtin:snare", base + PPQ * 3, PPQ / 2, -4));
    }
    const hats = Math.max(2, Math.round(8 * plan.drumDensity * sectionDensity));
    for (let hit = 0; hit < hats; hit += 1) {
      const position = base + Math.round((hit * BAR) / hats);
      drumEvents.push(event(`hat-${index++}`, "builtin:hat", position, PPQ / 4, hit % 2 === 0 ? -10 : -14));
    }
    if (bar >= 2 && bar < 14) {
      const roots = ["C2", "Eb2", "Bb1", "F2"];
      const root = roots[bar % roots.length] ?? "C2";
      bassEvents.push(event(`bass-${bar}-a`, `builtin:bass:${root}`, base, PPQ * 2, -8));
      if (plan.bassMotion > 0.55) bassEvents.push(event(`bass-${bar}-b`, `builtin:bass:${root}`, base + PPQ * 2, PPQ * 2, -10));
    }
  }

  const motif = plan.melodyContour === "rising" ? [60, 63, 67, 70] : plan.melodyContour === "falling" ? [70, 67, 63, 60] : [60, 67, 63, 70];
  for (let bar = 2; bar < 14; bar += 2) {
    motif.forEach((note, step) => {
      melodyEvents.push(event(`melody-${bar}-${step}`, `builtin:melody:${note}`, bar * BAR + step * PPQ, Math.round(PPQ * 0.82), -10));
    });
  }

  if (sourceAssetId && plan.sourceRole !== "none") {
    const starts = plan.sourceRole === "percussion" ? [0, 4, 8, 12] : [2, 6, 10, 14];
    for (const bar of starts) textureEvents.push(event(`source-${bar}`, `source:${sourceAssetId}`, bar * BAR, BAR, -9));
  }

  const tracks: Track[] = [
    { id: "drums", role: "drums", gainDb: -3, pan: 0, events: drumEvents },
    { id: "bass", role: "bass", gainDb: -6, pan: 0, events: bassEvents },
    { id: "melody", role: "melody", gainDb: -8, pan: 0.08, events: melodyEvents }
  ];
  if (textureEvents.length > 0) tracks.push({ id: "texture", role: "texture", gainDb: -5, pan: -0.12, events: textureEvents });

  return {
    schemaVersion: 1,
    ppq: PPQ,
    tempoBpm: plan.tempoBpm,
    timeSignature: { numerator: 4, denominator: 4 },
    durationTicks,
    tailSeconds: 1,
    seed,
    palette: "sunroom",
    sourceAssetIds: sourceAssetId ? [sourceAssetId] : [],
    sections: [
      { id: "intro", name: "Intro", startTick: 0, endTick: BAR * 2 },
      { id: "groove", name: "Groove", startTick: BAR * 2, endTick: BAR * 8 },
      { id: "lift", name: "Lift", startTick: BAR * 8, endTick: BAR * 12 },
      { id: "outro", name: "Outro", startTick: BAR * 12, endTick: durationTicks }
    ],
    tracks
  };
}

export function simplifyDrums(base: Composition): { composition: Composition; removed: number } {
  const groove = base.sections.find((section) => section.id === "groove");
  if (!groove) throw new Error("Composition has no Groove section");
  let removed = 0;
  const tracks = base.tracks.map((track) => {
    if (track.id !== "drums") return structuredClone(track);
    let hatIndex = 0;
    const events = track.events.filter((item) => {
      const inScope = item.startTick >= groove.startTick && item.startTick < groove.endTick;
      if (!inScope || !item.assetId.includes(":hat")) return true;
      hatIndex += 1;
      const keep = hatIndex % 2 === 1;
      if (!keep) removed += 1;
      return keep;
    });
    return { ...structuredClone(track), events };
  });
  return { composition: { ...structuredClone(base), tracks }, removed };
}

