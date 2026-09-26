import { z } from "zod";
import { canonicalHash } from "../domain/composition.js";
import { spliceSectionAutomation } from "./section.js";

export const NATIVE_PPQ = 960;
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
// Curated against the pinned Nexus 0.0.17 schema. Values are SDK field values,
// not inferred physical units (for example, compressor.ratio is normalized).
export const nativeParameterRanges = {
  heisenberg: { gain: [0, 1], tuneSemitones: [-12, 12], playModeIndex: [1, 4], glideMs: [0, 5000], velocityFactor: [0, 1], unisonoCount: [1, 4], unisonoDetuneSemitones: [0, 1], unisonoStereoSpreadFactor: [-1, 1],
    "operatorA.gain": [0, 1], "operatorB.gain": [0, 1], "operatorC.gain": [0, 1], "operatorD.gain": [0, 1], "operatorA.waveformIndex": [1, 49], "operatorB.waveformIndex": [1, 49], "operatorC.waveformIndex": [1, 49], "operatorD.waveformIndex": [1, 49],
    "operatorA.detuneFactor": [0, 64], "operatorB.detuneFactor": [0, 64], "operatorC.detuneFactor": [0, 64], "operatorD.detuneFactor": [0, 64],
    "operatorA.frequencyOffsetHz": [-9999.99, 9999.99], "operatorB.frequencyOffsetHz": [-9999.99, 9999.99], "operatorC.frequencyOffsetHz": [-9999.99, 9999.99], "operatorD.frequencyOffsetHz": [-9999.99, 9999.99],
    "operatorA.modulationFactorB": [0, 1], "operatorA.modulationFactorC": [0, 1], "operatorA.modulationFactorD": [0, 1], "operatorB.modulationFactorA": [0, 1], "operatorB.modulationFactorC": [0, 1], "operatorB.modulationFactorD": [0, 1], "operatorC.modulationFactorA": [0, 1], "operatorC.modulationFactorB": [0, 1], "operatorC.modulationFactorD": [0, 1], "operatorD.modulationFactorA": [0, 1], "operatorD.modulationFactorB": [0, 1], "operatorD.modulationFactorC": [0, 1],
    "operatorA.envelope2AmplitudeModulationDepth": [0, 1], "operatorB.envelope2AmplitudeModulationDepth": [0, 1], "operatorC.envelope2AmplitudeModulationDepth": [0, 1], "operatorD.envelope2AmplitudeModulationDepth": [0, 1], "lfo1.rateNormalized": [0, 1], "lfo2.rateNormalized": [0, 1],
    "filter.cutoffFrequencyHz": [33, 22050], "filter.resonance": [0.70710677, 60], "filter.keyboardTrackingAmount": [-1, 1],
    "envelopeMain.attackTimeNormalized": [0, 1], "envelopeMain.decayTimeNormalized": [0, 1], "envelopeMain.sustainRangeFactor": [-1, 1], "envelopeMain.releaseTimeNormalized": [0, 1] },
  pulverisateur: { gain: [0, 1], tuneSemitones: [-12, 12], playModeIndex: [1, 2], glideTimeMs: [0, 10000], "audio.drive": [0, 1],
    "filter.cutoffFrequencyHz": [18, 15500], "filter.resonance": [0, 1], "filter.filterSpacing": [-1, 1], "filter.modeIndex": [1, 2] },
  gakki: { gain: [0, 1] },
  beatbox8: { gain: [0, 1], accentAmount: [0, 1], "bassdrum.gain": [0, 1], "bassdrum.tone": [0, 1], "bassdrum.decay": [0, 1], "snaredrum.gain": [0, 1], "snaredrum.tone": [0, 1], "snaredrum.snappy": [0, 1], "openHihat.decay": [0, 1] },
  audio: {},
  stompboxDelay: { feedbackFactor: [0, 1], mix: [0, 1], stepCount: [1, 7], stepLengthIndex: [1, 3] },
  stompboxReverb: { roomSizeFactor: [0, 1], preDelayTimeMs: [8, 500], feedbackFactor: [0, 1], mix: [0, 1] },
  stompboxCompressor: { thresholdDb: [-24, 0], ratio: [0, 1], attackMs: [0, 200], releaseMs: [0, 1000], makeupGainDb: [0, 24] },
  stompboxParametricEqualizer: { frequencyHz: [31, 12000], postGainDb: [-12, 12], bandwidthFactor: [0, 1] },
  autoFilter: { cutoffFrequencyHz: [18, 10000], mix: [0, 1], filterModulationDepth: [0, 1] },
  stompboxTube: { drive: [0.1, 12], tone: [-10, 10], postGain: [0, 2] },
  stompboxChorus: { delayTimeMs: [20, 40], feedbackFactor: [0, 1], lfoFrequencyHz: [0.1, 5], lfoModulationDepth: [0, 1], spreadFactor: [0, 1] },
  stompboxPitchDelay: { stepCount: [1, 7], stepLengthIndex: [1, 3], feedbackFactor: [0, 1], tuneFactor: [-1, 1], mix: [0, 1] }
} as const;
type ParameterDevice = keyof typeof nativeParameterRanges;
function mappedParameters(type: ParameterDevice, values: Record<string, number>, context: z.RefinementCtx): void {
  const ranges = nativeParameterRanges[type] as Record<string, readonly [number, number]>;
  for (const [key, value] of Object.entries(values)) {
    const range = ranges[key];
    if (!range || !Number.isFinite(value) || value < range[0] || value > range[1] || (/Index$|Count$/.test(key) && !Number.isInteger(value)))
      context.addIssue({ code: "custom", path: ["parameters", key], message: `Only mapped native parameters and their SDK ranges are accepted: ${type}.${key}` });
  }
  if (type === "heisenberg" && values.unisonoDetuneSemitones !== undefined && (values.unisonoCount ?? 1) <= 1) context.addIssue({ code: "custom", path: ["parameters"], message: "Heisenberg unison detune requires more than one voice" });
}
const parameters = z.record(z.string(), z.number()).default({});
const note = z.object({ id, startTick: z.number().int().min(0), durationTicks: z.number().int().min(1), pitch: z.number().int().min(0).max(127), velocity: z.number().min(0.01).max(1) });
const point = z.object({ tick: z.number().int().min(0), value: z.number().min(0).max(1), interpolation: z.enum(["step", "linear", "sloped"]).optional(), slope: z.number().min(-1).max(1).optional() }).superRefine((value, context) => { if (value.slope !== undefined && value.interpolation !== "sloped") context.addIssue({ code: "custom", message: "Automation slope requires sloped interpolation" }); });
const automatableDeviceFields: Record<string, Set<string>> = {
  heisenberg: new Set(["gain", "glideMs", "velocityFactor", ...["A", "B", "C", "D"].flatMap((operator) => [`operator${operator}.gain`, `operator${operator}.detuneFactor`, `operator${operator}.frequencyOffsetHz`, ...["A", "B", "C", "D"].filter((other) => other !== operator).map((other) => `operator${operator}.modulationFactor${other}`)]), "lfo1.rateNormalized", "lfo2.rateNormalized", "filter.cutoffFrequencyHz", "filter.resonance", "envelopeMain.attackTimeNormalized", "envelopeMain.releaseTimeNormalized"]),
  pulverisateur: new Set(["gain", "glideTimeMs", "filter.cutoffFrequencyHz", "filter.resonance"]), gakki: new Set(["gain"]), beatbox8: new Set(["gain", "accentAmount", "bassdrum.gain", "bassdrum.tone", "bassdrum.decay", "snaredrum.gain", "snaredrum.tone", "snaredrum.snappy", "openHihat.decay"]), audio: new Set(["gain"])
};
const automatableEffectFields = new Set(["mix", "feedbackFactor", "cutoffFrequencyHz", "thresholdDb", "ratio", "attackMs", "releaseMs", "frequencyHz", "postGainDb", "drive", "tone", "postGain", "roomSizeFactor", "filterModulationDepth", "lfoFrequencyHz"]);
const mixerCompressor = z.object({ thresholdDb: z.number().min(-48).max(0), ratio: z.number().min(1).max(50), attackMs: z.number().min(0.001).max(200), releaseMs: z.number().min(0.001).max(2000), makeupGainDb: z.number().min(-24).max(24), detectionModeIndex: z.union([z.literal(1), z.literal(2)]).default(1), isActive: z.boolean().default(true) });
const master = z.object({ gain: z.number().min(0).max(1.995), pan: z.number().min(-1).max(1), limiterEnabled: z.boolean() });
const reverbBus = z.object({ id, name: z.string().min(1).max(80), roomSize: z.number().min(0).max(1), preDelayMs: z.number().min(8).max(500), damp: z.number().min(0).max(1) });
const delayBus = z.object({ id, name: z.string().min(1).max(80), feedbackFactor: z.number().min(0).max(0.8), stepCount: z.number().int().min(1).max(7), stepLengthIndex: z.union([z.literal(1), z.literal(2), z.literal(3)]) });
const send = z.object({ busId: id, gain: z.number().min(0).max(1) });
const sourcePlayback = { playbackRate: z.number().min(0.5).max(2).optional(), stretchMode: z.enum(["resample", "preservePitch"]).optional(), pitchShiftSemitones: z.number().min(-24).max(24).optional() };
const libraryRegion = z.object({ id, sampleName: z.string().regex(/^samples\/[a-zA-Z0-9-]{1,120}$/), displayName: z.string().min(1).max(160), ownerName: z.string().max(160), durationSeconds: z.number().positive(), bpm: z.number().min(0).max(400), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  startTick: z.number().int().min(0), durationTicks: z.number().int().positive(), sourceStartSeconds: z.number().min(0), sourceDurationSeconds: z.number().positive(), playbackMode: z.enum(["once", "loop"]), gain: z.number().min(0).max(1), provenance: z.literal("audiotool-library"), ...sourcePlayback }).superRefine((value, context) => { if (value.pitchShiftSemitones !== undefined && value.stretchMode !== "preservePitch") context.addIssue({ code: "custom", message: "Pitch shifting needs preservePitch stretch mode" }); });
const nativeEffect = z.object({ id, type: z.enum(["stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter", "stompboxTube", "stompboxChorus", "stompboxPitchDelay"]), parameters }).superRefine((value, context) => mappedParameters(value.type, value.parameters, context));
const mixerGroup = z.object({ id, name: z.string().min(1).max(80), gain: z.number().min(0).max(1.995), pan: z.number().min(-1).max(1), parentId: id.optional(), compressor: mixerCompressor.optional(), sidechainFromPartId: id.optional(),
  effects: z.array(nativeEffect).max(6).optional(), parallel: z.object({ wetMix: z.number().min(0.01).max(0.99), effects: z.array(nativeEffect).min(1).max(4) }).optional(),
  automation: z.array(z.object({ id, target: z.string().min(1).max(160), points: z.array(point).min(2).max(128) })).max(12).optional() });
