import type { AudiotoolClient } from "@audiotool/nexus";
import type { NativeDocument } from "./model.js";
import { canonicalHash } from "../domain/composition.js";

export type NativeLibraryClient = Pick<AudiotoolClient, "samples" | "presets">;
export type NativePreset = Awaited<ReturnType<NativeLibraryClient["presets"]["get"]>>;
export interface LibrarySample { kind: "sample"; name: string; displayName: string; ownerName: string; durationSeconds: number; bpm: number; sampleKind: "one-shot" | "loop"; visibility: "public" | "unlisted"; tags: string[] }
export interface LibraryPreset { kind: "preset"; name: string; displayName: string; ownerName: string; deviceType: string; tags: string[]; contentHash: string }

export function nativePresetFingerprint(preset: NativePreset): string {
  if (!preset.data || typeof preset.data !== "object") throw new NativeLibraryError("invalid", "Preset has no inspectable configuration data");
  return canonicalHash({ deviceType: preset.entityType, data: preset.data });
}

export class NativeLibraryError extends Error {
  readonly statusCode: number;
  constructor(readonly code: "unavailable" | "not-found" | "invalid" | "provider-failed", message: string) { super(message); this.name = "NativeLibraryError"; this.statusCode = code === "not-found" ? 404 : code === "invalid" ? 422 : 409; }
}

const sampleName = /^samples\/[a-zA-Z0-9-]{1,120}$/;
const presetName = /^presets\/[a-zA-Z0-9-]{1,120}$/;
const allowedPresetTypes = ["heisenberg", "pulverisateur", "gakki", "beatbox8"] as const;
export type NativePresetType = typeof allowedPresetTypes[number];

export interface NativeLibrary {
  searchSamples(query: string, pageToken?: string): Promise<{ samples: LibrarySample[]; nextPageToken: string; provenance: "Audiotool sample metadata; usage rights are not inferred from visibility" }>;
  getSample(name: string): Promise<LibrarySample>;
  searchPresets(deviceType: NativePresetType, query: string): Promise<{ presets: LibraryPreset[]; provenance: "Audiotool preset metadata" }>;
  getPreset(name: string): Promise<{ metadata: LibraryPreset; preset: NativePreset }>;
  searchGmSounds(query: string, family: "instrument" | "drums"): Promise<{ sounds: Array<{ id: string; slug: string; displayName: string; category: string; program: number; description?: string }>; provenance: "Pinned Nexus GM catalog; selection still requires a live preset fetch" }>;
  getGmSound(slug: string, family: "instrument" | "drums"): Promise<{ metadata: LibraryPreset; preset: NativePreset }>;
}

