import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OfflineDocument } from "@audiotool/nexus/node";
import type { SafeTransactionBuilder } from "@audiotool/nexus/document";
import { secondsToTicks, Ticks, ticksToSeconds } from "@audiotool/nexus/utils";
import { decodeWav } from "../audio/wav.js";
import { compositionSourceLineage, type Composition } from "../domain/composition.js";

const CANONICAL_PPQ = 960;
export const NEXUS_MAPPING_VERSION = "nexus-stem-v3" as const;

export function canonicalTicksToNexus(ticks: number): number {
  return Math.round(ticks * (Ticks.Beat / CANONICAL_PPQ));
}

export interface NexusStemPart {
  trackId: string;
  role: string;
  stemPath: string;
  fidelity: "editable-stem";
  positionCanonicalTicks: 0;
  positionNexusTicks: 0;
  musicalBodyCanonicalTicks: number;
  musicalBodyNexusTicks: number;
  audioDurationNexusTicks: number;
  tailNexusTicks: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  intentionallySilent: boolean;
}

export interface NexusExportManifest {
  mappingVersion: typeof NEXUS_MAPPING_VERSION;
  revisionId: string;
  tempoBpm: number;
  canonicalPpq: 960;
  nexusPpq: 3840;
  musicalBodyCanonicalTicks: number;
  musicalBodyNexusTicks: number;
  musicalBodySeconds: number;
  tailSeconds: number;
  projectDurationNexusTicks: number;
  sections: Array<Composition["sections"][number] & { startNexusTicks: number; endNexusTicks: number }>;
  sourceLineage: ReturnType<typeof compositionSourceLineage>;
  parts: NexusStemPart[];
  liveProject: { status: "needs-auth"; requiredClientConfiguration: ["AUDIOTOOL_CLIENT_ID", "AUDIOTOOL_REDIRECT_URL", "AUDIOTOOL_SCOPES"] };
}

export interface OfflineMappingEvidence {
  regionCount: number;
  trackCount: number;
  routedTrackCount: number;
  enabledTrackCount: number;
  tempoBpm: number;
  signature: "4/4";
  projectDurationNexusTicks: number;
  projectDurationSeconds: number;
  regions: Array<{ id: string; trackId: string; positionNexusTicks: number; durationNexusTicks: number; durationSeconds: number; displayName: string }>;
}

export type ExportStepState = "never_dispatched" | "in_flight" | "succeeded" | "failed" | "uncertain";
export interface ExportStepCheckpoint { state: ExportStepState; remoteId?: string; evidence?: Record<string, unknown> }
export interface AudiotoolExportCheckpoint {
  remoteProjectId?: string;
  uploadedSamples: Record<string, string>;
  project: ExportStepCheckpoint;
  uploads: Record<string, ExportStepCheckpoint>;
  arrangement: ExportStepCheckpoint;
  studioUrl?: string;
}

export class NexusOperationError extends Error {
  constructor(
    readonly kind: "cancelled" | "deadline" | "definitive" | "uncertain",
    readonly step: string,
    message: string,
    override readonly cause?: unknown
  ) {
    super(message);
    this.name = "NexusOperationError";
  }
}

type InsertTransaction = Pick<SafeTransactionBuilder, "insertSample" | "entities" | "update" | "create">;

export interface AudiotoolExportClient {
  projects: { createProject(request: { project: { displayName: string } }): Promise<{ project?: { name: string } } | Error> };
  samples: { upload(options: { file: ArrayBuffer; displayName: string; bpm: number; kind: "loop"; visibility: "unlisted"; tags: string[] }, signal?: AbortSignal): Promise<{ uploaded: Promise<unknown>; ready: Promise<{ name: string } | Error> } | Error> };
  open(project: string): Promise<{ start(): Promise<void>; stop(): Promise<void>; modify(run: (transaction: InsertTransaction) => void): Promise<unknown>; dawUrl: string }>;
}