const part = z.object({
  id, name: z.string().min(1).max(80), role: z.enum(["percussion", "bass", "melody", "harmony", "texture", "lead", "fx", "source"]),
  device: z.object({ type: z.enum(["heisenberg", "pulverisateur", "gakki", "beatbox8", "audio"]), parameters,
    // Optional only to read pre-pinning immutable histories. New selections
    // require a fingerprint and old references cannot be synced as trusted.
    preset: z.object({ name: z.string().regex(/^presets\/[a-zA-Z0-9-]{1,120}$/), displayName: z.string().min(1).max(160), ownerName: z.string().max(160), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).optional()
  }).superRefine((value, context) => { mappedParameters(value.type, value.parameters, context); if (value.type === "audio" && value.preset) context.addIssue({ code: "custom", message: "Audio clip parts cannot use instrument presets" }); }),
  gain: z.number().min(0).max(1).default(0.7), pan: z.number().min(-1).max(1).default(0),
  groupId: id.optional(), sends: z.array(send).max(4).optional(),
  notes: z.array(note).max(4096).default([]),
  placements: z.array(z.object({ id, motifId: id, startTick: z.number().int().min(0), repeats: z.number().int().min(1).max(64), transpose: z.number().int().min(-36).max(36) })).max(512).default([]),
  sourceRegions: z.array(z.object({ id, assetId: z.uuid(), assetHash: z.string().regex(/^[a-f0-9]{64}$/), sampleId: z.string().min(1).max(160).optional(), startTick: z.number().int().min(0), durationTicks: z.number().int().positive(), sourceStartSeconds: z.number().min(0), sourceDurationSeconds: z.number().positive(), playbackMode: z.enum(["once", "loop"]).optional(), gain: z.number().min(0).max(1), rights: z.string().min(1).max(300), ...sourcePlayback }).superRefine((value, context) => { if (value.pitchShiftSemitones !== undefined && value.stretchMode !== "preservePitch") context.addIssue({ code: "custom", message: "Pitch shifting needs preservePitch stretch mode" }); })).max(128).default([]),
  libraryRegions: z.array(libraryRegion).max(128).optional(),
  effects: z.array(nativeEffect).max(8).default([]),
  parallel: z.object({ wetMix: z.number().min(0.01).max(0.99), effects: z.array(nativeEffect).min(1).max(3) }).optional(),
  automation: z.array(z.object({ id, target: z.string().min(1).max(160), points: z.array(point).min(2).max(128) })).max(16).default([])
});
const motif = z.object({ id, partId: id, name: z.string().min(1).max(80), lengthTicks: z.number().int().positive(), notes: z.array(note).min(1).max(256), familyId: id.optional(), derivedFromMotifId: id.optional() });
const section = z.object({ id, name: z.string().min(1).max(80), startBar: z.number().int().min(0), endBar: z.number().int().positive(), intent: z.string().max(240).default("") });

export const nativeDocumentSchema = z.object({
  schemaVersion: z.literal(2), ppq: z.literal(NATIVE_PPQ), title: z.string().min(1).max(120), direction: z.string().min(1).max(32_768), currentObjective: z.string().min(1).max(32_768),
  assumptions: z.array(z.string().max(240)).max(16), tempoBpm: z.number().int().min(40).max(220),
  meter: z.object({ numerator: z.number().int().min(2).max(12), denominator: z.union([z.literal(4), z.literal(8)]) }),
  bars: z.number().int().min(4).max(128), sections: z.array(section).min(1).max(24), parts: z.array(part).min(1).max(24),
  groups: z.array(mixerGroup).max(8).optional(), reverbBus: reverbBus.optional(), delayBus: delayBus.optional(), master: master.optional(),
  motifs: z.array(motif).max(256), protectedPartIds: z.array(id).max(24), protectedMotifIds: z.array(id).max(256),
  sourceAssetIds: z.array(z.uuid()).max(24), audio: z.object({ state: z.enum(["deferred", "unavailable", "stale"]), revisionId: z.null(), assetHash: z.null() })
}).superRefine((document, context) => {
  const unique = (values: string[], path: string) => { if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path: [path], message: `Duplicate ${path} identity` }); };
  unique(document.sections.map((value) => value.id), "sections"); unique(document.parts.map((value) => value.id), "parts"); unique(document.motifs.map((value) => value.id), "motifs");
  let cursor = 0;
  for (const item of document.sections) { if (item.startBar !== cursor || item.endBar <= item.startBar) context.addIssue({ code: "custom", path: ["sections"], message: "Sections must be ordered and contiguous" }); cursor = item.endBar; }
  if (cursor !== document.bars) context.addIssue({ code: "custom", path: ["sections"], message: "Sections must cover the arrangement" });
  const totalTicks = document.bars * document.meter.numerator * NATIVE_PPQ * 4 / document.meter.denominator;
  if (document.reverbBus && document.delayBus && document.reverbBus.id === document.delayBus.id) context.addIssue({ code: "custom", path: ["delayBus"], message: "Shared returns need distinct identities" });
  const parts = new Set(document.parts.map((value) => value.id));
  const groups = new Map((document.groups ?? []).map((value) => [value.id, value]));
  unique([...groups.keys()], "groups");
  for (const group of groups.values()) {
    unique([...(group.effects ?? []).map((effect) => effect.id), ...(group.parallel?.effects ?? []).map((effect) => effect.id)], "group effects");
    for (const curve of group.automation ?? []) {
      if (curve.points.some((value) => value.tick > totalTicks) || curve.points.some((value, index) => index > 0 && value.tick <= curve.points[index - 1]!.tick)) context.addIssue({ code: "custom", path: ["groups"], message: `Invalid automation ${curve.id}` });
      const effectMatch = /^effect\.([a-z][a-z0-9-]{0,63})\.([A-Za-z][A-Za-z0-9]*)$/.exec(curve.target);
      const effect = effectMatch && [...(group.effects ?? []), ...(group.parallel?.effects ?? [])].find((value) => value.id === effectMatch[1]);
      if (!["gain", "pan", "compressor.thresholdDb", "compressor.ratio", "compressor.attackMs", "compressor.releaseMs", "compressor.makeupGainDb", "parallel.wetMix"].includes(curve.target) && !(effect && effectMatch && automatableEffectFields.has(effectMatch[2]!) && Object.hasOwn(nativeParameterRanges[effect.type], effectMatch[2]!))) context.addIssue({ code: "custom", path: ["groups"], message: `Group automation ${curve.id} has unsupported target ${curve.target}` });
      if (curve.target === "parallel.wetMix" && !group.parallel) context.addIssue({ code: "custom", path: ["groups"], message: `Group ${group.id} has no parallel blend` });
      if (curve.target.startsWith("compressor.") && !group.compressor) context.addIssue({ code: "custom", path: ["groups"], message: `Group ${group.id} has no compressor` });
    }
    if (group.parentId && !groups.has(group.parentId)) context.addIssue({ code: "custom", path: ["groups"], message: `Group ${group.id} has no parent` });
    const visited = new Set([group.id]);
    let parent = group.parentId;
    while (parent) {
      if (visited.has(parent)) { context.addIssue({ code: "custom", path: ["groups"], message: `Group cycle at ${group.id}` }); break; }
      visited.add(parent); parent = groups.get(parent)?.parentId;
    }
    if (group.sidechainFromPartId && (!group.compressor?.isActive || !document.parts.some((item) => item.id === group.sidechainFromPartId))) context.addIssue({ code: "custom", path: ["groups"], message: `Group ${group.id} has no active compressor or valid sidechain source` });
    const source = document.parts.find((item) => item.id === group.sidechainFromPartId);
    let routed = source?.groupId;
    const sidechainRouteSeen = new Set<string>();
    while (routed) {
      if (sidechainRouteSeen.has(routed)) break;
      sidechainRouteSeen.add(routed);
      if (routed === group.id) { context.addIssue({ code: "custom", path: ["groups"], message: `Group ${group.id} cannot be sidechained by a part routed through itself` }); break; }
      routed = groups.get(routed)?.parentId;
    }
  }
  const motifs = new Map(document.motifs.map((value) => [value.id, value]));
  for (const item of document.motifs) {
    if (!parts.has(item.partId)) context.addIssue({ code: "custom", path: ["motifs"], message: `Motif ${item.id} has no part` });
    if (item.notes.some((value) => value.startTick + value.durationTicks > item.lengthTicks)) context.addIssue({ code: "custom", path: ["motifs"], message: `Motif ${item.id} has notes outside its phrase` });
    unique(item.notes.map((value) => value.id), "motif notes");
    const parent = item.derivedFromMotifId ? motifs.get(item.derivedFromMotifId) : null;
    if (item.derivedFromMotifId && (!parent || parent.id === item.id || item.familyId !== (parent.familyId ?? parent.id))) context.addIssue({ code: "custom", path: ["motifs"], message: `Motif ${item.id} has invalid family provenance` });
    if (!item.derivedFromMotifId && item.familyId && item.familyId !== item.id) context.addIssue({ code: "custom", path: ["motifs"], message: `Root motif ${item.id} must own its family identity` });
  }
  for (const item of document.parts) {
    unique([...item.effects.map((value) => value.id), ...(item.parallel?.effects.map((value) => value.id) ?? [])], "part effects");
    if (item.groupId && !groups.has(item.groupId)) context.addIssue({ code: "custom", path: ["parts"], message: `Part ${item.id} has no mixer group` });
    if (new Set((item.sends ?? []).map((value) => value.busId)).size !== (item.sends ?? []).length) context.addIssue({ code: "custom", path: ["parts"], message: `Part ${item.id} has duplicate sends` });
    if (item.sends?.some((value) => value.busId !== document.reverbBus?.id && value.busId !== document.delayBus?.id)) context.addIssue({ code: "custom", path: ["parts"], message: `Part ${item.id} sends to an unavailable return` });
    unique(item.notes.map((value) => value.id), "part notes"); unique(item.placements.map((value) => value.id), "placements");
    if (item.notes.some((value) => value.startTick + value.durationTicks > totalTicks)) context.addIssue({ code: "custom", path: ["parts"], message: `Part ${item.id} has notes outside the arrangement` });
    for (const placement of item.placements) {
      const phrase = motifs.get(placement.motifId);
      if (!phrase || phrase.partId !== item.id || placement.startTick + placement.repeats * phrase.lengthTicks > totalTicks) context.addIssue({ code: "custom", path: ["parts"], message: `Invalid motif placement ${placement.id}` });
      if (phrase?.notes.some((value) => value.pitch + placement.transpose < 0 || value.pitch + placement.transpose > 127)) context.addIssue({ code: "custom", path: ["parts"], message: `Pitch outside MIDI range in ${placement.id}` });
    }
    for (const region of item.sourceRegions) {
      if (!document.sourceAssetIds.includes(region.assetId) || region.startTick + region.durationTicks > totalTicks) context.addIssue({ code: "custom", path: ["parts"], message: `Invalid source region ${region.id}` });
    }
    for (const region of item.libraryRegions ?? []) if (region.startTick + region.durationTicks > totalTicks || region.sourceStartSeconds + region.sourceDurationSeconds > region.durationSeconds + 0.001) context.addIssue({ code: "custom", path: ["parts"], message: `Invalid library sample interval ${region.id}` });
    for (const curve of item.automation) {
      if (curve.points.some((value) => value.tick > totalTicks) || curve.points.some((value, index) => index > 0 && value.tick <= curve.points[index - 1]!.tick)) context.addIssue({ code: "custom", path: ["parts"], message: `Invalid automation ${curve.id}` });
      const target = curve.target;
      const devicePath = target.startsWith("device.") ? target.slice(7) : null;
      const effectMatch = /^effect\.([a-z][a-z0-9-]{0,63})\.([A-Za-z][A-Za-z0-9]*)$/.exec(target);
      const sendMatch = /^send\.([a-z][a-z0-9-]{0,63})\.gain$/.exec(target);
      const effect = effectMatch && [...item.effects, ...(item.parallel?.effects ?? [])].find((value) => value.id === effectMatch[1]);
      const effectField = effectMatch?.[2];
      const validEffectTarget = effect && effectField && automatableEffectFields.has(effectField) && Object.hasOwn(nativeParameterRanges[effect.type], effectField);
      if (!["gain", "pan"].includes(target) && !(target === "filter" && item.effects.some((value) => value.type === "autoFilter")) && !(devicePath && automatableDeviceFields[item.device.type]?.has(devicePath)) && !validEffectTarget && !(sendMatch && item.sends?.some((value) => value.busId === sendMatch[1]))) context.addIssue({ code: "custom", path: ["parts"], message: `Automation ${curve.id} has an unsupported or dangling target ${target}` });
    }
  }
  if (document.protectedPartIds.some((value) => !parts.has(value)) || document.protectedMotifIds.some((value) => !motifs.has(value))) context.addIssue({ code: "custom", path: ["protectedPartIds"], message: "A protection references missing material" });
});

