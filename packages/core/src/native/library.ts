import type { AudiotoolClient } from "@audiotool/nexus";
import { createHash } from "node:crypto";
import type { NativeDocument } from "./model.js";
import { canonicalHash } from "../domain/hash.js";
import { profileOwnedSourceWav, type NativeSourceProfile } from "./resources.js";

export type NativeLibraryClient = Pick<AudiotoolClient, "samples" | "presets">;
export type NativePreset = Awaited<ReturnType<NativeLibraryClient["presets"]["get"]>>;
export interface LibrarySample { kind: "sample"; name: string; displayName: string; ownerName: string; durationSeconds: number; bpm: number; sampleKind: "one-shot" | "loop"; visibility: "public" | "unlisted"; tags: string[] }
export interface LibraryPreset { kind: "preset"; name: string; displayName: string; ownerName: string; deviceType: string; tags: string[]; contentHash: string }
export interface SampleSearchFilters { kind?: "one-shot" | "loop" | undefined; minBpm?: number | undefined; maxBpm?: number | undefined; minSeconds?: number | undefined; maxSeconds?: number | undefined; tag?: string | undefined }
export interface InspectedSampleAudio { sample: LibrarySample; contentHash: string; measured: NativeSourceProfile; provenance: "Decoded selected WAV bytes from Audiotool; not a full-project render" }

export function nativePresetFingerprint(preset: NativePreset): string {
  if (!preset.data || typeof preset.data !== "object") throw new NativeLibraryError("invalid", "Preset has no inspectable configuration data");
  return canonicalHash({ deviceType: preset.entityType, data: preset.data });
}

export class NativeLibraryError extends Error {
  readonly statusCode: number;
  constructor(readonly code: "unavailable" | "not-found" | "invalid" | "provider-failed" | "unauthorized", message: string) { super(message); this.name = "NativeLibraryError"; this.statusCode = code === "not-found" ? 404 : code === "invalid" ? 422 : code === "unauthorized" ? 401 : 409; }
}

// The SDK raises Connect errors carrying a numeric status code. Classify by that
// code; a missing or unknown code stays a provider failure (never a guess).
const connectStatus = { invalidArgument: 3, notFound: 5, permissionDenied: 7, unauthenticated: 16 } as const;
export function libraryFailure(error: unknown, fallback: string): NativeLibraryError {
  if (error instanceof NativeLibraryError) return error;
  const message = error instanceof Error ? error.message : fallback;
  const status = error instanceof Error && "code" in error && typeof error.code === "number" ? error.code : null;
  if (status === connectStatus.notFound) return new NativeLibraryError("not-found", message);
  if (status === connectStatus.invalidArgument) return new NativeLibraryError("invalid", message);
  if (status === connectStatus.unauthenticated || status === connectStatus.permissionDenied) return new NativeLibraryError("unauthorized", message);
  return new NativeLibraryError("provider-failed", message);
}

const sampleName = /^samples\/[a-zA-Z0-9-]{1,120}$/;
const presetName = /^presets\/[a-zA-Z0-9-]{1,120}$/;
const allowedPresetTypes = ["heisenberg", "pulverisateur", "gakki", "beatbox8"] as const;
export type NativePresetType = typeof allowedPresetTypes[number];

export interface NativeLibrary {
  searchSamples(query: string, pageToken?: string, filters?: SampleSearchFilters): Promise<{ samples: LibrarySample[]; nextPageToken: string; provenance: "Audiotool sample metadata; usage rights are not inferred from visibility" }>;
  getSample(name: string): Promise<LibrarySample>;
  readSampleAudio(name: string): Promise<InspectedSampleAudio & { bytes: Buffer }>;
  inspectSampleAudio(name: string): Promise<InspectedSampleAudio>;
  searchPresets(deviceType: NativePresetType, query: string): Promise<{ presets: LibraryPreset[]; provenance: "Audiotool preset metadata" }>;
  getPreset(name: string): Promise<{ metadata: LibraryPreset; preset: NativePreset }>;
  searchGmSounds(query: string, family: "instrument" | "drums"): Promise<{ sounds: Array<{ id: string; slug: string; displayName: string; category: string; program: number; description?: string }>; provenance: "Pinned Nexus GM catalog; selection still requires a live preset fetch" }>;
  getGmSound(slug: string, family: "instrument" | "drums"): Promise<{ metadata: LibraryPreset; preset: NativePreset }>;
}

