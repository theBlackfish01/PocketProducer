import { canonicalHash } from "../domain/hash.js";
import { applyNativeOperations, nativeDocumentSchema } from "./model.js";
import { nativeFormOperations, nativeFormSchema } from "./form.js";

// Original, short executable references. They are retrieval material, never
// automatic templates for a user's score and never evidence of heard quality.
const examples = [
  { id: "spare-answer", title: "A phrase and its shadow", tags: ["sparse", "melody", "space"], purpose: "A memorable gap and a quieter answer carry identity without adding density.",
    form: { tempoBpm: 78, bars: [8, 8, 8], sections: ["Invitation", "Shadow", "Return"], device: "heisenberg", role: "melody", pitches: [64, 67, 62, 69], beats: [0, 2.5, 5, 7.5], gain: 0.55, cutoff: 2100 } },
  { id: "groove-cut", title: "Found-pulse conversation", tags: ["sample", "groove", "rhythm"], purpose: "A short selected hit can answer a pitched bass; choose a permitted source and exact interval before placing it.",
    form: { tempoBpm: 104, bars: [4, 8, 4], sections: ["Found", "Conversation", "Break"], device: "pulverisateur", role: "bass", pitches: [36, 36, 43, 39], beats: [0, 1.75, 4, 6.75], gain: 0.69, cutoff: 720 }, sourceRequirement: "Accessible owned or Audiotool-library one-shot; inspect bytes/rights, then replace or layer the pulse with exact source offsets." },
  { id: "operator-ascent", title: "Operator ascent", tags: ["synth", "fm", "build"], purpose: "A widening pitch sequence and filter movement can mark a middle ascent without copying a stock drop.",
    form: { tempoBpm: 122, bars: [8, 8, 8], sections: ["Pulse", "Rise", "Release"], device: "heisenberg", role: "lead", pitches: [60, 63, 67, 72], beats: [0, 2, 4, 6], gain: 0.66, cutoff: 2800 } },
  { id: "turnaround", title: "The one-beat hinge", tags: ["transition", "contrast", "silence"], purpose: "A late pickup and a gap before the return can define a transition more clearly than extra layers.",
    form: { tempoBpm: 96, bars: [4, 8, 4], sections: ["Statement", "Suspension", "Arrival"], device: "gakki", role: "melody", pitches: [60, 67, 64, 72], beats: [0, 3, 7.5, 11], gain: 0.61, cutoff: null } },
  { id: "motif-handoff", title: "Same contour, new speaker", tags: ["motif", "handoff", "development"], purpose: "Keep the interval identity while changing register and instrument in a later section.",
    form: { tempoBpm: 88, bars: [8, 8, 8], sections: ["Call", "Answer", "Reprise"], device: "gakki", role: "melody", pitches: [57, 60, 64, 62], beats: [0, 2, 4, 7], gain: 0.56, cutoff: null } },
  { id: "overbusy-counterexample", title: "When every beat speaks", tags: ["failure", "overbusy", "restraint"], purpose: "A structurally valid but crowded phrase. Compare with spare-answer: leave rests, change register or remove duplicate attacks rather than adding another part.",
    form: { tempoBpm: 118, bars: [8, 8], sections: ["Crowded", "Crowded again"], device: "heisenberg", role: "melody", pitches: [60, 62, 64, 65, 67, 69, 71, 72], beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], gain: 0.8, cutoff: 3200 } }
] as const;

function execute(example: typeof examples[number]) {
  const sections = example.form.sections.map((name, index) => ({ id: `section-${index}`, name, bars: example.form.bars[index]!, intent: example.purpose.slice(0, 180) }));
  const notes = example.form.pitches.map((pitch, index) => ({ beat: example.form.beats[index]!, durationBeats: 0.45, pitch, velocity: Math.min(0.95, 0.54 + index * 0.045) }));
  const form = nativeFormSchema.parse({ title: example.title, tempoBpm: example.form.tempoBpm, meter: { numerator: 4, denominator: 4 }, sections,
    parts: [{ id: "main", name: example.title, role: example.form.role, device: { type: example.form.device, parameters: example.form.cutoff === null ? {} : { "filter.cutoffFrequencyHz": example.form.cutoff } }, gain: example.form.gain, pan: 0,
      motifs: [{ id: "identity", name: "Identity", lengthBeats: 16, notes }], placements: [{ id: "opening", motifId: "identity", startBar: 0, repeats: 1 }, { id: "return", motifId: "identity", startBar: example.form.bars[0], repeats: 1 }] }] });
  const operations = nativeFormOperations(form, []);
  const seed = nativeDocumentSchema.parse({ schemaVersion: 2, ppq: 960, title: example.title, direction: example.purpose, currentObjective: example.purpose, assumptions: ["Unheard educational reference"], tempoBpm: 96, meter: { numerator: 4, denominator: 4 }, bars: 4,
    sections: [{ id: "sketch", name: "Sketch", startBar: 0, endBar: 4, intent: "Starting point" }], parts: [{ id: "starting-voice", name: "Starting voice", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] }], motifs: [], protectedPartIds: [], protectedMotifIds: [], sourceAssetIds: [], audio: { state: "deferred", revisionId: null, assetHash: null } });
  const document = applyNativeOperations(seed, operations);
  return { form, documentHash: canonicalHash(document), sectionMap: document.sections.map((section) => ({ id: section.id, name: section.name, firstBar: section.startBar, lastBar: section.endBar })), motifMap: document.motifs.map((motif) => ({ id: motif.id, notes: motif.notes.length })) };
}

export function searchNativeExamples(query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return examples.filter((example) => !terms.length || terms.some((term) => `${example.tags.join(" ")} ${example.purpose} ${example.title}`.toLowerCase().includes(term)))
    .slice(0, 4).map((example) => ({ id: example.id, title: example.title, tags: example.tags, purpose: example.purpose, heard: false }));
}

export function readNativeExample(id: string) {
  const example = examples.find((item) => item.id === id);
  if (!example) throw new Error("Unknown musical reference ID; search examples first");
  return { id: example.id, title: example.title, purpose: example.purpose, heard: false, useAs: "Adapt the relationship, not its notes or form", sourceRequirement: "sourceRequirement" in example ? example.sourceRequirement : null, ...execute(example) };
}