export type NativeDocument = z.infer<typeof nativeDocumentSchema>;
export type NativePart = NativeDocument["parts"][number];
export type NativeNote = NativePart["notes"][number];
export function assertNativeDeviceMapping(document: NativeDocument): void {
  // Keep schema-v2 historical readers permissive. New writes and synchronization
  // must meet the stricter, actually mapped Beatbox8 on/off contract.
  for (const item of document.parts) {
    if (item.device.type === "audio") {
      if (item.notes.length || item.placements.length || document.motifs.some((value) => value.partId === item.id)) throw new Error(`Audio part ${item.id} cannot carry MIDI notes or motif placements; use a native instrument part`);
    } else if (item.sourceRegions.length || item.libraryRegions?.length) throw new Error(`Instrument part ${item.id} cannot carry source clips; use an audio part`);
    if (item.device.type !== "beatbox8") continue;
    if (item.notes.length) throw new Error(`Beatbox8 ${item.id} uses on/off pattern slots, not direct MIDI notes`);
    const phrases = document.motifs.filter((value) => value.partId === item.id);
    if (phrases.length > 5) throw new Error(`Beatbox8 ${item.id} has more than five pattern slots`);
    if (item.placements.some((value) => value.transpose !== 0)) throw new Error(`Beatbox8 ${item.id} cannot transpose fixed drum lanes`);
    for (const phrase of phrases) {
      if (phrase.lengthTicks % 240 !== 0 || phrase.lengthTicks / 240 > 64) throw new Error(`Beatbox8 ${phrase.id} needs 1–64 sixteenth-note steps`);
      const occupied = new Set<string>();
      for (const event of phrase.notes) {
        if (![36, 38, 42, 46].includes(event.pitch) || event.startTick % 240 !== 0 || event.durationTicks !== 240 || event.velocity !== 1) throw new Error(`Beatbox8 ${phrase.id} maps only on/off MIDI 36/38/42/46 sixteenth-grid steps; velocity and duration expression are unsupported`);
        const cell = `${event.startTick}:${event.pitch}`;
        if (occupied.has(cell)) throw new Error(`Duplicate Beatbox8 lane step ${cell}`);
        occupied.add(cell);
      }
    }
  }
}
export const nativeOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setTitle"), title: z.string().min(1).max(120) }),
  z.object({ kind: z.literal("setObjective"), objective: z.string().min(1).max(32_768) }),
  z.object({ kind: z.literal("setStructure"), bars: z.number().int().min(4).max(128), sections: z.array(section).min(1).max(24), tempoBpm: z.number().int().min(40).max(220).optional() }),
  z.object({ kind: z.literal("setMeter"), meter: z.object({ numerator: z.number().int().min(2).max(12), denominator: z.union([z.literal(4), z.literal(8)]) }) }),
  z.object({ kind: z.literal("addPart"), part }),
  z.object({ kind: z.literal("defineMotif"), motif }),
  z.object({ kind: z.literal("replaceMotif"), motif }),
  z.object({ kind: z.literal("varyMotifInstance"), partId: id, placementId: id, newMotifId: id, name: z.string().min(1).max(80), pitchShiftSemitones: z.number().int().min(-24).max(24).optional(), timeShiftTicks: z.number().int().min(-960).max(960).optional(), durationFactor: z.number().min(0.5).max(1.5).optional(), velocityFactor: z.number().min(0.5).max(1.5).optional(), omitEvery: z.number().int().min(2).max(8).optional(), noteEdits: z.array(z.object({ noteId: id, omit: z.boolean().optional(), pitch: z.number().int().min(0).max(127).optional(), startTick: z.number().int().min(0).optional(), durationTicks: z.number().int().positive().optional(), velocity: z.number().min(0.01).max(1).optional() })).max(64).optional() }),
  z.object({ kind: z.literal("developSectionNotes"), partId: id, sectionId: id, pitchShiftSemitones: z.number().int().min(-12).max(12).optional(), velocityFactor: z.number().min(0.5).max(1.5).optional(), omitEvery: z.number().int().min(2).max(8).optional() }),
  z.object({ kind: z.literal("handoffMotif"), sourceMotifId: id, targetPartId: id, newMotifId: id, name: z.string().min(1).max(80), placementId: id, startTick: z.number().int().min(0), repeats: z.number().int().min(1).max(64), transpose: z.number().int().min(-36).max(36).default(0) }),
  z.object({ kind: z.literal("silenceSectionClips"), partId: id, sectionId: id, regionId: id.optional() }),
  z.object({ kind: z.literal("setSectionClipGain"), partId: id, sectionId: id, regionId: id.optional(), gain: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("moveSectionClip"), partId: id, sectionId: id, regionId: id, startTick: z.number().int().min(0) }),
  z.object({ kind: z.literal("shiftSectionClip"), partId: id, sectionId: id, regionId: id, deltaTicks: z.number().int().min(-3840).max(3840).refine((value) => value !== 0) }),
  z.object({ kind: z.literal("placeMotif"), partId: id, placement: part.shape.placements.unwrap().element }),
  z.object({ kind: z.literal("replacePlacements"), partId: id, placements: part.shape.placements.unwrap() }),
  z.object({ kind: z.literal("addNotes"), partId: id, notes: z.array(note).min(1).max(256) }),
  z.object({ kind: z.literal("harmonizeSection"), partId: id, sectionId: id, cycleBars: z.number().int().min(1).max(16), chords: z.array(z.object({ barOffset: z.number().min(0).max(16), durationBars: z.number().positive().max(16), pitches: z.array(z.number().int().min(0).max(127)).min(2).max(8), velocity: z.number().min(0.01).max(1), strumTicks: z.number().int().min(0).max(240).default(0) })).min(1).max(16) }),
  z.object({ kind: z.literal("sequenceSectionPattern"), partId: id, sectionId: id, cycleBars: z.number().int().min(1).max(8), hits: z.array(z.object({ tick: z.number().int().min(0), durationTicks: z.number().int().min(1).max(3840), pitch: z.number().int().min(0).max(127), velocity: z.number().min(0.01).max(1), timingOffsetTicks: z.number().int().min(-120).max(120).default(0) })).min(1).max(96) }),
  z.object({ kind: z.literal("replaceNotes"), partId: id, notes: z.array(note).max(4096) }),
  z.object({ kind: z.literal("setDevice"), partId: id, device: part.shape.device }),
  z.object({ kind: z.literal("setMix"), partId: id, gain: z.number().min(0).max(1).optional(), pan: z.number().min(-1).max(1).optional() }),
  z.object({ kind: z.literal("setParallelChain"), partId: id, parallel: part.shape.parallel.unwrap() }),
  z.object({ kind: z.literal("removeParallelChain"), partId: id }),
  z.object({ kind: z.literal("upsertGroup"), group: mixerGroup }),
  z.object({ kind: z.literal("setGroupMix"), groupId: id, gain: z.number().min(0).max(1.995).optional(), pan: z.number().min(-1).max(1).optional(), parentId: id.nullable().optional() }),
  z.object({ kind: z.literal("addGroupEffect"), groupId: id, effect: nativeEffect, beforeEffectId: id.optional() }),
  z.object({ kind: z.literal("replaceGroupEffect"), groupId: id, effect: nativeEffect }),
  z.object({ kind: z.literal("removeGroupEffect"), groupId: id, effectId: id }),
  z.object({ kind: z.literal("moveGroupEffect"), groupId: id, effectId: id, beforeEffectId: id.nullable() }),
  z.object({ kind: z.literal("setGroupParallel"), groupId: id, parallel: mixerGroup.shape.parallel.unwrap() }),
  z.object({ kind: z.literal("removeGroupParallel"), groupId: id }),
  z.object({ kind: z.literal("setGroupAutomation"), groupId: id, automation: mixerGroup.shape.automation.unwrap().element }),
  z.object({ kind: z.literal("removeGroupAutomation"), groupId: id, automationId: id }),
  z.object({ kind: z.literal("removeGroup"), groupId: id }),
  z.object({ kind: z.literal("routePart"), partId: id, groupId: id.nullable() }),
  z.object({ kind: z.literal("setReverbBus"), bus: reverbBus }),
  z.object({ kind: z.literal("setDelayBus"), bus: delayBus }),
  z.object({ kind: z.literal("removeDelayBus") }),
  z.object({ kind: z.literal("setMaster"), master }),
  z.object({ kind: z.literal("removeReverbBus") }),
  z.object({ kind: z.literal("setSend"), partId: id, busId: id, gain: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("removeSend"), partId: id, busId: id }),
  z.object({ kind: z.literal("addEffect"), partId: id, effect: part.shape.effects.unwrap().element }),
  z.object({ kind: z.literal("replaceEffect"), partId: id, effect: part.shape.effects.unwrap().element }),
  z.object({ kind: z.literal("removeEffect"), partId: id, effectId: id }),
  z.object({ kind: z.literal("addAutomation"), partId: id, automation: part.shape.automation.unwrap().element }),
  z.object({ kind: z.literal("replaceAutomation"), partId: id, automation: part.shape.automation.unwrap().element }),
  z.object({ kind: z.literal("removeAutomation"), partId: id, automationId: id }),
  z.object({ kind: z.literal("editSectionAutomation"), partId: id, sectionId: id, automationId: id, points: z.array(point).min(2).max(128) }),
  z.object({ kind: z.literal("setSectionEffectFeedback"), partId: id, sectionId: id, effectId: id, feedbackFactor: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("placeSource"), partId: id, region: part.shape.sourceRegions.unwrap().element }),
  z.object({ kind: z.literal("replaceSource"), partId: id, region: part.shape.sourceRegions.unwrap().element }),
  z.object({ kind: z.literal("removeSource"), partId: id, regionId: id }),
  z.object({ kind: z.literal("placeLibrarySample"), partId: id, region: libraryRegion }),
  z.object({ kind: z.literal("replaceLibrarySample"), partId: id, region: libraryRegion }),
  z.object({ kind: z.literal("removeLibrarySample"), partId: id, regionId: id }),
  z.object({ kind: z.literal("protect"), partIds: z.array(id).max(24), motifIds: z.array(id).max(256) }),
  z.object({ kind: z.literal("removePart"), partId: id })
]);
export type NativeOperation = z.infer<typeof nativeOperationSchema>;

