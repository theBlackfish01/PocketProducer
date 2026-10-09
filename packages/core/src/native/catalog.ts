import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSchemaLocationDetails, schemaPathToSchemaLocation, type SchemaPath } from "@audiotool/nexus/document";
import { nativeParameterRanges } from "./model.js";

export const NATIVE_CATALOG_VERSION = "nexus-0.0.17-schema-v2";
export class NativeSchemaPathError extends Error {
  constructor(message: string) { super(message); this.name = "NativeSchemaPathError"; }
}
const writable = new Set(["config", "groove", "mixerMaster", "mixerChannel", "mixerGroup", "mixerStripGrouping", "mixerReverbAux", "mixerDelayAux", "mixerAuxRoute", "mixerSideChainCable", "desktopAudioCable", "audioSplitter", "audioMerger", "heisenberg", "pulverisateur", "gakki", "beatbox8", "beatbox8Pattern", "noteTrack", "noteCollection", "noteRegion", "note", "patternTrack", "patternRegion", "stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter", "stompboxTube", "stompboxChorus", "stompboxPitchDelay", "automationTrack", "automationRegion", "automationCollection", "automationEvent", "sample", "audioDevice", "audioTrack", "audioRegion"]);
const musicalMeaning: Record<string, { family: string; purpose: string; caveat?: string }> = {
  heisenberg: { family: "instrument", purpose: "FM/operator synth with filter, envelopes and modulation for basses, pads and leads." },
  pulverisateur: { family: "instrument", purpose: "Alternate pitched synth voice for contrasting timbres." },
  kobolt: { family: "routing", purpose: "Multichannel audio mixer, not a pitched instrument.", caveat: "Not yet writable through Pocket Producer." },
  gakki: { family: "instrument", purpose: "Pitched sampler/instrument voice; preset behavior must be checked before use." },
  beatbox8: { family: "drums", purpose: "Native drum machine with editable channels and patterns." },
  beatbox8Pattern: { family: "drums", purpose: "Reusable drum-machine rhythm pattern." },
  note: { family: "notes", purpose: "Editable pitch, velocity, onset and duration in a note collection." },
  noteRegion: { family: "arrangement", purpose: "Places a reusable note collection on a track." },
  audioRegion: { family: "sources", purpose: "Places a ready owned sample with source offset and selected once/loop interval; placement does not prove audibility.", caveat: "Offline SDK-mapped; remote upload/readback not live-verified in this pass." },
  sample: { family: "sources", purpose: "Ready owned sample identity supplied by a fenced server upload.", caveat: "Never model-authored; remote upload/readback not live-verified in this pass." },
  audioDevice: { family: "routing", purpose: "Playback device and channel path created by the pinned sample insertion helper." },
  audioTrack: { family: "arrangement", purpose: "Timeline track for one or more ready owned sample regions." },
  mixerChannel: { family: "routing", purpose: "Part channel with gain and pan routing." },
  mixerGroup: { family: "routing", purpose: "Shared part group with gain/pan, ordered insert effects, a dry/wet parallel chain, automation and a supported sidechain source." },
  mixerReverbAux: { family: "routing", purpose: "Shared reverb return selected by part send levels." },
  mixerDelayAux: { family: "routing", purpose: "One shared tempo-stepped delay return selected by part send levels." },
  mixerSideChainCable: { family: "routing", purpose: "Validated control link from a part channel to a group compressor." },
  desktopAudioCable: { family: "routing", purpose: "Connects an instrument or effect output to a compatible audio input." },
  audioSplitter: { family: "routing", purpose: "Duplicates a part or shared group signal into separate dry and processed paths." },
  audioMerger: { family: "routing", purpose: "Blends a part or shared group's dry and processed paths." },
  stompboxDelay: { family: "effect", purpose: "Time-based repeats; timing and feedback need bounded parameter checks." },
  stompboxReverb: { family: "effect", purpose: "Spatial decay; structure cannot prove mix quality." },
  stompboxCompressor: { family: "effect", purpose: "Dynamics control; structural presence does not establish loudness quality." },
  stompboxParametricEqualizer: { family: "effect", purpose: "Frequency shaping on a routed signal." },
  autoFilter: { family: "effect", purpose: "Filter movement and modulation." },
  stompboxTube: { family: "effect", purpose: "Tube-style harmonic saturation on one routed signal." },
  stompboxChorus: { family: "effect", purpose: "Modulated stereo width on one routed signal." },
  stompboxPitchDelay: { family: "effect", purpose: "Tempo-stepped repeats with per-repeat pitch movement." },
  automationEvent: { family: "automation", purpose: "A time-addressed parameter value in a native automation collection." }
};

