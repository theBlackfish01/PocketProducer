import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AudiotoolClient } from "@audiotool/nexus";
import { getConfig } from "../config.js";
import { closePool } from "../db/pool.js";
import { devOwnerId } from "../db/repository.js";
import { createAudiotoolServerClient, loadAudiotoolSession } from "./session.js";

// This probes a generated DocumentService RPC via the public authorizedFetch
// transport. Nexus 0.0.17 does not publish this RPC as an AudiotoolClient method;
// even a successful response here is experimental, not a supported renderer API.
const evidenceDir = resolve(".local/evidence/nexus-native-2026-09-23");
const checkpointPath = resolve(evidenceDir, "checkpoint.json");
const maxAudioBytes = 15_000_000;
interface Checkpoint {
  phase: string;
  projectName?: string;
  initialRender?: RenderState;
  revisedRender?: RenderState;
  initialUnauthorizedProbe?: RenderState;
  initialAuthRetryUsed?: boolean;
}
interface RenderState { phase: "in_flight" | "operation" | "succeeded" | "failed" | "uncertain"; operationName?: string; httpStatus?: number; reason?: string; audioPath?: string; audioBytes?: number; format?: string; operationLookups?: Array<{ service: string; httpStatus: number; reason?: string }> }

async function save(checkpoint: Checkpoint) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
}

function safeProviderUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !(url.hostname.endsWith(".audiotool.com") || url.hostname.endsWith(".audiotl.com"))) {
    throw new Error("Audiotool returned a URL outside its provider hosts");
  }
  return url;
}

async function rpc(client: AudiotoolClient, authorization: string, baseUrl: URL, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = new URL(method, baseUrl);
  const response = await client.authorizedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Connect-Protocol-Version": "1", Authorization: authorization },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  if (response instanceof Error) throw response;
  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, json };
}

function reasonFrom(json: Record<string, unknown>): string {
  const code = typeof json.code === "string" ? json.code : "unknown";
  const message = typeof json.message === "string" ? json.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 180) : "no provider message";
  return `${code}: ${message}`;
}