export function barTicks(document: Pick<NativeDocument, "meter">): number { return document.meter.numerator * NATIVE_PPQ * 4 / document.meter.denominator; }
export function materializedNotes(document: NativeDocument, partId: string): NativeNote[] {
  const item = document.parts.find((value) => value.id === partId);
  if (!item) throw new Error(`Unknown part ${partId}`);
  const phrases = new Map(document.motifs.map((value) => [value.id, value]));
  const result = [...item.notes];
  for (const placement of item.placements) {
    const phrase = phrases.get(placement.motifId)!;
    for (let repeat = 0; repeat < placement.repeats; repeat++) for (const value of phrase.notes) result.push({ ...value, id: `n-${canonicalHash({ placementId: placement.id, repeat, noteId: value.id }).slice(0, 32)}`, startTick: placement.startTick + repeat * phrase.lengthTicks + value.startTick, pitch: value.pitch + placement.transpose });
  }
  return result.sort((a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id));
}

export function nativeHasMaterial(document: NativeDocument): boolean {
  return document.parts.some((item) => item.sourceRegions.length > 0 || (item.libraryRegions?.length ?? 0) > 0 || materializedNotes(document, item.id).length > 0);
}

export function protectedPartHash(document: NativeDocument, partId: string): string {
  const item = document.parts.find((value) => value.id === partId);
  if (!item) throw new Error(`Unknown part ${partId}`);
  const groupChain: NativeDocument["groups"] = [];
  let groupId = item.groupId;
  while (groupId) { const group = document.groups?.find((value) => value.id === groupId); if (!group) break; groupChain.push(group); groupId = group.parentId; }
  const sidechainDependencies = groupChain.flatMap((group) => group.sidechainFromPartId ? [{ part: document.parts.find((value) => value.id === group.sidechainFromPartId), motifs: document.motifs.filter((value) => value.partId === group.sidechainFromPartId) }] : []);
  return canonicalHash({ tempoBpm: document.tempoBpm, meter: document.meter, master: document.master, part: item, motifs: document.motifs.filter((value) => value.partId === partId), groupChain, sidechainDependencies, reverbBus: item.sends?.some((value) => value.busId === document.reverbBus?.id) ? document.reverbBus : undefined, delayBus: item.sends?.some((value) => value.busId === document.delayBus?.id) ? document.delayBus : undefined });
}

export function setNativeProtections(base: NativeDocument, expectedPartIds: string[], desiredPartIds: string[]): NativeDocument {
  const current = [...base.protectedPartIds].sort();
  if (canonicalHash(current) !== canonicalHash([...expectedPartIds].sort())) throw new Error("Protection state changed; refresh before unlocking or protecting parts");
  const next = structuredClone(base);
  next.protectedPartIds = [...new Set(desiredPartIds)];
  return nativeDocumentSchema.parse(next);
}

