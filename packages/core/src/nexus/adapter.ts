import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeWav } from "../audio/wav.js";
import type { Composition } from "../domain/composition.js";

export interface NexusStemPart {
  trackId: string;
  role: string;
  stemPath: string;
  fidelity: "editable-stem";
  positionTicks: 0;
  durationTicks: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
}

export interface NexusExportManifest {
  mappingVersion: "nexus-stem-v2";
  revisionId: string;
  tempoBpm: number;
  ppq: 960;
  durationTicks: number;
  sections: Composition["sections"];
  parts: NexusStemPart[];
  liveProject: { status: "needs-auth"; requiredClientConfiguration: ["AUDIOTOOL_CLIENT_ID", "AUDIOTOOL_REDIRECT_URL", "AUDIOTOOL_SCOPES"] };
}

export interface OfflineMappingEvidence {
  regionCount: number;
  trackCount: number;
  tempoBpm: number;
  durationTicks: number;
}

interface InsertTransaction {
  insertSample(sample: { name: string; durationSeconds: number; bpm?: number }, options: { sample: { bpm: number }; region: { positionTicks: number; durationTicks: number } }): unknown;
}

interface OfflineDocumentShape {
  modify(run: (transaction: InsertTransaction) => void): Promise<unknown>;
  queryEntities: { ofTypes(type: "audioRegion" | "audioTrack"): { get(): unknown[] } };
}

export interface AudiotoolExportClient {
  projects: { createProject(request: { project: { displayName: string } }): Promise<{ project?: { name: string } } | Error> };
  samples: { upload(options: { file: ArrayBuffer; displayName: string; bpm: number; kind: "loop"; visibility: "private"; tags: string[] }, signal?: AbortSignal): Promise<{ uploaded: Promise<undefined | Error>; ready: Promise<{ name: string } | Error> } | Error> };
  open(project: string): Promise<{ start(): Promise<void>; stop(): Promise<void>; modify(run: (transaction: InsertTransaction) => void): Promise<unknown>; dawUrl: string }>;
}

export async function probeNexusNodeAdapter(): Promise<{ packageVersion: "0.0.17"; offlineDocumentCreated: boolean; standaloneRenderer: false }> {
  const nexusNode = await import("@audiotool/nexus/node") as unknown as { createOfflineDocument(options?: { validated?: boolean }): Promise<unknown> };
  const document = await nexusNode.createOfflineDocument({ validated: true });
  return { packageVersion: "0.0.17", offlineDocumentCreated: Boolean(document), standaloneRenderer: false };
}

export async function validateOfflineNexusMapping(manifest: NexusExportManifest): Promise<OfflineMappingEvidence> {
  const nexusNode = await import("@audiotool/nexus/node") as unknown as { createOfflineDocument(options?: { validated?: boolean }): Promise<OfflineDocumentShape> };
  const document = await nexusNode.createOfflineDocument({ validated: true });
  await document.modify((transaction) => {
    for (const part of manifest.parts) {
      transaction.insertSample(
        { name: `samples/pocket-producer-${part.trackId}`, durationSeconds: part.durationSeconds, bpm: manifest.tempoBpm },
        { sample: { bpm: manifest.tempoBpm }, region: { positionTicks: part.positionTicks, durationTicks: part.durationTicks } }
      );
    }
  });
  return {
    regionCount: document.queryEntities.ofTypes("audioRegion").get().length,
    trackCount: document.queryEntities.ofTypes("audioTrack").get().length,
    tempoBpm: manifest.tempoBpm,
    durationTicks: manifest.durationTicks
  };
}

