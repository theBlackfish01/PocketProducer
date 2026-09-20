import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Composition } from "../domain/composition.js";

export interface NexusExportManifest {
  mappingVersion: "nexus-stem-v1";
  revisionId: string;
  tempoBpm: number;
  sections: Composition["sections"];
  parts: Array<{ trackId: string; role: string; stemPath: string; fidelity: "editable-stem" }>;
  liveProject: { status: "needs-auth"; requiredClientConfiguration: ["AUDIOTOOL_CLIENT_ID", "AUDIOTOOL_REDIRECT_URL", "AUDIOTOOL_SCOPES"] };
}

export async function probeNexusNodeAdapter(): Promise<{ packageVersion: "0.0.17"; offlineDocumentCreated: boolean; standaloneRenderer: false }> {
  const nexusNode = await import("@audiotool/nexus/node") as unknown as { createOfflineDocument(options?: { validated?: boolean }): Promise<unknown> };
  const document = await nexusNode.createOfflineDocument({ validated: true });
  return { packageVersion: "0.0.17", offlineDocumentCreated: Boolean(document), standaloneRenderer: false };
}

export async function writeNexusManifest(input: { revisionId: string; composition: Composition; stems: Record<string, string>; outputDirectory: string }): Promise<{ path: string; manifest: NexusExportManifest }> {
  const manifest: NexusExportManifest = {
    mappingVersion: "nexus-stem-v1",
    revisionId: input.revisionId,
    tempoBpm: input.composition.tempoBpm,
    sections: input.composition.sections,
    parts: input.composition.tracks.map((track) => ({ trackId: track.id, role: track.role, stemPath: input.stems[track.id] ?? "", fidelity: "editable-stem" })),
    liveProject: { status: "needs-auth", requiredClientConfiguration: ["AUDIOTOOL_CLIENT_ID", "AUDIOTOOL_REDIRECT_URL", "AUDIOTOOL_SCOPES"] }
  };
  await mkdir(input.outputDirectory, { recursive: true });
  const path = join(input.outputDirectory, `nexus-${input.revisionId}.json`);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { path, manifest };
}