async function downloadAudio(client: AudiotoolClient, authorization: string, urls: Record<string, unknown>, phase: "initial" | "revised") {
  const format = ["mp3", "ogg"].find((candidate) => typeof urls[candidate] === "string");
  if (!format) throw new Error("Render completed without a directly playable MP3 or OGG URL");
  const url = safeProviderUrl(String(urls[format]));
  const response = await client.authorizedFetch(url, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(30_000) });
  if (response instanceof Error) throw response;
  if (!response.ok) throw new Error(`Audio download failed with HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxAudioBytes) throw new Error("Rendered audio exceeds the probe's 15 MB download cap");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxAudioBytes) throw new Error("Rendered audio is empty or exceeds the probe cap");
  const audioPath = resolve(evidenceDir, `${phase}.${format}`);
  await writeFile(audioPath, bytes);
  return { audioPath, audioBytes: bytes.length, format };
}

async function main() {
  const command = process.argv[2];
  if (command !== "initial" && command !== "revised" && command !== "poll-initial" && command !== "poll-revised") throw new Error("Usage: pnpm spike:nexus-render [initial|revised|poll-initial|poll-revised]");
  const polling = command.startsWith("poll-");
  const phase: "initial" | "revised" = command === "initial" || command === "poll-initial" ? "initial" : "revised";
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
  if (!checkpoint.projectName || (phase === "initial" && checkpoint.phase !== "inserted") || (phase === "revised" && checkpoint.phase !== "revised")) {
    throw new Error("Native scratch project is not at the required note state");
  }
  const key = phase === "initial" ? "initialRender" : "revisedRender";
  if (!polling && phase === "initial" && checkpoint.initialRender?.httpStatus === 401 && checkpoint.initialRender.reason?.includes("no (auth) headers provided") && !checkpoint.initialAuthRetryUsed) {
    checkpoint.initialUnauthorizedProbe = checkpoint.initialRender;
    checkpoint.initialAuthRetryUsed = true;
    delete checkpoint.initialRender;
    await save(checkpoint);
  }
  if (!polling && checkpoint[key]) throw new Error(`${phase} render has already been dispatched or completed; refusing duplicate`);
  if (polling && !checkpoint[key]?.operationName) throw new Error(`No ${phase} render operation to poll`);
  const config = getConfig();
  if (!config.AUDIOTOOL_CLIENT_ID) throw new Error("Audiotool client ID is not configured");
  const ownerId = await devOwnerId();
  const connection = await createAudiotoolServerClient(ownerId, config.AUDIOTOOL_CLIENT_ID);
  if (!connection) throw new Error("Audiotool browser session is unavailable");
  const session = await loadAudiotoolSession(ownerId);
  if (!session) throw new Error("Audiotool browser session disappeared");
  const authorization = `Bearer ${session.tokens.accessToken}`;
  const client = connection.client as AudiotoolClient;
  const opened = await client.projects.openSession({ projectName: checkpoint.projectName });
  if (opened instanceof Error || !opened.session?.documentServiceUrl) throw opened instanceof Error ? opened : new Error("SDK returned no DocumentService URL");
  const service = safeProviderUrl(opened.session.documentServiceUrl);
  if (polling) {
    const operationName = checkpoint[key]!.operationName!;
    const operationLookups: NonNullable<RenderState["operationLookups"]> = [];
    for (const [label, base] of [["regional", service], ["global", safeProviderUrl("https://rpc.audiotool.com/")]] as const) {
      const polled = await rpc(client, authorization, base, "/audiotool.longrunning.v1.OperationService/GetOperation", { name: operationName });
      operationLookups.push({ service: label, httpStatus: polled.status, ...(polled.status !== 200 ? { reason: reasonFrom(polled.json) } : {}) });
      console.log(JSON.stringify({ lookup: label, httpStatus: polled.status, ...(polled.status !== 200 ? { reason: reasonFrom(polled.json) } : { done: Boolean(((polled.json.operation ?? polled.json) as Record<string, unknown>).done) }) }));
      if (polled.status === 200) {
        const operation = (polled.json.operation ?? polled.json) as Record<string, unknown>;
        if (operation.done === true && !operation.error) {
          const result = (operation.response ?? {}) as Record<string, unknown>;
          const urls = (result.downloadUrls ?? result.download_urls ?? {}) as Record<string, unknown>;
          const audio = await downloadAudio(client, authorization, urls, phase);
          checkpoint[key] = { phase: "succeeded", operationName, ...audio };
          await save(checkpoint);
          console.log(JSON.stringify({ recovered: true, ...audio }));
        }
        break;
      }
    }
    checkpoint[key] = { ...checkpoint[key]!, operationLookups };
    await save(checkpoint);
    await connection.awaitTokenPersistence();
    return;
  }
  checkpoint[key] = { phase: "in_flight" };
  await save(checkpoint);
  try {
    const started = await rpc(client, authorization, service, "/audiotool.document.v1.DocumentService/RenderAudio", { projectName: checkpoint.projectName, commitIndex: "0" });
    if (started.status !== 200) {
      checkpoint[key] = { phase: "failed", httpStatus: started.status, reason: reasonFrom(started.json) };
      await save(checkpoint);
      console.log(JSON.stringify({ render: phase, ...checkpoint[key] }));
      return;
    }
    const operationName = typeof started.json.name === "string" ? started.json.name : null;
    if (!operationName) throw new Error("RenderAudio returned HTTP 200 without an operation name");
    checkpoint[key] = { phase: "operation", operationName };
    await save(checkpoint);
    let operation = started.json;
    for (let attempt = 0; attempt < 30 && operation.done !== true; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const polled = await rpc(client, authorization, service, "/audiotool.longrunning.v1.OperationService/GetOperation", { name: operationName });
      if (polled.status !== 200) throw new Error(`Operation polling returned HTTP ${polled.status}`);
      operation = (polled.json.operation ?? polled.json) as Record<string, unknown>;
    }
    if (operation.done !== true) throw new Error("Render operation did not finish within 30 seconds");
    if (operation.error) throw new Error(`Render operation failed: ${reasonFrom(operation.error as Record<string, unknown>)}`);
    const result = (operation.response ?? {}) as Record<string, unknown>;
    const urls = (result.downloadUrls ?? result.download_urls ?? {}) as Record<string, unknown>;
    const audio = await downloadAudio(client, authorization, urls, phase);
    checkpoint[key] = { phase: "succeeded", operationName, ...audio };
    await save(checkpoint);
    console.log(JSON.stringify({ render: phase, ...checkpoint[key] }));
  } catch (error) {
    checkpoint[key] = { ...checkpoint[key], phase: checkpoint[key]?.operationName ? "operation" : "uncertain", reason: error instanceof Error ? error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 180) : "unexpected error" };
    await save(checkpoint);
    throw error;
  } finally {
    await connection.awaitTokenPersistence();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Render probe failed"); process.exitCode = 1; }).finally(() => closePool());