export async function writeNexusManifest(input: { revisionId: string; composition: Composition; stems: Record<string, string>; outputDirectory: string }): Promise<{ path: string; manifest: NexusExportManifest; evidence: OfflineMappingEvidence }> {
  const parts: NexusStemPart[] = [];
  for (const track of input.composition.tracks) {
    const stemPath = input.stems[track.id];
    if (!stemPath) throw new Error(`Nexus export is missing the ${track.id} stem`);
    const decoded = decodeWav(await readFile(stemPath), { maxDurationSeconds: 120 });
    parts.push({
      trackId: track.id,
      role: track.role,
      stemPath,
      fidelity: "editable-stem",
      positionTicks: 0,
      durationTicks: input.composition.durationTicks,
      durationSeconds: decoded.durationSeconds,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels.length
    });
  }
  const manifest: NexusExportManifest = {
    mappingVersion: "nexus-stem-v2",
    revisionId: input.revisionId,
    tempoBpm: input.composition.tempoBpm,
    ppq: 960,
    durationTicks: input.composition.durationTicks,
    sections: input.composition.sections,
    parts,
    liveProject: { status: "needs-auth", requiredClientConfiguration: ["AUDIOTOOL_CLIENT_ID", "AUDIOTOOL_REDIRECT_URL", "AUDIOTOOL_SCOPES"] }
  };
  const evidence = await validateOfflineNexusMapping(manifest);
  if (evidence.regionCount !== parts.length || evidence.trackCount !== parts.length) throw new Error("Nexus offline mapping did not produce one editable audio track per stem");
  await mkdir(input.outputDirectory, { recursive: true });
  const path = join(input.outputDirectory, `nexus-${input.revisionId}.json`);
  await writeFile(path, `${JSON.stringify({ ...manifest, offlineValidation: evidence }, null, 2)}\n`, "utf8");
  return { path, manifest, evidence };
}

function bounded<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    timer.unref?.();
    void promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error("Nexus operation failed")); });
  });
}

export interface AudiotoolExportCheckpoint {
  remoteProjectId: string;
  uploadedSamples: Record<string, string>;
}

export async function exportManifestToAudiotool(input: {
  client: AudiotoolExportClient;
  manifest: NexusExportManifest;
  title: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  resume?: Partial<AudiotoolExportCheckpoint>;
  checkpoint?(value: AudiotoolExportCheckpoint): Promise<void>;
}): Promise<{ projectId: string; studioUrl: string; uploadedSamples: Record<string, string> }> {
  const timeoutMs = Math.min(120_000, Math.max(1_000, input.timeoutMs ?? 60_000));
  let projectId = input.resume?.remoteProjectId;
  const uploadedSamples = { ...(input.resume?.uploadedSamples ?? {}) };
  if (!projectId) {
    const created = await bounded(input.client.projects.createProject({ project: { displayName: input.title.slice(0, 120) } }), timeoutMs, "Audiotool project creation");
    if (created instanceof Error) throw created;
    projectId = created.project?.name;
    if (!projectId) throw new Error("Audiotool project creation returned no project name");
    await input.checkpoint?.({ remoteProjectId: projectId, uploadedSamples });
  }

  for (const part of input.manifest.parts) {
    if (uploadedSamples[part.trackId]) continue;
    const bytes = await readFile(part.stemPath);
    const file = Uint8Array.from(bytes).buffer;
    const upload = await bounded(input.client.samples.upload({ file, displayName: `Pocket Producer · ${part.role}`, bpm: input.manifest.tempoBpm, kind: "loop", visibility: "private", tags: ["pocket-producer", part.role] }, input.signal), timeoutMs, `Audiotool ${part.role} upload`);
    if (upload instanceof Error) throw upload;
    const uploaded = await bounded(upload.uploaded, timeoutMs, `Audiotool ${part.role} byte upload`);
    if (uploaded instanceof Error) throw uploaded;
    const ready = await bounded(upload.ready, timeoutMs, `Audiotool ${part.role} processing`);
    if (ready instanceof Error) throw ready;
    uploadedSamples[part.trackId] = ready.name;
    await input.checkpoint?.({ remoteProjectId: projectId, uploadedSamples });
  }

  const document = await bounded(input.client.open(projectId), timeoutMs, "Audiotool project open");
  try {
    await bounded(document.start(), timeoutMs, "Audiotool project sync");
    await document.modify((transaction) => {
      for (const part of input.manifest.parts) {
        const name = uploadedSamples[part.trackId];
        if (!name) throw new Error(`Audiotool upload checkpoint is missing ${part.trackId}`);
        transaction.insertSample(
          { name, durationSeconds: part.durationSeconds, bpm: input.manifest.tempoBpm },
          { sample: { bpm: input.manifest.tempoBpm }, region: { positionTicks: 0, durationTicks: part.durationTicks } }
        );
      }
    });
    return { projectId, studioUrl: document.dawUrl, uploadedSamples };
  } finally {
    await bounded(document.stop(), timeoutMs, "Audiotool project stop");
  }
}
