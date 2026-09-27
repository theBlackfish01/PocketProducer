import { canonicalHash } from "../domain/hash.js";
import { applyNativeOperations, nativeDocumentSchema } from "./model.js";
import { nativeFormOperations, nativeFormSchema } from "./form.js";
import { readNativeRecipe } from "./resources.js";

// Original, short executable references. They are retrieval material, never
// automatic templates for a user's score and never evidence of heard quality.

const motif = (id: string, name: string, lengthBeats: number, events: Array<[number, number, number, number]>) => ({ id, name, lengthBeats, notes: events.map(([beat, pitch, durationBeats, velocity]) => ({ beat: Math.round(beat * 960) / 960, pitch, durationBeats: id === "pulse" || id === "rise-pulse" ? 0.25 : Math.round(durationBeats * 960) / 960, velocity: id === "pulse" || id === "rise-pulse" ? 1 : velocity })) });
const drumEvents: Array<[number, number, number, number]> = [
  [0, 36, 0.22, 0.95], [0.5, 42, 0.18, 0.55], [1, 38, 0.22, 0.78], [1.5, 42, 0.18, 0.48],
  [2, 36, 0.22, 0.9], [2.5, 42, 0.18, 0.58], [3, 38, 0.22, 0.82], [3.5, 42, 0.18, 0.5],
  [4, 36, 0.22, 0.96], [4.5, 42, 0.18, 0.54], [5, 38, 0.22, 0.78], [5.5, 42, 0.18, 0.5],
  [6, 36, 0.22, 0.9], [6.5, 42, 0.18, 0.61], [7, 38, 0.22, 0.84], [7.5, 46, 0.18, 0.57]
];
const recipeDevice = (id: string) => readNativeRecipe(id).device;
const productionExamples = [
  {
    id: "disco-groove-study", title: "Pocket pulse and chord replies", tags: ["synth", "disco", "groove", "bass", "chords"],
    purpose: "An eight-bar study: syncopated bass creates a pocket against fixed drum steps while offbeat chords answer; the second half changes the melodic reply.",
    form: nativeFormSchema.parse({ title: "Pocket pulse study", tempoBpm: 118, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "pocket", name: "Pocket", bars: 4, intent: "Set a syncopated bass and clipped chord conversation" }, { id: "reply", name: "Reply", bars: 4, intent: "Keep the pocket but change the answer" }],
      reverbBus: { id: "shared-room", name: "Shared room", roomSize: 0.44, preDelayMs: 32, damp: 0.38 },
      parts: [
        { id: "drums", name: "Dry steps", role: "percussion", device: recipeDevice("dry-step-kit"), gain: 0.72, pan: 0, motifs: [motif("pulse", "Four-on-floor with hat lift", 8, drumEvents)], placements: [{ id: "pulse-all", motifId: "pulse", startBar: 0, repeats: 4 }] },
        { id: "bass", name: "Rubber bass", role: "bass", device: recipeDevice("rubber-pulse"), gain: 0.74, pan: 0, motifs: [motif("bass-question", "Syncopated bass question", 8, [[0, 36, 0.65, 0.9], [1.75, 36, 0.35, 0.66], [3, 43, 0.55, 0.8], [4.5, 39, 0.7, 0.83], [6.75, 43, 0.34, 0.62]])], placements: [{ id: "bass-all", motifId: "bass-question", startBar: 0, repeats: 4 }] },
        { id: "keys", name: "Offbeat stabs", role: "harmony", device: recipeDevice("bright-stabs"), gain: 0.58, pan: -0.13, sends: [{ busId: "shared-room", gain: 0.12 }], motifs: [motif("stabs", "Two clipped chord replies", 8, [[1.5, 60, 0.38, 0.67], [1.5, 64, 0.38, 0.63], [1.5, 67, 0.38, 0.6], [5.5, 58, 0.38, 0.7], [5.5, 62, 0.38, 0.64], [5.5, 65, 0.38, 0.6]])], placements: [{ id: "stabs-all", motifId: "stabs", startBar: 0, repeats: 4 }] },
        { id: "lead", name: "Melodic reply", role: "lead", device: recipeDevice("airline"), gain: 0.48, pan: 0.15, sends: [{ busId: "shared-room", gain: 0.18 }], motifs: [motif("lead-call", "Call", 8, [[0.5, 72, 0.5, 0.72], [2.25, 76, 0.55, 0.8], [3.25, 74, 0.45, 0.68]]), motif("lead-answer", "Lower answer", 8, [[0.75, 69, 0.65, 0.62], [2.5, 72, 0.35, 0.74], [5.25, 67, 0.8, 0.6]])], placements: [{ id: "lead-first", motifId: "lead-call", startBar: 0, repeats: 2 }, { id: "lead-second", motifId: "lead-answer", startBar: 4, repeats: 2 }] }
      ] })
  },
  {
    id: "disco-rise-study", title: "A rise that earns its arrival", tags: ["synth", "disco", "build", "payoff", "development"],
    purpose: "A 16-bar development of the pocket: an established groove, a different reply, a rising middle with changing notes and filter movement, then a marked arrival.",
    form: nativeFormSchema.parse({ title: "Rise and arrival study", tempoBpm: 118, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "pocket", name: "Pocket", bars: 4, intent: "A stable syncopated groove" }, { id: "answer", name: "Answer", bars: 4, intent: "Change the melodic response without losing the bass" }, { id: "rise", name: "Rise", bars: 4, intent: "Climb in register and density with purposeful filter movement" }, { id: "arrival", name: "Arrival", bars: 4, intent: "Release tension with a brighter chord and memorable lead answer" }],
      reverbBus: { id: "shared-room", name: "Shared room", roomSize: 0.52, preDelayMs: 40, damp: 0.33 }, delayBus: { id: "short-echo", name: "Short echo", feedbackFactor: 0.27, stepCount: 2, stepLengthIndex: 2 },
      parts: [
        { id: "drums", name: "Dry steps", role: "percussion", device: recipeDevice("dry-step-kit"), gain: 0.72, pan: 0, motifs: [motif("pulse", "Steady pulse", 8, drumEvents), motif("rise-pulse", "Rising hat activity", 8, [...drumEvents, [7.75, 42, 0.18, 0.56]])], placements: [{ id: "drums-a", motifId: "pulse", startBar: 0, repeats: 4 }, { id: "drums-b", motifId: "rise-pulse", startBar: 8, repeats: 2 }, { id: "drums-c", motifId: "pulse", startBar: 12, repeats: 2 }] },
        { id: "bass", name: "Rubber bass", role: "bass", device: recipeDevice("rubber-pulse"), gain: 0.72, pan: 0, motifs: [motif("bass-question", "Pocket identity", 8, [[0, 36, 0.65, 0.9], [1.75, 36, 0.35, 0.68], [3, 43, 0.55, 0.82], [4.5, 39, 0.7, 0.86], [6.75, 43, 0.34, 0.67]])], placements: [{ id: "bass-all", motifId: "bass-question", startBar: 0, repeats: 8 }] },
        { id: "keys", name: "Offbeat stabs", role: "harmony", device: recipeDevice("bright-stabs"), gain: 0.58, pan: -0.13, sends: [{ busId: "shared-room", gain: 0.18 }], motifs: [motif("stabs", "Clipped offbeats", 8, [[1.5, 60, 0.38, 0.67], [1.5, 64, 0.38, 0.63], [1.5, 67, 0.38, 0.6], [5.5, 58, 0.38, 0.7], [5.5, 62, 0.38, 0.64], [5.5, 65, 0.38, 0.6]]), motif("arrival-chord", "Brighter arrival", 8, [[0, 60, 2.5, 0.8], [0, 64, 2.5, 0.75], [0, 67, 2.5, 0.73], [4, 65, 1.5, 0.75], [4, 69, 1.5, 0.71]])], placements: [{ id: "keys-a", motifId: "stabs", startBar: 0, repeats: 6 }, { id: "keys-b", motifId: "arrival-chord", startBar: 12, repeats: 2 }], automation: [{ id: "keys-rise", target: "device.filter.cutoffFrequencyHz", points: [{ tick: 8 * 3840, value: 0.25 }, { tick: 12 * 3840, value: 0.82 }] }] },
        { id: "lead", name: "Counterline", role: "lead", device: recipeDevice("airline"), gain: 0.48, pan: 0.15, sends: [{ busId: "short-echo", gain: 0.16 }], motifs: [motif("call", "Three-note call", 8, [[0.5, 72, 0.5, 0.72], [2.25, 76, 0.55, 0.8], [3.25, 74, 0.45, 0.68]]), motif("answer", "Lower answer", 8, [[0.75, 69, 0.65, 0.62], [2.5, 72, 0.35, 0.74], [5.25, 67, 0.8, 0.6]]), motif("climb", "Stepwise rise", 8, [[0, 72, 0.5, 0.67], [1.5, 74, 0.45, 0.7], [3, 76, 0.45, 0.76], [4.5, 79, 0.45, 0.82], [6, 81, 0.75, 0.88]]), motif("payoff", "Arrival answer", 8, [[0, 84, 1.5, 0.9], [2.5, 79, 0.55, 0.76], [4, 76, 0.6, 0.71], [6, 72, 1.2, 0.78]])], placements: [{ id: "lead-a", motifId: "call", startBar: 0, repeats: 2 }, { id: "lead-b", motifId: "answer", startBar: 4, repeats: 2 }, { id: "lead-c", motifId: "climb", startBar: 8, repeats: 2 }, { id: "lead-d", motifId: "payoff", startBar: 12, repeats: 2 }] }
      ] })
  },
  {
    id: "sparse-motif-handoff", title: "A phrase changes hands", tags: ["sparse", "motif", "handoff", "development", "space"],
    purpose: "A short melody leaves actual rests, moves to another instrument in the middle, then returns with a restrained lower response. One proven motif family links the handoff.",
    form: nativeFormSchema.parse({ title: "A phrase changes hands", tempoBpm: 84, meter: { numerator: 4, denominator: 4 }, sections: [
      { id: "call", name: "Call", bars: 4, intent: "Establish a quiet interval contour and leave space" },
      { id: "handoff", name: "Handoff", bars: 4, intent: "Change the speaker, not the theme" },
      { id: "return", name: "Return", bars: 4, intent: "Bring back the contour below its first register" }
    ], reverbBus: { id: "shared-room", name: "Shared room", roomSize: 0.42, preDelayMs: 28, damp: 0.48 }, parts: [
      { id: "lead", name: "Soft lead", role: "melody", device: recipeDevice("airline"), gain: 0.46, pan: -0.15, sends: [{ busId: "shared-room", gain: 0.18 }], motifs: [motif("shared-call", "Three-note identity", 8, [[0, 64, 0.8, 0.64], [2.5, 67, 0.6, 0.71], [5.5, 62, 1.1, 0.59]])], placements: [{ id: "lead-opening", motifId: "shared-call", startBar: 0, repeats: 2 }, { id: "lead-return", motifId: "shared-call", startBar: 8, repeats: 2, transpose: -5 }] },
      { id: "keys", name: "Glass answer", role: "harmony", device: recipeDevice("soft-glass"), gain: 0.43, pan: 0.18, sends: [{ busId: "shared-room", gain: 0.21 }], motifs: [], placements: [] }
    ] }),
    extraOperations: [{ kind: "handoffMotif", sourceMotifId: "shared-call", targetPartId: "keys", newMotifId: "glass-call", name: "Theme on glass keys", placementId: "glass-middle", startTick: 4 * 3840, repeats: 2, transpose: 7 }] as const
  }
] as const;