export async function probeNexusNodeAdapter(): Promise<{ packageVersion: "0.0.17"; offlineDocumentCreated: boolean; standaloneRenderer: false }> {
  const document = await createOfflineNexusDocument();
  return { packageVersion: "0.0.17", offlineDocumentCreated: Boolean(document), standaloneRenderer: false };
}

export async function createOfflineNexusDocument(): Promise<OfflineDocument> {
  const { createOfflineDocument } = await import("@audiotool/nexus/node");
  return createOfflineDocument({ validated: true });
}

function insertManifest(transaction: InsertTransaction, manifest: NexusExportManifest, sampleNames?: Record<string, string>): void {
  const existingConfig = transaction.entities.ofTypes("config").getOne();
  const config = existingConfig ?? (() => {
    const groove = transaction.create("groove", { functionIndex: 1, durationTicks: 1_920, impact: 0, displayName: "Pocket Producer straight" });
    return transaction.create("config", { defaultGroove: groove.location });
  })();
  transaction.update(config.fields.tempoBpm, manifest.tempoBpm);
  transaction.update(config.fields.signatureNumerator, 4);
  transaction.update(config.fields.signatureDenominator, 4);
  transaction.update(config.fields.durationTicks, manifest.projectDurationNexusTicks);
  for (const part of manifest.parts) {
    // Offline validation needs a schema-valid resource name, not a globally
    // addressable upload name. The live path supplies the server-issued name.
    const localSampleName = `samples/pp-${part.role}`;
    transaction.insertSample(
      {
        name: sampleNames?.[part.trackId] ?? localSampleName,
        durationSeconds: part.durationSeconds,
        bpm: manifest.tempoBpm
      },
      {
        sample: { musicDurationTicks: part.audioDurationNexusTicks },
        region: { positionTicks: part.positionNexusTicks, durationTicks: part.audioDurationNexusTicks },
        displayName: `Pocket Producer · ${part.role}`,
        loop: false
      }
    );
  }
}

function readOfflineEvidence(document: OfflineDocument): OfflineMappingEvidence {
  const config = document.queryEntities.ofTypes("config").getOne();
  if (!config) throw new Error("Nexus readback found no Config entity");
  const tracks = document.queryEntities.ofTypes("audioTrack").get();
  const regions = document.queryEntities.ofTypes("audioRegion").get();
  const trackIds = new Set(tracks.map((track) => track.id));
  const evidenceRegions = regions.map((region) => ({
    id: region.id,
    trackId: region.fields.track.value.entityId,
    positionNexusTicks: region.fields.region.fields.positionTicks.value,
    durationNexusTicks: region.fields.region.fields.durationTicks.value,
    durationSeconds: ticksToSeconds(region.fields.region.fields.durationTicks.value, config.fields.tempoBpm.value),
    displayName: region.fields.region.fields.displayName.value
  }));
  return {
    regionCount: regions.length,
    trackCount: tracks.length,
    routedTrackCount: new Set(evidenceRegions.filter((region) => trackIds.has(region.trackId)).map((region) => region.trackId)).size,
    enabledTrackCount: tracks.filter((track) => track.fields.isEnabled.value).length,
    tempoBpm: config.fields.tempoBpm.value,
    signature: `${config.fields.signatureNumerator.value}/${config.fields.signatureDenominator.value}` as "4/4",
    projectDurationNexusTicks: config.fields.durationTicks.value,
    projectDurationSeconds: ticksToSeconds(config.fields.durationTicks.value, config.fields.tempoBpm.value),
    regions: evidenceRegions.sort((a, b) => a.displayName.localeCompare(b.displayName))
  };
}

export async function validateOfflineNexusMapping(manifest: NexusExportManifest): Promise<OfflineMappingEvidence> {
  const document = await createOfflineNexusDocument();
  await document.modify((transaction) => insertManifest(transaction, manifest));
  return readOfflineEvidence(document);
}