export function nativeMusicHash(document: NativeDocument): string {
  return canonicalHash({
    tempoBpm: document.tempoBpm, meter: document.meter, bars: document.bars,
    sections: document.sections.map(({ startBar, endBar }) => ({ startBar, endBar })),
    groups: document.groups, reverbBus: document.reverbBus, delayBus: document.delayBus, master: document.master,
    parts: document.parts.map(({ id, device, gain, pan, groupId, sends, notes, placements, sourceRegions, libraryRegions, effects, parallel, automation }) => ({ id, device, gain, pan, groupId, sends, notes, placements, sourceRegions, libraryRegions, effects, parallel, automation })),
    motifs: document.motifs.map(({ id, partId, lengthTicks, notes }) => ({ id, partId, lengthTicks, notes }))
  });
}

export function applyNativeOperations(base: NativeDocument, operations: NativeOperation[], requestedProtections: string[] = []): NativeDocument {
  if (operations.length > 128) throw new Error("Native batch exceeds 128 operations");
  const next = structuredClone(nativeDocumentSchema.parse(base));
  const locked = new Set([...base.protectedPartIds, ...requestedProtections]);
  const before = new Map([...locked].map((partId) => [partId, protectedPartHash(base, partId)]));
  for (const raw of operations) {
    const op = nativeOperationSchema.parse(raw);
  const findPart = (partId: string) => { const item = next.parts.find((value) => value.id === partId); if (!item) throw new Error(`Unknown part ${partId}`); return item; };
  const findGroup = (groupId: string) => { const item = next.groups?.find((value) => value.id === groupId); if (!item) throw new Error(`Unknown group ${groupId}`); return item; };
    switch (op.kind) {
      case "setTitle": next.title = op.title; break;
      case "setObjective": next.currentObjective = op.objective; break;
      case "setStructure": next.bars = op.bars; next.sections = op.sections; if (op.tempoBpm !== undefined) next.tempoBpm = op.tempoBpm; break;
      case "setMeter": next.meter = op.meter; break;
      case "harmonizeSection": {
        const item = findPart(op.partId), section = next.sections.find((value) => value.id === op.sectionId);
        if (!section) throw new Error(`Unknown section ${op.sectionId}`);
        if (["audio", "beatbox8"].includes(item.device.type)) throw new Error("Harmonic notes need a MIDI-capable native instrument");
        const ticksPerBar = barTicks(next), sectionStart = section.startBar * ticksPerBar, sectionEnd = section.endBar * ticksPerBar, cycleTicks = op.cycleBars * ticksPerBar, operationHash = canonicalHash(op);
        for (const chord of op.chords) {
          if (chord.barOffset >= op.cycleBars || chord.barOffset + chord.durationBars > op.cycleBars || new Set(chord.pitches).size !== chord.pitches.length) throw new Error("Chord voicing must fit its cycle and contain distinct pitches");
        }
        for (let cycleStart = sectionStart, repeat = 0; cycleStart < sectionEnd; cycleStart += cycleTicks, repeat++) for (const [chordIndex, chord] of op.chords.entries()) {
          const onset = cycleStart + Math.round(chord.barOffset * ticksPerBar);
          if (onset >= sectionEnd) continue;
          for (const [voice, pitch] of chord.pitches.entries()) {
            const startTick = onset + voice * chord.strumTicks;
            if (startTick >= sectionEnd) continue;
            item.notes.push({ id: `n-${canonicalHash({ operationHash, repeat, chordIndex, voice, pitch }).slice(0, 32)}`, startTick, durationTicks: Math.min(Math.round(chord.durationBars * ticksPerBar), sectionEnd - startTick), pitch, velocity: chord.velocity });
          }
        }
        break;
      }
      case "sequenceSectionPattern": {
        const item = findPart(op.partId), section = next.sections.find((value) => value.id === op.sectionId);
        if (!section) throw new Error(`Unknown section ${op.sectionId}`);
        if (["audio", "beatbox8"].includes(item.device.type)) throw new Error("Expressive pattern notes need a MIDI-capable native instrument");
        const ticksPerBar = barTicks(next), sectionStart = section.startBar * ticksPerBar, sectionEnd = section.endBar * ticksPerBar, cycleTicks = op.cycleBars * ticksPerBar, operationHash = canonicalHash(op);
        if (op.hits.some((hit) => hit.tick >= cycleTicks)) throw new Error("Pattern hit exceeds its cycle");
        for (let cycleStart = sectionStart, repeat = 0; cycleStart < sectionEnd; cycleStart += cycleTicks, repeat++) for (const [hitIndex, hit] of op.hits.entries()) {
          const startTick = cycleStart + hit.tick + hit.timingOffsetTicks;
          if (cycleStart + hit.tick >= sectionEnd) continue;
          if (startTick < sectionStart || startTick >= sectionEnd) throw new Error("Expressive hit timing exceeds the selected section");
          item.notes.push({ id: `n-${canonicalHash({ operationHash, repeat, hitIndex }).slice(0, 32)}`, startTick, durationTicks: Math.min(hit.durationTicks, sectionEnd - startTick), pitch: hit.pitch, velocity: hit.velocity });
        }
        break;
      }
      case "addPart": next.parts.push(op.part); break;
      case "defineMotif": next.motifs.push(op.motif); break;
      case "replaceMotif": { const index = next.motifs.findIndex((value) => value.id === op.motif.id); if (index < 0) throw new Error(`Unknown motif ${op.motif.id}`); next.motifs[index] = op.motif; break; }
      case "varyMotifInstance": {
        const item = findPart(op.partId);
        const placement = item.placements.find((value) => value.id === op.placementId);
        if (!placement) throw new Error(`Unknown placement ${op.placementId} on ${op.partId}`);
        const source = next.motifs.find((value) => value.id === placement.motifId && value.partId === op.partId);
        if (!source || !source.notes.length) throw new Error("A nonempty source motif is required for local variation");
        if (next.motifs.some((value) => value.id === op.newMotifId)) throw new Error(`Motif ID ${op.newMotifId} already exists`);
        const pitchShift = op.pitchShiftSemitones ?? 0, timeShift = op.timeShiftTicks ?? 0, durationFactor = op.durationFactor ?? 1, velocityFactor = op.velocityFactor ?? 1;
        const noteEdits = new Map((op.noteEdits ?? []).map((edit) => [edit.noteId, edit]));
        if (noteEdits.size !== (op.noteEdits?.length ?? 0) || [...noteEdits.keys()].some((noteId) => !source.notes.some((value) => value.id === noteId))) throw new Error("Motif note edits must identify distinct notes in the original phrase");
        if (!pitchShift && !timeShift && durationFactor === 1 && velocityFactor === 1 && !op.omitEvery && !noteEdits.size) throw new Error("A motif variation must change musical material");
        const notes = source.notes.filter((value, index) => (!op.omitEvery || (index + 1) % op.omitEvery !== 0) && !noteEdits.get(value.id)?.omit).map((value) => {
          const edit = noteEdits.get(value.id);
          return { ...value, pitch: edit?.pitch ?? value.pitch + pitchShift, startTick: edit?.startTick ?? value.startTick + timeShift, durationTicks: edit?.durationTicks ?? Math.max(1, Math.round(value.durationTicks * durationFactor)), velocity: edit?.velocity ?? Number((value.velocity * velocityFactor).toFixed(4)) };
        });
        if (JSON.stringify(notes) === JSON.stringify(source.notes)) throw new Error("A motif variation must change musical material");
        if (!notes.length || notes.some((value) => value.startTick < 0 || value.startTick + value.durationTicks > source.lengthTicks || value.pitch < 0 || value.pitch > 127 || value.velocity < 0.01 || value.velocity > 1)) throw new Error("Motif variation exceeds the original phrase bounds, MIDI range or velocity range");
        next.motifs.push({ ...source, id: op.newMotifId, name: op.name, notes, familyId: source.familyId ?? source.id, derivedFromMotifId: source.id });
        placement.motifId = op.newMotifId;
        break;
      }
      case "handoffMotif": {
        const source = next.motifs.find((value) => value.id === op.sourceMotifId);
        const target = findPart(op.targetPartId);
        if (!source || target.device.type === "audio" || target.device.type === "beatbox8") throw new Error("A melodic source motif and a compatible target instrument are required for a handoff");
        if (next.motifs.some((value) => value.id === op.newMotifId)) throw new Error(`Motif ID ${op.newMotifId} already exists`);
        next.motifs.push({ ...structuredClone(source), id: op.newMotifId, partId: target.id, name: op.name, familyId: source.familyId ?? source.id, derivedFromMotifId: source.id });
        target.placements.push({ id: op.placementId, motifId: op.newMotifId, startTick: op.startTick, repeats: op.repeats, transpose: op.transpose });
        break;
      }
      case "developSectionNotes": {
        const item = findPart(op.partId);
        const section = next.sections.find((value) => value.id === op.sectionId);
        if (!section) throw new Error(`Unknown section ${op.sectionId}`);
        if (!(op.pitchShiftSemitones ?? 0) && (op.velocityFactor ?? 1) === 1 && !op.omitEvery) throw new Error("Section development must change musical material");
        const start = section.startBar * barTicks(next), end = section.endBar * barTicks(next);
        const crossing = item.placements.filter((placement) => {
          const phrase = next.motifs.find((value) => value.id === placement.motifId)!;
          return placement.startTick < end && placement.startTick + placement.repeats * phrase.lengthTicks > start;
        });
        const realized = [...item.notes];
        const sliceId = (event: NativeNote, area: string) => `n-${canonicalHash({ id: event.id, section: op.sectionId, area }).slice(0,24)}`;
        for (const placement of crossing) {
          const phrase = next.motifs.find((value) => value.id === placement.motifId)!;
          for (let repeat = 0; repeat < placement.repeats; repeat++) for (const event of phrase.notes) realized.push({ ...event, id: `n-${canonicalHash({ placementId: placement.id, repeat, noteId: event.id }).slice(0, 32)}`, startTick: placement.startTick + repeat * phrase.lengthTicks + event.startTick, pitch: event.pitch + placement.transpose });
        }
        let insideIndex = 0;
        const developed: NativeNote[] = [];
        for (const event of realized) {
          const eventEnd = event.startTick + event.durationTicks;
          if (event.startTick >= end || eventEnd <= start) { developed.push(event); continue; }
          if (event.startTick < start) developed.push({ ...event, id: sliceId(event, "before"), durationTicks: start - event.startTick });
          const innerStart = Math.max(event.startTick, start), innerEnd = Math.min(eventEnd, end);
          insideIndex++;
          if (!op.omitEvery || insideIndex % op.omitEvery !== 0) developed.push({ ...event, id: sliceId(event, "inside"), startTick: innerStart, durationTicks: innerEnd - innerStart, pitch: event.pitch + (op.pitchShiftSemitones ?? 0), velocity: Number((event.velocity * (op.velocityFactor ?? 1)).toFixed(4)) });
          if (eventEnd > end) developed.push({ ...event, id: sliceId(event, "after"), startTick: end, durationTicks: eventEnd - end });
        }
        if (!insideIndex || (op.omitEvery && !(op.pitchShiftSemitones ?? 0) && (op.velocityFactor ?? 1) === 1 && insideIndex < op.omitEvery)) throw new Error(`No notes can be developed within ${op.sectionId}`);
        item.notes = developed;
        item.placements = item.placements.filter((value) => !crossing.some((placement) => placement.id === value.id));
        break;
      }
      case "silenceSectionClips":
      case "setSectionClipGain": {
        const item = findPart(op.partId);
        const section = next.sections.find((value) => value.id === op.sectionId);
        if (!section) throw new Error(`Unknown section ${op.sectionId}`);
        const start = section.startBar * barTicks(next), end = section.endBar * barTicks(next);
        const allRegions = [...item.sourceRegions, ...(item.libraryRegions ?? [])];
        if (op.regionId && allRegions.filter((region) => region.id === op.regionId).length !== 1) throw new Error(`Clip ${op.regionId} must identify exactly one region on ${op.partId}`);
        if (op.kind === "setSectionClipGain" && !allRegions.some((region) => (!op.regionId || region.id === op.regionId) && region.startTick < end && region.startTick + region.durationTicks > start && region.gain !== op.gain)) throw new Error(`No clip gain changes within ${op.sectionId}`);
        const split = <T extends NativePart["sourceRegions"][number] | NonNullable<NativePart["libraryRegions"]>[number]>(regions: T[]): T[] => regions.flatMap((region) => {
          const regionEnd = region.startTick + region.durationTicks;
          if ((op.regionId && region.id !== op.regionId) || region.startTick >= end || regionEnd <= start) return [region];
          const toSeconds = (ticks: number) => ticks / NATIVE_PPQ * 60 / next.tempoBpm * (region.playbackRate ?? 1);
          const result: T[] = [];
          const addSegment = (from: number, to: number, side: string, gain: number) => {
            if (from >= to) return;
            const idFor = (suffix: string) => `r-${canonicalHash({ id: region.id, section: op.sectionId, side: suffix }).slice(0,24)}`;
            if (region.playbackMode !== "loop") { result.push({ ...region, id: idFor(side), startTick: from, durationTicks: to - from, sourceStartSeconds: region.sourceStartSeconds + toSeconds(from - region.startTick), sourceDurationSeconds: toSeconds(to - from), gain }); return; }
            const loopTicksRaw = region.sourceDurationSeconds / toSeconds(1);
            if (Math.abs(loopTicksRaw - Math.round(loopTicksRaw)) > 1e-6) throw new Error(`Loop ${region.id} cannot be split exactly at this tempo and playback rate`);
            const loopTicks = Math.round(loopTicksRaw);
            const phaseTicks = (from - region.startTick) % loopTicks;
            const tailTicks = phaseTicks ? Math.min(to - from, loopTicks - phaseTicks) : 0;
            if (tailTicks) result.push({ ...region, id: idFor(`${side}-tail`), playbackMode: "once", startTick: from, durationTicks: tailTicks, sourceStartSeconds: region.sourceStartSeconds + toSeconds(phaseTicks), sourceDurationSeconds: toSeconds(tailTicks), gain });
            if (to - from > tailTicks) result.push({ ...region, id: idFor(side), startTick: from + tailTicks, durationTicks: to - from - tailTicks, gain });
          };
          addSegment(region.startTick, Math.min(start, regionEnd), "before", region.gain);
          if (op.kind === "setSectionClipGain") addSegment(Math.max(start, region.startTick), Math.min(end, regionEnd), "inside", op.gain);
          addSegment(Math.max(end, region.startTick), regionEnd, "after", region.gain);
          return result;
        });
        const beforeHash = canonicalHash({ owned: item.sourceRegions, library: item.libraryRegions ?? [] });
        item.sourceRegions = split(item.sourceRegions);
        if (item.libraryRegions) item.libraryRegions = split(item.libraryRegions);
        if (beforeHash === canonicalHash({ owned: item.sourceRegions, library: item.libraryRegions ?? [] })) throw new Error(`No clips were changed in ${op.sectionId}`);
        break;
      }
      case "moveSectionClip": {
        const item = findPart(op.partId);
        const section = next.sections.find((value) => value.id === op.sectionId);
        if (!section) throw new Error(`Unknown section ${op.sectionId}`);
        const regions = [...item.sourceRegions, ...(item.libraryRegions ?? [])];
        const matching = regions.filter((value) => value.id === op.regionId);
        if (matching.length !== 1) throw new Error(`Clip ${op.regionId} must identify exactly one region on ${op.partId}`);
        const region = matching[0]!;
        const start = section.startBar * barTicks(next), end = section.endBar * barTicks(next);
        if (region.startTick < start || region.startTick + region.durationTicks > end) throw new Error(`Clip ${op.regionId} crosses ${op.sectionId}; move a bounded section-local clip or edit its gain instead`);
        if (op.startTick < start || op.startTick + region.durationTicks > end) throw new Error(`Moved clip ${op.regionId} would leave ${op.sectionId}`);
        if (op.startTick === region.startTick) throw new Error(`Clip ${op.regionId} did not move`);
        region.startTick = op.startTick;
        break;
      }
      case "shiftSectionClip": {
        const item = findPart(op.partId);
        const section = next.sections.find((value) => value.id === op.sectionId);
        if (!section) throw new Error(`Unknown section ${op.sectionId}`);
        const start = section.startBar * barTicks(next), end = section.endBar * barTicks(next);
        const allRegions = [...item.sourceRegions, ...(item.libraryRegions ?? [])];
        if (allRegions.filter((region) => region.id === op.regionId).length !== 1) throw new Error(`Clip ${op.regionId} must identify exactly one region on ${op.partId}`);
        const split = <T extends NativePart["sourceRegions"][number] | NonNullable<NativePart["libraryRegions"]>[number]>(regions: T[]): T[] => regions.flatMap((region) => {
          if (region.id !== op.regionId) return [region];
          const regionEnd = region.startTick + region.durationTicks;
          const innerStart = Math.max(start, region.startTick), innerEnd = Math.min(end, regionEnd);
          if (innerStart >= innerEnd) throw new Error(`Clip ${region.id} does not overlap ${op.sectionId}`);
          // The shifted material is deliberately cropped at the section edge.
          // The corresponding source position uses original time, so a loop's
          // phase and both untouched outside intervals remain exact.
          const movedStart = Math.max(start, innerStart + op.deltaTicks);
          const movedEnd = Math.min(end, innerEnd + op.deltaTicks);
          if (movedStart >= movedEnd) throw new Error(`Shift would move all of ${region.id} outside ${op.sectionId}`);
          const toSeconds = (ticks: number) => ticks / NATIVE_PPQ * 60 / next.tempoBpm * (region.playbackRate ?? 1);
          const loopTicksRaw = region.playbackMode === "loop" ? region.sourceDurationSeconds / toSeconds(1) : null;
          if (loopTicksRaw !== null && Math.abs(loopTicksRaw - Math.round(loopTicksRaw)) > 1e-6) throw new Error(`Loop ${region.id} cannot be split exactly at this tempo and playback rate`);
          const loopTicks = loopTicksRaw === null ? null : Math.round(loopTicksRaw);
          const result: T[] = [];
          const addSegment = (from: number, to: number, side: string, offset: number) => {
            if (from >= to) return;
            const idFor = (suffix: string) => `r-${canonicalHash({ id: region.id, section: op.sectionId, side: suffix, deltaTicks: op.deltaTicks }).slice(0,24)}`;
            if (loopTicks === null) {
              result.push({ ...region, id: idFor(side), startTick: from + offset, durationTicks: to - from, sourceStartSeconds: region.sourceStartSeconds + toSeconds(from - region.startTick), sourceDurationSeconds: toSeconds(to - from) });
              return;
            }
            const phaseTicks = (from - region.startTick) % loopTicks;
            const tailTicks = phaseTicks ? Math.min(to - from, loopTicks - phaseTicks) : 0;
            if (tailTicks) result.push({ ...region, id: idFor(`${side}-tail`), playbackMode: "once", startTick: from + offset, durationTicks: tailTicks, sourceStartSeconds: region.sourceStartSeconds + toSeconds(phaseTicks), sourceDurationSeconds: toSeconds(tailTicks) });
            if (to - from > tailTicks) result.push({ ...region, id: idFor(side), startTick: from + tailTicks + offset, durationTicks: to - from - tailTicks });
          };
          addSegment(region.startTick, innerStart, "before", 0);
          addSegment(movedStart - op.deltaTicks, movedEnd - op.deltaTicks, "inside", op.deltaTicks);
          addSegment(innerEnd, regionEnd, "after", 0);
          return result;
        });
        item.sourceRegions = split(item.sourceRegions);
        if (item.libraryRegions) item.libraryRegions = split(item.libraryRegions);
        break;
      }
      case "placeMotif": findPart(op.partId).placements.push(op.placement); break;
      case "replacePlacements": findPart(op.partId).placements = op.placements; break;
      case "addNotes": findPart(op.partId).notes.push(...op.notes); break;
      case "replaceNotes": findPart(op.partId).notes = op.notes; break;
      case "setDevice": findPart(op.partId).device = op.device; break;
      case "setMix": { const item = findPart(op.partId); if (op.gain !== undefined) item.gain = op.gain; if (op.pan !== undefined) item.pan = op.pan; break; }
      case "setParallelChain": findPart(op.partId).parallel = op.parallel; break;
      case "removeParallelChain": delete findPart(op.partId).parallel; break;
      case "upsertGroup": { const groups = next.groups ??= []; const index = groups.findIndex((value) => value.id === op.group.id); if (index < 0) groups.push(op.group); else groups[index] = op.group; break; }
      case "setGroupMix": { const group = findGroup(op.groupId); if (op.gain !== undefined) group.gain = op.gain; if (op.pan !== undefined) group.pan = op.pan; if (op.parentId !== undefined) { if (op.parentId) group.parentId = op.parentId; else delete group.parentId; } break; }
      case "addGroupEffect": { const effects = findGroup(op.groupId).effects ??= []; if (effects.some((effect) => effect.id === op.effect.id)) throw new Error(`Duplicate group effect ${op.effect.id}`); const index = op.beforeEffectId ? effects.findIndex((effect) => effect.id === op.beforeEffectId) : effects.length; if (index < 0) throw new Error(`Unknown group effect ${op.beforeEffectId}`); effects.splice(index, 0, op.effect); break; }
      case "replaceGroupEffect": { const effects = findGroup(op.groupId).effects ?? []; const index = effects.findIndex((effect) => effect.id === op.effect.id); if (index < 0) throw new Error(`Unknown group effect ${op.effect.id}`); effects[index] = op.effect; break; }
      case "removeGroupEffect": { const group = findGroup(op.groupId); if (!group.effects?.some((effect) => effect.id === op.effectId)) throw new Error(`Unknown group effect ${op.effectId}`); group.effects = group.effects.filter((effect) => effect.id !== op.effectId); break; }
      case "moveGroupEffect": { const effects = findGroup(op.groupId).effects ?? []; const index = effects.findIndex((effect) => effect.id === op.effectId); if (index < 0) throw new Error(`Unknown group effect ${op.effectId}`); const [effect] = effects.splice(index, 1); const destination = op.beforeEffectId ? effects.findIndex((item) => item.id === op.beforeEffectId) : effects.length; if (destination < 0) throw new Error(`Unknown group effect ${op.beforeEffectId}`); effects.splice(destination, 0, effect!); break; }
      case "setGroupParallel": findGroup(op.groupId).parallel = op.parallel; break;
      case "removeGroupParallel": delete findGroup(op.groupId).parallel; break;
      case "setGroupAutomation": { const curves = findGroup(op.groupId).automation ??= []; const index = curves.findIndex((curve) => curve.id === op.automation.id); if (index < 0) curves.push(op.automation); else curves[index] = op.automation; break; }
      case "removeGroupAutomation": { const group = findGroup(op.groupId); if (!group.automation?.some((curve) => curve.id === op.automationId)) throw new Error(`Unknown group automation ${op.automationId}`); group.automation = group.automation.filter((curve) => curve.id !== op.automationId); break; }
      case "removeGroup": next.groups = (next.groups ?? []).filter((value) => value.id !== op.groupId); break;
      case "routePart": { const item = findPart(op.partId); if (op.groupId) item.groupId = op.groupId; else delete item.groupId; break; }
      case "setReverbBus": next.reverbBus = op.bus; break;
      case "setDelayBus": next.delayBus = op.bus; break;
      case "removeDelayBus": delete next.delayBus; break;
      case "setMaster": next.master = op.master; break;
      case "removeReverbBus": delete next.reverbBus; break;
      case "setSend": { const item = findPart(op.partId); const sends = item.sends ??= []; const index = sends.findIndex((value) => value.busId === op.busId); if (index < 0) sends.push({ busId: op.busId, gain: op.gain }); else sends[index] = { busId: op.busId, gain: op.gain }; break; }
      case "removeSend": { const item = findPart(op.partId); item.sends = (item.sends ?? []).filter((value) => value.busId !== op.busId); break; }
      case "addEffect": findPart(op.partId).effects.push(op.effect); break;
      case "replaceEffect": { const effects = findPart(op.partId).effects; const index = effects.findIndex((value) => value.id === op.effect.id); if (index < 0) throw new Error(`Unknown effect ${op.effect.id}`); effects[index] = op.effect; break; }
      case "removeEffect": { const item = findPart(op.partId); if (!item.effects.some((value) => value.id === op.effectId)) throw new Error(`Unknown effect ${op.effectId}`); item.effects = item.effects.filter((value) => value.id !== op.effectId); break; }
      case "addAutomation": findPart(op.partId).automation.push(op.automation); break;
      case "replaceAutomation": { const curves = findPart(op.partId).automation; const index = curves.findIndex((value) => value.id === op.automation.id); if (index < 0) throw new Error(`Unknown automation ${op.automation.id}`); curves[index] = op.automation; break; }
      case "removeAutomation": { const item = findPart(op.partId); if (!item.automation.some((value) => value.id === op.automationId)) throw new Error(`Unknown automation ${op.automationId}`); item.automation = item.automation.filter((value) => value.id !== op.automationId); break; }
      case "editSectionAutomation": {
        const item = findPart(op.partId);
        const section = next.sections.find((value) => value.id === op.sectionId);
        const index = item.automation.findIndex((value) => value.id === op.automationId);
        if (!section || index < 0) throw new Error("Unknown section or automation curve");
        item.automation[index] = spliceSectionAutomation(item.automation[index]!, op.points, section.startBar * barTicks(next), section.endBar * barTicks(next));
        break;
      }
      case "setSectionEffectFeedback": {
        const item = findPart(op.partId);
        const section = next.sections.find((value) => value.id === op.sectionId);
        const effect = [...item.effects, ...(item.parallel?.effects ?? [])].find((value) => value.id === op.effectId);
        const baseline = effect?.parameters.feedbackFactor;
        if (!section || !effect || (effect.type !== "stompboxReverb" && effect.type !== "stompboxDelay" && effect.type !== "stompboxPitchDelay") || baseline === undefined) throw new Error("A section and reverb/delay effect with explicit feedback baseline are required");
        if (op.feedbackFactor === baseline) throw new Error("Section feedback must differ from its baseline");
        const target = `effect.${effect.id}.feedbackFactor`;
        if (item.automation.some((curve) => curve.target === target)) throw new Error("Feedback already has an automation curve; edit its section instead");
        const start = section.startBar * barTicks(next), end = section.endBar * barTicks(next);
        const points = [ ...(start > 0 ? [{ tick: 0, value: baseline, interpolation: "step" as const }] : []), { tick: start, value: op.feedbackFactor, interpolation: "step" as const }, { tick: end, value: baseline, interpolation: "step" as const } ];
        item.automation.push({ id: `a-${canonicalHash({ partId: item.id, target, sectionId: section.id }).slice(0,24)}`, target, points });
        break;
      }
      case "placeSource": findPart(op.partId).sourceRegions.push(op.region); if (!next.sourceAssetIds.includes(op.region.assetId)) next.sourceAssetIds.push(op.region.assetId); break;
      case "replaceSource": { const item = findPart(op.partId); const index = item.sourceRegions.findIndex((value) => value.id === op.region.id); if (index < 0) throw new Error(`Unknown source region ${op.region.id}`); item.sourceRegions[index] = op.region; if (!next.sourceAssetIds.includes(op.region.assetId)) next.sourceAssetIds.push(op.region.assetId); break; }
      case "removeSource": { const item = findPart(op.partId); if (!item.sourceRegions.some((value) => value.id === op.regionId)) throw new Error(`Unknown source region ${op.regionId}`); item.sourceRegions = item.sourceRegions.filter((value) => value.id !== op.regionId); break; }
      case "placeLibrarySample": { const item = findPart(op.partId); (item.libraryRegions ??= []).push(op.region); break; }
      case "replaceLibrarySample": { const item = findPart(op.partId); const regions = item.libraryRegions ?? []; const index = regions.findIndex((value) => value.id === op.region.id); if (index < 0) throw new Error(`Unknown library region ${op.region.id}`); regions[index] = op.region; break; }
      case "removeLibrarySample": { const item = findPart(op.partId); if (!item.libraryRegions?.some((value) => value.id === op.regionId)) throw new Error(`Unknown library region ${op.regionId}`); item.libraryRegions = item.libraryRegions.filter((value) => value.id !== op.regionId); break; }
      case "protect": next.protectedPartIds = [...new Set([...next.protectedPartIds, ...op.partIds])]; next.protectedMotifIds = [...new Set([...next.protectedMotifIds, ...op.motifIds])]; break;
      case "removePart": next.parts = next.parts.filter((value) => value.id !== op.partId); next.motifs = next.motifs.filter((value) => value.partId !== op.partId); break;
    }
  }
  next.sourceAssetIds = [...new Set(next.parts.flatMap((item) => item.sourceRegions.map((region) => region.assetId)))];
  const validated = nativeDocumentSchema.parse(next);
  assertNativeDeviceMapping(validated);
  for (const [partId, hash] of before) if (protectedPartHash(validated, partId) !== hash) throw new Error(`Protected part ${partId} or its dependencies changed`);
  for (const motifId of base.protectedMotifIds) if (canonicalHash(base.motifs.find((value) => value.id === motifId)) !== canonicalHash(validated.motifs.find((value) => value.id === motifId))) throw new Error(`Protected motif ${motifId} changed`);
  return validated;
}

