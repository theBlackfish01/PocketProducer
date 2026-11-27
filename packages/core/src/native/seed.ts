import { nativeDocumentSchema, type NativeDocument } from "./model.js";

const shortTitle = (direction: string) => {
  const clean = direction.trim();
  if (clean.length <= 42) return clean || "New construction";
  const words = clean.slice(0, 43).split(/\s+/);
  words.pop();
  return `${words.join(" ")}…`;
};

export function seedNativeDocument(direction: string): NativeDocument {
  return nativeDocumentSchema.parse({
    schemaVersion: 2, ppq: 960, mixSemantics: "channel-gain-v1", title: shortTitle(direction), direction, currentObjective: shortTitle(direction),
    assumptions: ["Structural construction only; no new audio has been rendered or heard."], tempoBpm: 96, meter: { numerator: 4, denominator: 4 }, bars: 4,
    sections: [{ id: "sketch", name: "Sketch", startBar: 0, endBar: 4, intent: "Starting point" }],
    parts: [{ id: "starting-voice", name: "Starting voice", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] }],
    motifs: [], protectedPartIds: [], protectedMotifIds: [], sourceAssetIds: [], audio: { state: "deferred", revisionId: null, assetHash: null }
  });
}