export function createNativeLibrary(client: NativeLibraryClient | null): NativeLibrary {
  const requireClient = () => { if (!client) throw new NativeLibraryError("unavailable", "Connect Audiotool before searching its sound library"); return client; };
  const normalizeSample = (value: Awaited<ReturnType<NativeLibraryClient["samples"]["get"]>>): LibrarySample => {
    if (value instanceof Error) throw new NativeLibraryError("not-found", value.message);
    if (!sampleName.test(value.name) || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0) throw new NativeLibraryError("invalid", "Sample has no usable identity or duration");
    return { kind: "sample", name: value.name, displayName: value.displayName, ownerName: value.ownerName, durationSeconds: value.durationSeconds, bpm: value.bpm, sampleKind: value.kind, visibility: value.visibility, tags: [...value.tags] };
  };
  const normalizePreset = (value: NativePreset): LibraryPreset => {
    const type = value.entityType;
    if (!presetName.test(value.meta.name) || !allowedPresetTypes.some((candidate) => candidate === type)) throw new NativeLibraryError("invalid", "Preset is not compatible with a supported native instrument");
    return { kind: "preset", name: value.meta.name, displayName: value.meta.displayName, ownerName: value.meta.ownerName, deviceType: type, tags: [...value.meta.tags], contentHash: nativePresetFingerprint(value) };
  };
  return {
    async searchSamples(query: string, pageToken = "") {
      const trimmed = query.trim();
      if (!trimmed || trimmed.length > 80 || pageToken.length > 500) throw new NativeLibraryError("invalid", "Use a short sample search query");
      try {
        const result = await requireClient().samples.list({ textSearch: trimmed, pageSize: 12, ...(pageToken ? { pageToken } : {}) });
        if (result instanceof Error) throw new NativeLibraryError("provider-failed", result.message);
        return { samples: result.samples.map(normalizeSample), nextPageToken: result.nextPageToken, provenance: "Audiotool sample metadata; usage rights are not inferred from visibility" as const };
      } catch (error) { if (error instanceof NativeLibraryError) throw error; throw new NativeLibraryError("provider-failed", error instanceof Error ? error.message : "Sample search failed"); }
    },
    async getSample(name: string) {
      if (!sampleName.test(name)) throw new NativeLibraryError("invalid", "Invalid sample identifier");
      try { return normalizeSample(await requireClient().samples.get(name)); }
      catch (error) { if (error instanceof NativeLibraryError) throw error; throw new NativeLibraryError("provider-failed", error instanceof Error ? error.message : "Sample lookup failed"); }
    },
    async searchPresets(deviceType: NativePresetType, query: string) {
      if (!allowedPresetTypes.includes(deviceType) || query.length > 80) throw new NativeLibraryError("invalid", "Unsupported preset search");
      try { return { presets: (await requireClient().presets.search(deviceType, query.trim())).slice(0, 12).map(normalizePreset), provenance: "Audiotool preset metadata" as const }; }
      catch (error) { if (error instanceof NativeLibraryError) throw error; throw new NativeLibraryError("provider-failed", error instanceof Error ? error.message : "Preset search failed"); }
    },
    async getPreset(name: string) {
      if (!presetName.test(name)) throw new NativeLibraryError("invalid", "Invalid preset identifier");
      try { const preset = await requireClient().presets.get(name); return { metadata: normalizePreset(preset), preset }; }
      catch (error) { if (error instanceof NativeLibraryError) throw error; throw new NativeLibraryError("provider-failed", error instanceof Error ? error.message : "Preset lookup failed"); }
    },
    searchGmSounds(query: string, family: "instrument" | "drums") {
      if (query.length > 80) throw new NativeLibraryError("invalid", "Use a short sound search query");
      const presets = requireClient().presets;
      const items = family === "drums" ? presets.gmDrums : presets.gmInstruments;
      const needle = query.trim().toLowerCase();
      const sounds = items.filter((item) => !needle || `${item.displayName} ${item.category} ${item.tags.join(" ")} ${item.description ?? ""}`.toLowerCase().includes(needle)).slice(0, 16).map((item) => ({ id: item.id, slug: item.slug, displayName: item.displayName, category: item.category, program: item.program, ...(item.description ? { description: item.description } : {}) }));
      return Promise.resolve({ sounds, provenance: "Pinned Nexus GM catalog; selection still requires a live preset fetch" as const });
    },
    async getGmSound(slug: string, family: "instrument" | "drums") {
      const presets = requireClient().presets;
      const item = family === "drums" ? presets.gmDrums.find((value) => value.slug === slug) : presets.gmInstruments.find((value) => value.slug === slug);
      if (!item) throw new NativeLibraryError("not-found", "The requested GM sound is not in the pinned catalog");
      return this.getPreset(item.id);
    }
  };
}

export async function resolveNativePresets(document: NativeDocument, library: NativeLibrary | null): Promise<Record<string, NativePreset>> {
  const references = document.parts.flatMap((part) => part.device.preset ? [{ type: part.device.type, reference: part.device.preset }] : []);
  if (references.length && !library) throw new NativeLibraryError("unavailable", "This arrangement uses Audiotool presets; reconnect before validation or synchronization");
  const result: Record<string, NativePreset> = {};
  for (const { type, reference } of references) {
    if (result[reference.name]) continue;
    const resolved = await library!.getPreset(reference.name);
    if (resolved.metadata.deviceType !== type || resolved.metadata.displayName !== reference.displayName || resolved.metadata.ownerName !== reference.ownerName) throw new NativeLibraryError("invalid", `Preset ${reference.name} changed or is no longer compatible`);
    if (!reference.contentHash) throw new NativeLibraryError("invalid", `Historical preset ${reference.name} has no accepted configuration fingerprint; explicitly reselect it in a new revision before synchronization`);
    if (resolved.metadata.contentHash !== reference.contentHash) throw new NativeLibraryError("invalid", `Preset ${reference.name} configuration changed; explicitly choose the new sound in a revision`);
    result[reference.name] = resolved.preset;
  }
  return result;
}

export async function resolveNativeSamples(document: NativeDocument, library: NativeLibrary | null): Promise<Record<string, LibrarySample>> {
  const references = document.parts.flatMap((part) => part.libraryRegions ?? []);
  if (references.length && !library) throw new NativeLibraryError("unavailable", "This arrangement uses Audiotool samples; reconnect before validation or synchronization");
  const result: Record<string, LibrarySample> = {};
  for (const region of references) {
    const sample = result[region.sampleName] ?? await library!.getSample(region.sampleName);
    if (sample.ownerName !== region.ownerName || sample.displayName !== region.displayName || Math.abs(sample.durationSeconds - region.durationSeconds) > 0.001) throw new NativeLibraryError("invalid", `Library sample ${region.sampleName} changed or is no longer available`);
    result[region.sampleName] = sample;
  }
  return result;
}