function seed(title: string, purpose: string) {
  return nativeDocumentSchema.parse({ schemaVersion: 2, ppq: 960, mixSemantics: "channel-gain-v1", title, direction: purpose, currentObjective: purpose, assumptions: ["Unheard educational reference"], tempoBpm: 96, meter: { numerator: 4, denominator: 4 }, bars: 4,
    sections: [{ id: "sketch", name: "Sketch", startBar: 0, endBar: 4, intent: "Starting point" }], parts: [{ id: "starting-voice", name: "Starting voice", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] }], motifs: [], protectedPartIds: [], protectedMotifIds: [], sourceAssetIds: [], audio: { state: "deferred", revisionId: null, assetHash: null } });
}

export function searchNativeExamples(query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return productionExamples.filter((example) => !terms.length || terms.some((term) => `${example.tags.join(" ")} ${example.purpose} ${example.title}`.toLowerCase().includes(term)))
    .slice(0, 4).map((example) => ({ id: example.id, title: example.title, tags: example.tags, purpose: example.purpose, heard: false }));
}

export function readNativeExample(id: string) {
  const production = productionExamples.find((item) => item.id === id);
  if (production) {
    const extraOperations = "extraOperations" in production ? production.extraOperations.map((operation) => ({ ...operation })) : [];
    const document = applyNativeOperations(seed(production.title, production.purpose), [...nativeFormOperations(production.form, []), ...extraOperations]);
    return { id: production.id, title: production.title, purpose: production.purpose, heard: false, useAs: "Study the implemented relationship, not its notes or form", sourceRequirement: null, form: production.form, extraOperations, documentHash: canonicalHash(document), sectionMap: document.sections.map((section) => ({ id: section.id, name: section.name, firstBar: section.startBar, lastBar: section.endBar })), motifMap: document.motifs.map((item) => ({ id: item.id, familyId: item.familyId ?? item.id, notes: item.notes.length })) };
  }
  throw new Error("Unknown musical reference ID; search examples first");
}