export function nativeOperationContract(root: string) {
  const parameters = root in nativeParameterRanges ? nativeParameterRanges[root as keyof typeof nativeParameterRanges] : null;
  const operations = root === "sample" || root === "audioRegion" || root === "audioTrack" || root === "audioDevice"
    ? ["create via ready owned or resolved Audiotool sample mapping", "inspect", "readback"]
    : root === "mixerChannel" || root === "desktopAudioCable" ? ["create validated part route", "inspect", "readback"]
      : parameters ? ["create", "replace/edit mapped parameters", "remove via part/effect operation", "inspect", "readback"]
        : writable.has(root) ? ["create through validated domain operation", "inspect", "readback"] : ["inspect SDK schema only"];
  return { operations, mappedParameters: parameters, prerequisite: root === "sample" || root === "audioRegion" ? "Owned ready WAV with known upload outcome, or an exact resolved Audiotool library sample; neither implies usage rights" : null, offlineVerified: writable.has(root), liveVerified: false };
}

let rootsPromise: Promise<string[]> | undefined;
async function schemaRoots(): Promise<string[]> {
  rootsPromise ??= (async () => {
    const exported = fileURLToPath(import.meta.resolve("@audiotool/nexus/document"));
    const declarations = resolve(dirname(exported), "gen/audiotool/document/v1/utils/path.d.ts");
    const source = await readFile(declarations, "utf8");
    const line = source.split("\n").find((value) => value.startsWith("export type SchemaPath ="));
    if (!line) throw new Error("Pinned Nexus schema path declaration is unavailable");
    return [...new Set([...line.matchAll(/Submessage<"([A-Za-z0-9]+)"/g)].map((match) => match[1]!))].sort();
  })();
  return rootsPromise;
}

export async function discoverNativeCapabilities(query = "", limit = 24) {
  const ignored = new Set(["the", "a", "an", "for", "with", "and", "of", "in", "to", "parameter", "parameters", "ranges", "range", "mapping", "native", "device"]);
  const words = (text: string) => text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const terms = [...new Set(words(query).filter((term) => !ignored.has(term)))];
  const roots = await schemaRoots();
  const named = roots.filter((root) => query.toLowerCase().includes(root.toLowerCase()));
  const ranked = roots.map((type) => {
    const contract = nativeOperationContract(type);
    const text = words(`${type} ${musicalMeaning[type]?.family ?? ""} ${musicalMeaning[type]?.purpose ?? ""} ${Object.keys(contract.mappedParameters ?? {}).join(" ")}`).join(" ");
    const exact = named.some((root) => type.toLowerCase().startsWith(root.toLowerCase()));
    const score = (exact ? 100 : 0) + terms.reduce((sum, term) => sum + (text.includes(term) ? 2 : 0), 0);
    return { type, score, exact };
  }).filter((item) => !terms.length || (named.length ? item.exact : item.score > 0))
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
  return { version: NATIVE_CATALOG_VERSION, totalEntities: roots.length,
    guidance: ranked.length ? "Use inspect_editable_sound for canonical controls on an existing part. SDK slash paths are discovery only, never write paths."
      : "No matching capability. Try an instrument name (heisenberg, beatbox8), filter, reverb, routing or automation; inspect_editable_sound returns writable controls for an existing part.",
    pathExample: "/beatbox8Pattern/length", pathFormat: "/entity/field; use a root returned in matches and slash-separated schema fields",
    matches: ranked.slice(0, Math.max(1, Math.min(64, limit))).map(({ type, score }) => ({ type, relevance: score, family: musicalMeaning[type]?.family ?? "other", purpose: musicalMeaning[type]?.purpose ?? "SDK entity; inspect schema before using it", caveat: musicalMeaning[type]?.caveat ?? null, discoverable: true, writableInPocketProducer: writable.has(type), operationContract: nativeOperationContract(type), offlineValidated: writable.has(type), liveSynchronized: false, audioVerified: false })) };
}

export async function inspectNativeCapability(path: string) {
  if (!/^\/[A-Za-z0-9]+(?:\/(?:[A-Za-z0-9]+|\[[0-9]+\]))*$/.test(path) || path.length > 160) throw new NativeSchemaPathError("Invalid Nexus schema path");
  const root = path.split("/")[1]!;
  if (!(await schemaRoots()).includes(root)) throw new NativeSchemaPathError("Nexus entity is not in the pinned schema");
  let details: ReturnType<typeof getSchemaLocationDetails>;
  try { details = getSchemaLocationDetails(schemaPathToSchemaLocation(path as SchemaPath)); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("can't find field ")) throw new NativeSchemaPathError("Field is not in the pinned Nexus schema");
    throw error;
  }
  return { version: NATIVE_CATALOG_VERSION, path, musical: musicalMeaning[root] ?? { family: "other", purpose: "Not yet curated for construction", caveat: "Discovery does not imply writable support" }, writableInPocketProducer: writable.has(root), operationContract: nativeOperationContract(root), schema: details };
}