export async function writeNexusManifest(input: { revisionId: string; composition: Composition; stems: Record<string, string>; outputDirectory: string }): Promise<{ path: string; manifest: NexusExportManifest; evidence: OfflineMappingEvidence }> {
  const musicalBodyNexusTicks = canonicalTicksToNexus(input.composition.durationTicks);
  const musicalBodySeconds = ticksToSeconds(musicalBodyNexusTicks, input.composition.tempoBpm);
  const expectedDurationSeconds = musicalBodySeconds + input.composition.tailSeconds;
  const parts: NexusStemPart[] = [];
  for (const track of input.composition.tracks) {
    const stemPath = input.stems[track.id];
    if (!stemPath) throw new Error(`Nexus export is missing the ${track.id} stem`);
    const decoded = decodeWav(await readFile(stemPath), { maxDurationSeconds: 120 });
    if (Math.abs(decoded.durationSeconds - expectedDurationSeconds) > 0.05) {
      throw new Error(`Nexus export ${track.id} stem duration does not match the musical body plus render tail`);
    }
    const audioDurationNexusTicks = Math.round(secondsToTicks(decoded.durationSeconds, input.composition.tempoBpm));
    parts.push({
      trackId: track.id,
      role: track.role,
      stemPath,
      fidelity: "editable-stem",
      positionCanonicalTicks: 0,
      positionNexusTicks: 0,
      musicalBodyCanonicalTicks: input.composition.durationTicks,
      musicalBodyNexusTicks,
      audioDurationNexusTicks,
      tailNexusTicks: audioDurationNexusTicks - musicalBodyNexusTicks,
      durationSeconds: decoded.durationSeconds,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels.length,
      intentionallySilent: track.events.length === 0
    });
  }
  const projectDurationNexusTicks = Math.max(...parts.map((part) => part.audioDurationNexusTicks));
  const manifest: NexusExportManifest = {
    mappingVersion: NEXUS_MAPPING_VERSION,
    revisionId: input.revisionId,
    tempoBpm: input.composition.tempoBpm,
    canonicalPpq: CANONICAL_PPQ,
    nexusPpq: Ticks.Beat,
    musicalBodyCanonicalTicks: input.composition.durationTicks,
    musicalBodyNexusTicks,
    musicalBodySeconds,
    tailSeconds: input.composition.tailSeconds,
    projectDurationNexusTicks,
    sections: input.composition.sections.map((section) => ({ ...section, startNexusTicks: canonicalTicksToNexus(section.startTick), endNexusTicks: canonicalTicksToNexus(section.endTick) })),
    sourceLineage: compositionSourceLineage(input.composition),
    parts,
    liveProject: { status: "needs-auth", requiredClientConfiguration: ["AUDIOTOOL_CLIENT_ID", "AUDIOTOOL_REDIRECT_URL", "AUDIOTOOL_SCOPES"] }
  };
  const evidence = await validateOfflineNexusMapping(manifest);
  const exactRegions = evidence.regions.every((region) => region.positionNexusTicks === 0 && region.durationNexusTicks === projectDurationNexusTicks);
  if (evidence.regionCount !== parts.length || evidence.trackCount !== parts.length || evidence.routedTrackCount !== parts.length || evidence.enabledTrackCount !== parts.length || !exactRegions || evidence.tempoBpm !== manifest.tempoBpm || evidence.projectDurationNexusTicks !== projectDurationNexusTicks) {
    throw new Error("Nexus offline readback did not match the requested tempo, timing, routing and four-stem layout");
  }
  await mkdir(input.outputDirectory, { recursive: true });
  const path = join(input.outputDirectory, `nexus-${input.revisionId}.json`);
  await writeFile(path, `${JSON.stringify({ ...manifest, offlineValidation: evidence }, null, 2)}\n`, "utf8");
  return { path, manifest, evidence };
}

