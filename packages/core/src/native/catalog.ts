import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSchemaLocationDetails, schemaPathToSchemaLocation, type SchemaPath } from "@audiotool/nexus/document";

export const NATIVE_CATALOG_VERSION = "nexus-0.0.17-schema-v1";
const writable = new Set(["config", "groove", "mixerMaster", "mixerChannel", "desktopAudioCable", "heisenberg", "pulverisateur", "gakki", "beatbox8", "beatbox8Pattern", "noteTrack", "noteCollection", "noteRegion", "note", "patternTrack", "patternRegion", "stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter", "automationTrack", "automationRegion", "automationCollection", "automationEvent"]);
const musicalMeaning: Record<string, { family: string; purpose: string; caveat?: string }> = {
  heisenberg: { family: "instrument", purpose: "Subtractive synth for basses, pads and leads." },
  pulverisateur: { family: "instrument", purpose: "Alternate pitched synth voice for contrasting timbres." },
  kobolt: { family: "routing", purpose: "Multichannel audio mixer, not a pitched instrument.", caveat: "Not yet writable through Pocket Producer." },
  gakki: { family: "instrument", purpose: "Pitched sampler/instrument voice; preset behavior must be checked before use." },
  beatbox8: { family: "drums", purpose: "Native drum machine with editable channels and patterns." },
  beatbox8Pattern: { family: "drums", purpose: "Reusable drum-machine rhythm pattern." },
  note: { family: "notes", purpose: "Editable pitch, velocity, onset and duration in a note collection." },
  noteRegion: { family: "arrangement", purpose: "Places a reusable note collection on a track." },
  audioRegion: { family: "sources", purpose: "Places a source clip with a selected interval; placement does not prove audibility.", caveat: "Discoverable; native source upload and interval mapping remain deferred." },
  sample: { family: "sources", purpose: "Native sample reference; use only an owned or authorized sample identifier.", caveat: "Discoverable; Pocket Producer does not upload native samples yet." },
  mixerChannel: { family: "routing", purpose: "Part channel with gain and pan routing." },
  desktopAudioCable: { family: "routing", purpose: "Connects an instrument or effect output to a compatible audio input." },
  stompboxDelay: { family: "effect", purpose: "Time-based repeats; timing and feedback need bounded parameter checks." },
  stompboxReverb: { family: "effect", purpose: "Spatial decay; structure cannot prove mix quality." },
  stompboxCompressor: { family: "effect", purpose: "Dynamics control; structural presence does not establish loudness quality." },
  stompboxParametricEqualizer: { family: "effect", purpose: "Frequency shaping on a routed signal." },
  autoFilter: { family: "effect", purpose: "Filter movement and modulation." },
  automationEvent: { family: "automation", purpose: "A time-addressed parameter value in a native automation collection." }
};

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
  const normalized = query.trim().toLowerCase();
  const roots = await schemaRoots();
  return { version: NATIVE_CATALOG_VERSION, totalEntities: roots.length, matches: roots.filter((type) => !normalized || `${type} ${musicalMeaning[type]?.family ?? ""} ${musicalMeaning[type]?.purpose ?? ""}`.toLowerCase().includes(normalized)).slice(0, Math.max(1, Math.min(64, limit))).map((type) => ({ type, family: musicalMeaning[type]?.family ?? "other", purpose: musicalMeaning[type]?.purpose ?? "SDK entity; inspect schema before using it", caveat: musicalMeaning[type]?.caveat ?? null, discoverable: true, writableInPocketProducer: writable.has(type), offlineValidated: writable.has(type), liveSynchronized: false, audioVerified: false })) };
}

export async function inspectNativeCapability(path: string) {
  if (!/^\/[A-Za-z0-9]+(?:\/(?:[A-Za-z0-9]+|\[[0-9]+\]))*$/.test(path) || path.length > 160) throw new Error("Invalid Nexus schema path");
  const root = path.split("/")[1]!;
  if (!(await schemaRoots()).includes(root)) throw new Error("Nexus entity is not in the pinned schema");
  const details = getSchemaLocationDetails(schemaPathToSchemaLocation(path as SchemaPath));
  return { version: NATIVE_CATALOG_VERSION, path, musical: musicalMeaning[root] ?? { family: "other", purpose: "Not yet curated for construction", caveat: "Discovery does not imply writable support" }, writableInPocketProducer: writable.has(root), schema: details };
}
