import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AudiotoolClient, SyncedDocument } from "@audiotool/nexus";
import { createOfflineDocument } from "@audiotool/nexus/node";
import { Ticks } from "@audiotool/nexus/utils";
import { getConfig } from "../config.js";
import { closePool } from "../db/pool.js";
import { devOwnerId } from "../db/repository.js";
import { createAudiotoolServerClient } from "./session.js";

// One isolated scratch project. The checkpoint fences retries after any
// ambiguous remote create or document mutation; it contains no credentials.
const evidenceDir = resolve(".local/evidence/nexus-native-2026-09-23");
const checkpointPath = resolve(evidenceDir, "checkpoint.json");
const title = "Pocket Producer native render feasibility 2026-09-23";
const ticks = 4 * 4 * Ticks.Beat;
type Phase = "create_in_flight" | "created" | "insert_in_flight" | "inserted" | "revision_in_flight" | "revised";
interface Checkpoint { phase: Phase; projectName?: string; studioUrl?: string; initialNotePitches?: number[]; revisedNotePitches?: number[] }

async function save(checkpoint: Checkpoint) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
}

async function load(): Promise<Checkpoint | null> {
  try { return JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
}

function notePitches(doc: Pick<SyncedDocument, "queryEntities">): number[] {
  return doc.queryEntities.ofTypes("note").get().sort((a, b) => a.fields.positionTicks.value - b.fields.positionTicks.value).map((note) => note.fields.pitch.value);
}

async function insertNative(doc: Pick<SyncedDocument, "modify">) {
  await doc.modify((t) => {
    const groove = t.create("groove", { functionIndex: 1, durationTicks: Ticks.Beat * 2, impact: 0, displayName: "Straight" });
    const config = t.entities.ofTypes("config").getOne() ?? t.create("config", { defaultGroove: groove.location });
    t.update(config.fields.tempoBpm, 120);
    t.update(config.fields.signatureNumerator, 4);
    t.update(config.fields.signatureDenominator, 4);
    t.update(config.fields.durationTicks, ticks);
    if (!t.entities.ofTypes("mixerMaster").getOne()) t.create("mixerMaster", {});
    const channel = t.create("mixerChannel", {});
    const synth = t.create("heisenberg", { displayName: "Native feasibility synth", positionX: 100, positionY: 100, operatorA: { gain: 0.5 }, gain: 0.65, playModeIndex: 4 });
    t.create("desktopAudioCable", { fromSocket: synth.fields.audioOutput.location, toSocket: channel.fields.audioInput.location });
    const track = t.create("noteTrack", { player: synth.location, orderAmongTracks: 0 });
    const collection = t.create("noteCollection", {});
    t.create("noteRegion", { track: track.location, collection: collection.location, region: { displayName: "Native notes", positionTicks: 0, durationTicks: ticks, loopDurationTicks: ticks } });
    for (const [index, pitch] of [60, 64, 67, 72].entries()) {
      t.create("note", { collection: collection.location, positionTicks: index * Ticks.Beat, durationTicks: Ticks.Beat, pitch, velocity: 0.7 });
    }
  });
}

function inspect(doc: Pick<SyncedDocument, "queryEntities">) {
  const result = {
    config: doc.queryEntities.ofTypes("config").get().length,
    master: doc.queryEntities.ofTypes("mixerMaster").get().length,
    channels: doc.queryEntities.ofTypes("mixerChannel").get().length,
    synths: doc.queryEntities.ofTypes("heisenberg").get().length,
    audioCables: doc.queryEntities.ofTypes("desktopAudioCable").get().length,
    noteTracks: doc.queryEntities.ofTypes("noteTrack").get().length,
    noteRegions: doc.queryEntities.ofTypes("noteRegion").get().length,
    pitches: notePitches(doc)
  };
  if (result.config !== 1 || result.master !== 1 || result.channels !== 1 || result.synths !== 1 || result.audioCables !== 1 || result.noteTracks !== 1 || result.noteRegions !== 1 || result.pitches.join(",") !== "60,64,67,72") {
    throw new Error(`Native document readback mismatch: ${JSON.stringify(result)}`);
  }
  return result;
}

async function main() {
  const mode = process.argv[2] ?? "offline";
  if (mode === "offline") {
    const doc = await createOfflineDocument({ validated: true });
    await insertNative(doc);
    console.log(JSON.stringify({ mode, initial: inspect(doc), sdkRenderMethod: false }));
    await doc.modify((t) => {
      const note = t.entities.ofTypes("note").get().find((item) => item.fields.pitch.value === 64);
      if (!note) throw new Error("Expected editable E4 note");
      t.update(note.fields.pitch, 65);
    });
    console.log(JSON.stringify({ mode, revisedPitches: notePitches(doc) }));
    return;
  }
  if (mode !== "live" && mode !== "revise") throw new Error("Usage: pnpm spike:nexus-native [offline|live|revise]");
  const config = getConfig();
  if (!config.AUDIOTOOL_CLIENT_ID) throw new Error("Audiotool client ID is not configured");
  const connection = await createAudiotoolServerClient(await devOwnerId(), config.AUDIOTOOL_CLIENT_ID);
  if (!connection) throw new Error("Audiotool browser consent has not been saved");
  const client = connection.client as AudiotoolClient;
  const listed = await client.projects.listProjects({});
  if (listed instanceof Error) throw listed;
  console.log(JSON.stringify({ mode, readOnlyProjectList: "ok", supportedRenderOnClient: "renderAudio" in client }));
  let checkpoint = await load();
  if (!checkpoint && mode === "revise") throw new Error("Native scratch project has not been created");
  if (!checkpoint) {
    checkpoint = { phase: "create_in_flight" };
    await save(checkpoint);
    const created = await client.projects.createProject({ project: { displayName: title } });
    if (created instanceof Error || !created.project?.name) throw created instanceof Error ? created : new Error("Project creation returned no name; do not retry automatically");
    checkpoint = { phase: "created", projectName: created.project.name };
    await save(checkpoint);
  }
  if (!checkpoint.projectName || checkpoint.phase === "create_in_flight" || checkpoint.phase === "insert_in_flight" || checkpoint.phase === "revision_in_flight") {
    throw new Error(`Checkpoint is ${checkpoint.phase}; inspect remote state before any retry`);
  }
  const doc = await client.open(checkpoint.projectName);
  await doc.start();
  try {
    if (checkpoint.phase === "inserted") inspect(doc);
    if (checkpoint.phase === "revised" && notePitches(doc).join(",") !== "60,65,67,72") {
      throw new Error("Remote readback did not retain the revised native notes");
    }
    if (checkpoint.phase === "created") {
      checkpoint = { ...checkpoint, phase: "insert_in_flight" };
      await save(checkpoint);
      await insertNative(doc);
      checkpoint = { ...checkpoint, phase: "inserted", studioUrl: doc.dawUrl, initialNotePitches: inspect(doc).pitches };
      await save(checkpoint);
    }
    if (checkpoint.phase === "inserted" && mode === "revise") {
      checkpoint = { ...checkpoint, phase: "revision_in_flight" };
      await save(checkpoint);
      await doc.modify((t) => {
        const note = t.entities.ofTypes("note").get().find((item) => item.fields.pitch.value === 64);
        if (!note) throw new Error("Expected editable E4 note");
        t.update(note.fields.pitch, 65);
      });
      checkpoint = { ...checkpoint, phase: "revised", revisedNotePitches: notePitches(doc) };
      await save(checkpoint);
    }
    console.log(JSON.stringify({ mode, projectName: checkpoint.projectName, studioUrl: checkpoint.studioUrl, phase: checkpoint.phase, remotePitches: notePitches(doc), initialPitches: checkpoint.initialNotePitches, revisedPitches: checkpoint.revisedNotePitches, supportedRenderOnDocument: "renderAudio" in doc }));
  } finally {
    await doc.stop();
    await connection.awaitTokenPersistence();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Native spike failed"); process.exitCode = 1; }).finally(() => closePool());