export function nativeDiff(before: NativeDocument | null, after: NativeDocument) {
  const prior = new Map((before?.parts ?? []).map((value) => [value.id, value]));
  const current = new Map(after.parts.map((value) => [value.id, value]));
  const changed = (a: unknown, b: unknown) => canonicalHash(a === undefined ? null : a) !== canonicalHash(b === undefined ? null : b);
  const partChanges = after.parts.flatMap((value) => {
    const old = prior.get(value.id);
    if (!old) return [];
    const fields: string[] = (["name", "role", "device", "gain", "pan", "groupId", "sends", "notes", "placements", "sourceRegions", "libraryRegions", "effects", "parallel", "automation"] as const).filter((field) => changed(old[field], value[field]));
    if (changed(before?.motifs.filter((motif) => motif.partId === value.id), after.motifs.filter((motif) => motif.partId === value.id))) fields.push("motifs");
    return fields.length ? [{ partId: value.id, fields }] : [];
  });
  const oldSections = new Map((before?.sections ?? []).map((value) => [value.id, value]));
  const newSections = new Map(after.sections.map((value) => [value.id, value]));
  return {
    addedParts: after.parts.filter((value) => !prior.has(value.id)).map((value) => value.id),
    removedParts: (before?.parts ?? []).filter((value) => !current.has(value.id)).map((value) => value.id),
    changedParts: partChanges.map((value) => value.partId),
    partChanges,
    routingChange: before && (changed(before.groups, after.groups) || changed(before.reverbBus, after.reverbBus) || changed(before.delayBus, after.delayBus) || changed(before.master, after.master)) ? { groups: after.groups ?? [], reverbBus: after.reverbBus ?? null, delayBus: after.delayBus ?? null, master: after.master ?? null } : null,
    addedSections: after.sections.filter((value) => !oldSections.has(value.id)).map((value) => value.id),
    removedSections: (before?.sections ?? []).filter((value) => !newSections.has(value.id)).map((value) => value.id),
    changedSections: after.sections.filter((value) => oldSections.has(value.id) && changed(oldSections.get(value.id), value)).map((value) => value.id),
    tempoChange: before && before.tempoBpm !== after.tempoBpm ? { from: before.tempoBpm, to: after.tempoBpm } : null,
    meterChange: before && changed(before.meter, after.meter) ? { from: before.meter, to: after.meter } : null,
    barsChange: before && before.bars !== after.bars ? { from: before.bars, to: after.bars } : null,
    titleChange: before && before.title !== after.title ? { from: before.title, to: after.title } : null,
    protectionChange: { added: after.protectedPartIds.filter((value) => !before?.protectedPartIds.includes(value)), removed: (before?.protectedPartIds ?? []).filter((value) => !after.protectedPartIds.includes(value)) },
    sourceAssetChange: { added: after.sourceAssetIds.filter((value) => !before?.sourceAssetIds.includes(value)), removed: (before?.sourceAssetIds ?? []).filter((value) => !after.sourceAssetIds.includes(value)) },
    noteCount: after.parts.reduce((sum, value) => sum + materializedNotes(after, value.id).length, 0),
    protectedPartIds: after.protectedPartIds
  };
}