function initialCheckpoint(resume?: Partial<AudiotoolExportCheckpoint>): AudiotoolExportCheckpoint {
  const remoteProjectId = resume?.remoteProjectId;
  const uploadedSamples = { ...(resume?.uploadedSamples ?? {}) };
  return {
    ...(remoteProjectId ? { remoteProjectId } : {}),
    uploadedSamples,
    project: resume?.project ?? (remoteProjectId ? { state: "succeeded", remoteId: remoteProjectId } : { state: "never_dispatched" }),
    uploads: { ...(resume?.uploads ?? {}), ...Object.fromEntries(Object.entries(uploadedSamples).map(([key, remoteId]) => [key, { state: "succeeded", remoteId } satisfies ExportStepCheckpoint])) },
    arrangement: resume?.arrangement ?? { state: "never_dispatched" },
    ...(resume?.studioUrl ? { studioUrl: resume.studioUrl } : {})
  };
}

function throwBeforeDispatch(signal: AbortSignal | undefined, deadlineAt: number, step: string): void {
  if (signal?.aborted) throw new NexusOperationError("cancelled", step, `${step} cancelled before dispatch`, signal.reason);
  if (Date.now() >= deadlineAt) throw new NexusOperationError("deadline", step, `${step} exceeded the operation deadline before dispatch`);
}

async function boundedStep<T>(start: () => Promise<T>, deadlineAt: number, step: string, mutation: boolean, signal?: AbortSignal): Promise<T> {
  throwBeforeDispatch(signal, deadlineAt, step);
  const remaining = deadlineAt - Date.now();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const detail = error instanceof Error ? error.message : String(error);
      const kind = mutation ? "uncertain" : signal?.aborted ? "cancelled" : timedOut ? "deadline" : "definitive";
      reject(new NexusOperationError(kind, step, `${step}: ${detail}`, error));
    };
    const onAbort = () => fail(signal?.reason ?? new Error("cancelled"));
    const timer = setTimeout(() => fail(new Error("operation deadline expired"), true), remaining);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    void start().then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    }, (error: unknown) => fail(error));
  });
}

function failedStep(error: unknown): ExportStepCheckpoint {
  if (error instanceof NexusOperationError) {
    if (error.kind === "cancelled" || error.kind === "deadline") return { state: "never_dispatched" };
    if (error.kind === "definitive") return { state: "failed" };
  }
  return { state: "uncertain" };
}

