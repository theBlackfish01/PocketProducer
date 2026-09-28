import type { Job, NativeVersion } from "./api"

export function friendlyIssue(message: string | null | undefined, fallback: string) {
  if (!message) return fallback
  if (/stale|head changed|version conflict|expected.*revision/i.test(message)) return "This piece changed while you were working. Reopen it before trying again."
  if (/uncertain|reconcil|unknown.*outcome/i.test(message)) return "We need to check what happened before another attempt can start."
  if (/MODEL_CALL_LIMIT|model-call allowance|step limit/i.test(message)) return "The producer reached this request’s step limit."
  if (/REPEATED_NO_PROGRESS/i.test(message)) return "The producer repeated steps without making progress. Your draft is saved."
  if (/input or output|INPUT_LIMIT|INCOMPLETE_RESPONSE|tokens/i.test(message)) return "This direction needs more processing room before it can continue."
  if (/MODEL_BUDGET_EXCEEDED:USER/i.test(message)) return "You’ve reached your usage limit. Your draft is saved."
  if (/MODEL_BUDGET_EXCEEDED:(?:MODEL|SITE)/i.test(message)) return "The shared demo allowance is unavailable for the next step. Your draft is saved."
  if (/MODEL_BUDGET_EXCEEDED:PROVIDER/i.test(message)) return "This model’s shared allowance has been used. Your draft is saved."
  if (/PROVIDER_USAGE_UNKNOWN/i.test(message)) return "The model’s usage is still being checked. Your draft is saved."
  if (/budget|spend|allowance|reservation|charges/i.test(message)) return "The authorized spending allowance cannot cover another step. Your draft is saved."
  if (/connection|network|fetch|timeout|unavailable/i.test(message)) return "The connection was interrupted. Your saved work is still here."
  return fallback
}

export function jobProgress(job: Job) {
  if (job.state === "queued") return "Waiting to begin…"
  if (job.state === "cancel_requested") return "Stopping safely…"
  const labels: Record<string, string> = {
    analyzing: "Looking at your sound…",
    planning: "Planning the arrangement…",
    composing: "Building the parts…",
    discovering: "Preparing the musical approach…",
    constructing: "Shaping your arrangement…",
    validating: "Checking your arrangement…",
    synchronizing: "Preparing your Audiotool copy…",
    checking: "Checking the result…"
  }
  return job.stage ? labels[job.stage] ?? "Working on your piece…" : "Working on your piece…"
}

export function readableDevice(type: string) {
  const names: Record<string, string> = {
    beatbox8: "Drum machine",
    heisenberg: "Synth",
    pulverisateur: "Synth",
    gakki: "Pitched instrument",
    audio: "Your sound",
    sample: "Your sound"
  }
  return names[type] ?? "Instrument"
}

export function readableEffect(type: string) {
  const names: Record<string, string> = {
    stompboxDelay: "Delay",
    stompboxReverb: "Reverb",
    stompboxCompressor: "Compressor",
    stompboxParametricEqualizer: "EQ",
    autoFilter: "Filter",
    stompboxTube: "Tube saturation",
    stompboxChorus: "Chorus",
    stompboxPitchDelay: "Pitch delay"
  }
  return names[type] ?? "Effect"
}

export function arrangementSummary(version: NativeVersion) {
  const { document, structuralDiff: diff } = version
  if (version.ordinal === 1) return `Created ${document.bars} bars across ${document.sections.length} sections and ${document.parts.length} parts.`
  const names = diff.changedParts.map((id) => document.parts.find((part) => part.id === id)?.name ?? "a part")
  const changes = [
    names.length ? `Changed ${names.slice(0, 2).join(" and ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}` : null,
    diff.addedParts.length ? `added ${diff.addedParts.length} ${diff.addedParts.length === 1 ? "part" : "parts"}` : null,
    diff.changedSections.length ? `reshaped ${diff.changedSections.length} ${diff.changedSections.length === 1 ? "section" : "sections"}` : null,
    diff.tempoChange ? "changed the tempo" : null,
    diff.protectionChange.added.length || diff.protectionChange.removed.length ? "updated which parts stay unchanged" : null
  ].filter(Boolean)
  return changes.length ? `${changes.join("; ")}.` : "Saved a new arrangement version."
}