export function pinnedContext(document: NativeDocument, revisionId: string | null, remote: { state: string; projectId: string | null; observedHash: string | null } = { state: "local", projectId: null, observedHash: null }) {
  return {
    revisionId, documentHash: canonicalHash(document), briefHash: canonicalHash(document.direction), briefLength: document.direction.length,
    currentObjective: document.currentObjective, assumptions: document.assumptions,
    tempoBpm: document.tempoBpm, meter: document.meter, bars: document.bars,
    sections: document.sections.map((value) => ({ id: value.id, name: value.name, bars: [value.startBar, value.endBar], intent: value.intent })),
    groups: document.groups ?? [], reverbBus: document.reverbBus ?? null, delayBus: document.delayBus ?? null, master: document.master ?? null,
    parts: document.parts.map((value) => ({ id: value.id, name: value.name, role: value.role, device: value.device.type, preset: value.device.preset ?? null, groupId: value.groupId ?? null, sends: value.sends ?? [], notes: materializedNotes(document, value.id).length, effects: value.effects.map((effect) => effect.type), parallel: value.parallel ? { wetMix: value.parallel.wetMix, effects: value.parallel.effects.map((effect) => effect.type) } : null, automation: value.automation.map((curve) => curve.target), sourceRegions: value.sourceRegions.length, libraryRegions: value.libraryRegions?.length ?? 0, protected: document.protectedPartIds.includes(value.id) })),
    motifs: document.motifs.map((value) => ({ id: value.id, partId: value.partId, name: value.name, familyId: value.familyId ?? (value.derivedFromMotifId ? null : value.id), derivedFromMotifId: value.derivedFromMotifId ?? null, instances: document.parts.flatMap((item) => item.placements).filter((placement) => placement.motifId === value.id).length })),
    sources: document.parts.flatMap((value) => value.sourceRegions.map((region) => ({ assetId: region.assetId, assetHash: region.assetHash, selectedInterval: [region.sourceStartSeconds, region.sourceStartSeconds + region.sourceDurationSeconds], state: "placed/referenced" as const }))),
    librarySamples: document.parts.flatMap((value) => (value.libraryRegions ?? []).map((region) => ({ sampleName: region.sampleName, ownerName: region.ownerName, selectedInterval: [region.sourceStartSeconds, region.sourceStartSeconds + region.sourceDurationSeconds], state: "placed/referenced; availability rechecked at validation/sync" as const }))),
    audio: document.audio.state, remote
  };
}