export async function exportManifestToAudiotool(input: {
  client: AudiotoolExportClient;
  manifest: NexusExportManifest;
  title: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  resume?: Partial<AudiotoolExportCheckpoint>;
  checkpoint?(value: AudiotoolExportCheckpoint): Promise<void>;
}): Promise<{ projectId: string; studioUrl: string; uploadedSamples: Record<string, string>; checkpoint: AudiotoolExportCheckpoint; shutdownWarning?: string }> {
  const deadlineAt = Date.now() + Math.min(120_000, Math.max(1_000, input.timeoutMs ?? 60_000));
  const state = initialCheckpoint(input.resume);
  const save = async () => input.checkpoint?.(structuredClone(state));
  if (state.project.state === "uncertain" || state.arrangement.state === "uncertain") {
    throw new NexusOperationError("uncertain", state.project.state === "uncertain" ? "project:create" : "arrangement:insert", "The prior mutation has an unresolved outcome; automatic replay is fenced.");
  }
  if (!state.remoteProjectId) {
    state.project = { state: "in_flight" };
    await save();
    try {
      const created = await boundedStep(() => input.client.projects.createProject({ project: { displayName: input.title.slice(0, 120) } }), deadlineAt, "project:create", true, input.signal);
      if (created instanceof Error) throw new NexusOperationError("definitive", "project:create", created.message, created);
      const projectId = created.project?.name;
      if (!projectId) throw new NexusOperationError("uncertain", "project:create", "Audiotool project creation returned no durable project identity");
      state.remoteProjectId = projectId;
      state.project = { state: "succeeded", remoteId: projectId };
      await save();
    } catch (error) {
      state.project = failedStep(error);
      await save();
      throw error;
    }
  }
  const projectId = state.remoteProjectId;
  if (!projectId) throw new Error("Audiotool checkpoint lost its project identity");

  for (const part of input.manifest.parts) {
    const stepKey = `upload:${part.trackId}`;
    const prior = state.uploads[part.trackId];
    if (prior?.state === "succeeded" && prior.remoteId) {
      state.uploadedSamples[part.trackId] = prior.remoteId;
      continue;
    }
    if (prior?.state === "uncertain") throw new NexusOperationError("uncertain", stepKey, `${stepKey} has an unresolved prior outcome; automatic upload replay is fenced.`);
    throwBeforeDispatch(input.signal, deadlineAt, stepKey);
    state.uploads[part.trackId] = { state: "in_flight" };
    await save();
    try {
      const bytes = await readFile(part.stemPath);
      throwBeforeDispatch(input.signal, deadlineAt, stepKey);
      const file = Uint8Array.from(bytes).buffer;
      const upload = await boundedStep(() => input.client.samples.upload({ file, displayName: `Pocket Producer · ${part.role}`, bpm: input.manifest.tempoBpm, kind: "loop", visibility: "unlisted", tags: ["pocket-producer", part.role, input.manifest.mappingVersion] }, input.signal), deadlineAt, `${stepKey}:accept`, true, input.signal);
      if (upload instanceof Error) throw new NexusOperationError("definitive", `${stepKey}:accept`, upload.message, upload);
      const uploaded = await boundedStep(() => upload.uploaded, deadlineAt, `${stepKey}:bytes`, true, input.signal);
      if (uploaded instanceof Error) throw new NexusOperationError("definitive", `${stepKey}:bytes`, uploaded.message, uploaded);
      // The server accepted and may have completed the upload before this poll.
      // Losing the outcome is therefore ambiguous and must fence automatic replay.
      const ready = await boundedStep(() => upload.ready, deadlineAt, `${stepKey}:ready`, true, input.signal);
      if (ready instanceof Error) throw new NexusOperationError("definitive", `${stepKey}:ready`, ready.message, ready);
      state.uploadedSamples[part.trackId] = ready.name;
      state.uploads[part.trackId] = { state: "succeeded", remoteId: ready.name };
      await save();
    } catch (error) {
      state.uploads[part.trackId] = failedStep(error);
      await save();
      throw error;
    }
  }

  if (state.arrangement.state === "succeeded" && state.studioUrl) {
    return { projectId, studioUrl: state.studioUrl, uploadedSamples: state.uploadedSamples, checkpoint: state };
  }

  const document = await boundedStep(() => input.client.open(projectId), deadlineAt, "project:open", false, input.signal);
  let result: { projectId: string; studioUrl: string; uploadedSamples: Record<string, string>; checkpoint: AudiotoolExportCheckpoint; shutdownWarning?: string } | undefined;
  let primaryError: unknown;
  try {
    await boundedStep(() => document.start(), deadlineAt, "project:start", false, input.signal);
    throwBeforeDispatch(input.signal, deadlineAt, "arrangement:insert");
    state.arrangement = { state: "in_flight" };
    await save();
    try {
      await boundedStep(
        () => document.modify((transaction) => insertManifest(transaction, input.manifest, state.uploadedSamples)),
        deadlineAt,
        "arrangement:insert",
        true,
        input.signal
      );
      state.arrangement = { state: "succeeded", evidence: { mappingVersion: input.manifest.mappingVersion, trackCount: input.manifest.parts.length } };
      state.studioUrl = document.dawUrl;
      await save();
      result = { projectId, studioUrl: document.dawUrl, uploadedSamples: state.uploadedSamples, checkpoint: state };
    } catch (error) {
      state.arrangement = failedStep(error);
      await save();
      throw error;
    }
  } catch (error) {
    primaryError = error;
  }

  try {
    await boundedStep(() => document.stop(), deadlineAt, "project:stop", false, undefined);
  } catch (error) {
    if (result) result.shutdownWarning = error instanceof Error ? error.message : "Audiotool shutdown reporting failed";
    else if (!primaryError) primaryError = error;
  }
  if (primaryError) throw primaryError instanceof Error ? primaryError : new Error("Audiotool export failed with a non-Error rejection");
  if (!result) throw new Error("Audiotool export finished without a result");
  return result;
}