// Scoped to the exact authenticated SDK client object. A new connection never
// inherits another connection's search results. Only metadata searches are
// cached; apply/synchronization identity checks always call the provider.
const searchCaches = new WeakMap<object, Map<string, { until: number; result: Promise<unknown> }>>();
function cachedSearch<T>(client: object, key: string, load: () => Promise<T>): Promise<T> {
  let cache = searchCaches.get(client);
  if (!cache) { cache = new Map(); searchCaches.set(client, cache); }
  const existing = cache.get(key);
  if (existing && existing.until > Date.now()) return existing.result as Promise<T>;
  if (existing) cache.delete(key);
  const result = load().catch((error: unknown) => { if (cache?.get(key)?.result === result) cache.delete(key); throw error; });
  cache.set(key, { until: Date.now() + 60_000, result });
  while (cache.size > 64) cache.delete(cache.keys().next().value!);
  return result;
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
    async searchSamples(query: string, pageToken = "", filters: SampleSearchFilters = {}) {
      const trimmed = query.trim();
      if (!trimmed || trimmed.length > 80 || pageToken.length > 500) throw new NativeLibraryError("invalid", "Use a short sample search query");
      if (filters.tag && !/^[a-z0-9 -]{1,40}$/i.test(filters.tag)) throw new NativeLibraryError("invalid", "Use a simple tag without filter syntax");
      for (const value of [filters.minBpm, filters.maxBpm, filters.minSeconds, filters.maxSeconds]) if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 600)) throw new NativeLibraryError("invalid", "Sample search bounds must be within 0–600");
      try {
        const active = requireClient();
        return await cachedSearch(active, canonicalHash({ v: 1, query: trimmed.toLowerCase().replace(/\s+/g, " "), pageToken, filters }), async () => {
          const result = await active.samples.list({ textSearch: trimmed, pageSize: 24, ...(pageToken ? { pageToken } : {}) });
          if (result instanceof Error) throw new NativeLibraryError("provider-failed", result.message);
          const samples = result.samples.map(normalizeSample).filter((sample) =>
            (!filters.kind || sample.sampleKind === filters.kind) && (filters.minBpm === undefined || sample.bpm >= filters.minBpm)
            && (filters.maxBpm === undefined || sample.bpm <= filters.maxBpm) && (filters.minSeconds === undefined || sample.durationSeconds >= filters.minSeconds)
            && (filters.maxSeconds === undefined || sample.durationSeconds <= filters.maxSeconds)
            && (!filters.tag || sample.tags.some((tag) => tag.toLowerCase() === filters.tag!.toLowerCase()))
          ).slice(0, 12);
          return { samples, nextPageToken: result.nextPageToken, provenance: "Audiotool sample metadata; usage rights are not inferred from visibility" as const };
        });
      } catch (error) { throw libraryFailure(error, "Sample search failed"); }
    },
    async getSample(name: string) {
      if (!sampleName.test(name)) throw new NativeLibraryError("invalid", "Invalid sample identifier");
      try { return normalizeSample(await requireClient().samples.get(name)); }
      catch (error) { throw libraryFailure(error, "Sample lookup failed"); }
    },
    async readSampleAudio(name: string) {
      if (!sampleName.test(name)) throw new NativeLibraryError("invalid", "Invalid sample identifier");
      const active = requireClient();
      const sample = await this.getSample(name);
      if (sample.durationSeconds > 30) throw new NativeLibraryError("invalid", "Sample audio inspection is limited to 30 seconds; use metadata and manual interval selection for longer files");
      try {
        const blob = await active.samples.download(name, { format: "wav" });
        if (blob instanceof Error) throw new NativeLibraryError("provider-failed", blob.message);
        if (blob.size > 12_000_000) throw new NativeLibraryError("invalid", "Sample WAV exceeds the 12 MB inspection bound");
        const bytes = Buffer.from(await blob.arrayBuffer());
        const measured = profileOwnedSourceWav(bytes);
        if (measured.durationSeconds > 30) throw new NativeLibraryError("invalid", "Decoded sample exceeds the 30-second inspection bound");
        return { sample, bytes, contentHash: createHash("sha256").update(bytes).digest("hex"), measured, provenance: "Decoded selected WAV bytes from Audiotool; not a full-project render" as const };
      } catch (error) { throw libraryFailure(error, "Sample audio could not be inspected"); }
    },
    async inspectSampleAudio(name: string) {
      const inspected = await this.readSampleAudio(name);
      return { sample: inspected.sample, contentHash: inspected.contentHash, measured: inspected.measured, provenance: inspected.provenance };
    },
    async searchPresets(deviceType: NativePresetType, query: string) {
      if (!allowedPresetTypes.includes(deviceType) || query.length > 80) throw new NativeLibraryError("invalid", "Unsupported preset search");
      try { return { presets: (await requireClient().presets.search(deviceType, query.trim())).slice(0, 12).map(normalizePreset), provenance: "Audiotool preset metadata" as const }; }
      catch (error) { throw libraryFailure(error, "Preset search failed"); }
    },
    async getPreset(name: string) {
      if (!presetName.test(name)) throw new NativeLibraryError("invalid", "Invalid preset identifier");
      try {
        const preset: unknown = await requireClient().presets.get(name);
        if (preset instanceof Error) throw preset;
        return { metadata: normalizePreset(preset as NativePreset), preset: preset as NativePreset };
      } catch (error) { throw libraryFailure(error, "Preset lookup failed"); }
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
      try {
        const preset = family === "drums" ? await presets.getDrums(item as typeof presets.gmDrums[number]) : await presets.getInstrument(item as typeof presets.gmInstruments[number]);
        return { metadata: normalizePreset(preset), preset };
      } catch (error) { throw libraryFailure(error, "GM sound lookup failed"); }
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
  const verifiedHashes = new Map<string, string>();
  for (const region of references) {
    const sample = result[region.sampleName] ?? await library!.getSample(region.sampleName);
    if (sample.ownerName !== region.ownerName || sample.displayName !== region.displayName || Math.abs(sample.durationSeconds - region.durationSeconds) > 0.001) throw new NativeLibraryError("invalid", `Library sample ${region.sampleName} changed or is no longer available`);
    if (region.contentHash) {
      let actual = verifiedHashes.get(region.sampleName);
      if (!actual) { actual = (await library!.inspectSampleAudio(region.sampleName)).contentHash; verifiedHashes.set(region.sampleName, actual); }
      if (actual !== region.contentHash) throw new NativeLibraryError("invalid", `Library sample ${region.sampleName} bytes changed; select a new version before synchronization`);
    }
    result[region.sampleName] = sample;
  }
  return result;
}