export function analyzeNativeSection(document: NativeDocument, sectionId: string, focusPartId?: string) {
  const section = document.sections.find((value) => value.id === sectionId);
  if (!section) throw new Error(`Unknown section ${sectionId}`);
  const start = section.startBar * barTicks(document);
  const end = section.endBar * barTicks(document);
  const overlaps = (position: number, duration: number) => position < end && position + duration > start;
  return {
    documentHash: canonicalHash(document), section, boundsTicks: [start, end],
    parts: document.parts.map((part) => {
      const notes = materializedNotes(document, part.id).filter((event) => overlaps(event.startTick, event.durationTicks));
      const onsets = notes.filter((event) => event.startTick >= start && event.startTick < end);
      const placements = part.placements.filter((value) => {
        const motif = document.motifs.find((candidate) => candidate.id === value.motifId)!;
        return overlaps(value.startTick, motif.lengthTicks * value.repeats);
      });
      const sources = part.sourceRegions.filter((value) => overlaps(value.startTick, value.durationTicks));
      const librarySources = (part.libraryRegions ?? []).filter((value) => overlaps(value.startTick, value.durationTicks));
      return {
        id: part.id, name: part.name, role: part.role,
        soundingNotes: notes.length, newOnsets: onsets.length,
        onsetsPerBar: Number((onsets.length / (section.endBar - section.startBar)).toFixed(2)),
        noteRange: notes.length ? [Math.min(...notes.map((value) => value.pitch)), Math.max(...notes.map((value) => value.pitch))] : null,
        velocityRange: notes.length ? [Math.min(...notes.map((value) => value.velocity)), Math.max(...notes.map((value) => value.velocity))] : null,
        ...(focusPartId === part.id ? { notePreview: notes.slice(0, 8) } : {}),
        placements: placements.map((value) => ({ id: value.id, motifId: value.motifId, repeats: value.repeats, startsBeforeSection: value.startTick < start })),
        sourceRegions: sources.map((value) => ({ id: value.id, assetId: value.assetId, startsBeforeSection: value.startTick < start })),
        libraryRegions: librarySources.map((value) => ({ id: value.id, sampleName: value.sampleName, startsBeforeSection: value.startTick < start })),
        automationTargets: part.automation.filter((curve) => curve.points.some((point) => point.tick >= start && point.tick < end) || (curve.points[0]?.tick ?? Infinity) < start && (curve.points.at(-1)?.tick ?? -Infinity) > start).map((curve) => curve.target)
      };
    })
  };
}
