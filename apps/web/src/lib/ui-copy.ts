import type { Job, NativeVersion } from "./api"

const issueCopy: Record<string, string> = {
  ACTIVE_REQUEST_LIMIT: "An arrangement or Audiotool copy is already running in one of your sessions. Let it finish before starting another request.",
  STUDIO_BUSY: "The shared studio is busy. Please try again shortly.",
  HEAD_CHANGED: "This piece changed while you were working. Reopen it before trying again.",
  OUTCOME_UNCERTAIN: "We need to check what happened before another attempt can start.",
  CALL_LIMIT: "The producer reached this request’s step limit.",
  NO_PROGRESS: "The producer repeated steps without making progress. Your draft is saved.",
  INPUT_LIMIT: "The producer’s conversation became too long. Your draft is saved.",
  REVIEW_EXHAUSTED: "The final musical review could not be completed. Your draft is saved.",
  INCOMPLETE_RESPONSE: "The producer could not finish its response. Your draft is saved.",
  ALLOWANCE_USER: "You’ve reached your usage limit. Your draft is saved.",
  ALLOWANCE_SHARED: "The shared demo allowance is unavailable for the next step. Your draft is saved.",
  ALLOWANCE_PROVIDER: "This model’s shared allowance has been used. Your draft is saved.",
  USAGE_UNKNOWN: "The model’s usage is still being checked. Your draft is saved.",
  SPEND_ALLOWANCE: "The authorized spending allowance cannot cover another step. Your draft is saved.",
  PROVIDER_UNAVAILABLE: "The connection was interrupted. Your saved work is still here.",
  NETWORK: "The connection was interrupted. Your saved work is still here.",
  INTERPRETATION_PENDING: "Your direction is still being checked. Try sending again in a moment.",
  INTERPRETATION_STALE: "Your direction or the selected version changed after it was checked. Send it again to check the current words."
}

/** User-facing copy for a server issue code; anything unmapped uses the caller's fallback. */
export function friendlyIssue(code: string | null | undefined, fallback: string, hasMusic = true) {
  const text = (code && issueCopy[code]) || fallback
  return hasMusic ? text : text.replace("Your draft is saved.", "Your approach is saved; no music has been created yet.")
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
