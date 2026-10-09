/** Server-computed outline of stored notes/clips for lists; not audio or quality. */
export interface NativeFingerprint { version: 1; columns: number; lanes: Array<{ role: string; cells: number[] }> }
export interface Project { id: string; title: string; currentRevisionId: string | null; version: number; createdAt: string; updatedAt: string; workspaceStatus?: "working" | "attention" | "ready" | "new"; fingerprint?: NativeFingerprint | null }
export interface Asset { id: string; name: string; mimeType: string; durationSeconds: number; sampleRate: number; channels: number; readiness: string; provenance: string; audioUrl: string; createdAt: string }
export interface Job { id: string; project_id: string; kind: string; state: string; stage: string | null; error_code: string | null; error_message: string | null; issue_code?: string | null; result_native_revision_id: string | null; events?: Array<{ sequence: number; event_type: string; payload: Record<string, unknown> }> }
export interface Activity { cursor: number; jobId: string | null; createdAt: string; payload: { version: 1; kind: string; text: string; historical?: boolean; revisionId?: string; baseRevisionId?: string | null; ordinal?: number; selected?: boolean; step?: number; documentHash?: string; sectionId?: string; partId?: string; sectionIds?: string[]; partIds?: string[]; sourceIds?: string[]; profile?: string; scope?: string } }
export interface WorkspaceActivity { events: Activity[]; cursor: number; nextCursor: number; reset?: boolean; hasOlder: boolean; job: Job | null; headId: string | null; draft: { step: number; hash: string } | null; actions: { canSubmit: boolean; canStop: boolean; canAbandon?: boolean; issue: "uncertain" | "paused" | null }; allowance: { remainingUsd: number; standardUsd: number; extendedUsd: number } }
export interface NativeNote { id: string; startTick: number; durationTicks: number; pitch: number; velocity: number }
export interface NativeAutomation { id: string; target: string; points: Array<{ tick: number; value: number; interpolation?: "step" | "linear" | "sloped"; slope?: number }> }
export interface NativePlacement { id: string; motifId: string; startTick: number; repeats: number; transpose: number }
export interface NativeClip { id: string; startTick: number; durationTicks: number; sourceStartSeconds: number; sourceDurationSeconds: number; playbackMode?: "once" | "loop"; gain: number; playbackRate?: number; stretchMode?: "resample" | "preservePitch"; pitchShiftSemitones?: number }
export interface NativePart { id: string; name: string; role: string; device: { type: string; parameters: Record<string, number>; preset?: { name: string; displayName: string; ownerName: string; contentHash?: string } }; gain: number; pan: number; groupId?: string; sends?: Array<{ busId: string; gain: number }>; notes: NativeNote[]; placements: NativePlacement[]; sourceRegions: Array<NativeClip & { assetId: string; assetHash: string; rights: string; sampleId?: string }>; libraryRegions?: Array<NativeClip & { sampleName: string; displayName: string; ownerName: string; durationSeconds: number; bpm: number; provenance: "audiotool-library" }>; effects: Array<{ id: string; type: string; parameters: Record<string, number> }>; parallel?: { wetMix: number; effects: Array<{ id: string; type: string; parameters: Record<string, number> }> }; automation: NativeAutomation[] }
export interface SessionSnapshot { project: Project; assets: Asset[] }
export interface NativeDocument {
  schemaVersion: 2; ppq: 960; title: string; direction: string; currentObjective: string; assumptions: string[]; tempoBpm: number; meter: { numerator: number; denominator: number }; bars: number;
  sections: Array<{ id: string; name: string; startBar: number; endBar: number; intent: string }>;
  parts: NativePart[];
  groups?: Array<{ id: string; name: string; gain: number; pan: number; parentId?: string; compressor?: { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; makeupGainDb: number; isActive: boolean }; sidechainFromPartId?: string; effects?: Array<{ id: string; type: string; parameters?: Record<string, number> }>; parallel?: { wetMix: number; effects: Array<{ id: string; type: string; parameters?: Record<string, number> }> }; automation?: NativeAutomation[] }>;
  reverbBus?: { id: string; name: string; roomSize: number; preDelayMs: number; damp: number };
  delayBus?: { id: string; name: string; feedbackFactor: number; stepCount: number; stepLengthIndex: 1 | 2 | 3 };
  master?: { gain: number; pan: number; limiterEnabled: boolean };
  motifs: Array<{ id: string; partId: string; name: string; lengthTicks: number; notes: NativeNote[]; familyId?: string; derivedFromMotifId?: string }>;
  protectedPartIds: string[]; protectedMotifIds: string[]; sourceAssetIds: string[]; audio: { state: "deferred" | "unavailable" | "stale"; revisionId: null; assetHash: null };
}
export interface NativeDiff { addedParts: string[]; removedParts: string[]; changedParts: string[]; partChanges: Array<{ partId: string; fields: string[] }>; routingChange?: { groups: NativeDocument["groups"]; reverbBus: NativeDocument["reverbBus"] | null; delayBus: NativeDocument["delayBus"] | null; master: NativeDocument["master"] | null } | null; addedSections: string[]; removedSections: string[]; changedSections: string[]; tempoChange: { from: number; to: number } | null; meterChange: { from: { numerator: number; denominator: number }; to: { numerator: number; denominator: number } } | null; barsChange: { from: number; to: number } | null; titleChange: { from: string; to: string } | null; protectionChange: { added: string[]; removed: string[] }; sourceAssetChange: { added: string[]; removed: string[] }; noteCount: number; protectedPartIds: string[] }
export interface NativeVersion { id: string; parentRevisionId: string | null; ordinal: number; document: NativeDocument; documentHash: string; changeSummary: string; structuralDiff: NativeDiff; producer: Record<string, unknown>; createdAt: string; fingerprint?: NativeFingerprint }
export interface NativeSnapshot { currentRevisionId: string | null; headVersion: number; current: NativeVersion | null; versions: NativeVersion[]; comparisons: Record<string, NativeDiff>; context: Record<string, unknown> | null; synchronization: { state: string; projectId: string | null; observedHash: string | null; mappingVersion: string | null; verifiedAt: string | null; url: string | null; revisionId: string | null; error: string | null } }
/** The submit-time reading of a direction: hard checks in plain words, what the
 * words keep unchanged, softer guidance, and anything that could not be matched. */
export interface NativeInterpretation { interpretationId: string; provenance: "luna" | "fixture" | "scripted" | "none"; checks: string[]; keep: string[]; guidance: Array<{ quote: string; reason: string }>; rejected: Array<{ quote: string; reason: string }> }
export interface SoundFeedback { sampleName: string; contentHash: string; rating: "fits" | "not-for-this"; note: string; updatedAt: string }
export interface SoundRecipe { id: string; name: string; character: string; role: string; provenance: string; version: string; configurationHash: string; auditionStatus: "unheard"; guidance: { register: string; articulation: string; usefulMotion: string; failureMode: string }; device: { type: string; parameters: Record<string, number> }; effects: Array<{ type: string; parameters: Record<string, number> }>; heard: false }
export interface NativeDraftView { jobId: string; state: string; selected: false; baseRevisionId: string | null; headMatches: boolean; stepCount: number; document: NativeDocument | null; documentHash: string | null; plan?: { plan: { intent: string; sections: Array<{ name: string; purpose: string }>; soundGoals: string[]; hardConstraints: string[]; developmentTasks: string[]; creativeState?: { identity: string; densityIntent: string; palette: Array<{ role: string; resourceId: string; resourceKind: string }>; unfinishedTasks: string[]; definiteFailures: string[] } }; stage: "planned" | "building" | "refining" | "reviewed"; inspectedDocumentHash: string | null; review?: { documentHash: string; verdict: string; findings: Array<{ observation: string; suggestedChange: string }>; modelUsed: boolean } | null } | null; runLimits?: { profile: "standard" | "extended"; maxCalls: number; maxInputTokens: number; maxOutputTokens: number; deadlineSeconds: number; maxJobCostUsd: number } | null; budget?: { spentUsd: number; reservedUsd: number; unknownUsd: number; siteRemainingUsd: number; minimumNextCallUsd: number; modelCalls: number }; extensionCeiling?: { maxCalls: number; maxInputTokens: number; maxOutputTokens: number; deadlineSeconds: number; maxJobCostUsd: number }; suggestedProfileExtension?: NativeDraftView["runLimits"]; canContinue: boolean; canExtend: boolean; continuationCode?: string | null; continuationReason: string | null; stopCode?: string | null; stopReason?: string }
export interface AppStatus {
  providers: { openai: boolean; gemini: boolean; audiotool: boolean };
  uploadFormats: string[];
  nexus: {
    sdk: string;
    liveExportVerified: boolean;
    connection: "unconfigured" | "awaiting-authorization" | "authorized";
    oauth: { clientId: string; redirectUrl: string; scope: string } | null;
    session: { connected: boolean; userName: string | null; expiresAt: string | null };
  };
}

/** A failed request. `code` is the server's stable issue code, or NETWORK when
 * the service could not be reached; copy is chosen from it, never from the message. */
export class ApiError extends Error {
  readonly code: string | null
  readonly status: number | null
  constructor(message: string, code: string | null, status: number | null) { super(message); this.name = "ApiError"; this.code = code; this.status = status }
}

/** The issue code of a failed action, for user-facing copy. */
export const issueOf = (cause: unknown) => ({ code: cause instanceof ApiError ? cause.code : null })

const genericCodes = new Set(["INVALID_REQUEST", "INTERNAL_ERROR"])

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const retryableRead = !init?.method || init.method === "GET"
  let lastFailure: unknown
  for (let attempt = 0; attempt < (retryableRead ? 5 : 1); attempt += 1) {
    try {
      const response = await fetch(`/api/v1${path}`, { cache: "no-store", ...init, headers });
      if (response.ok) return await response.json() as T;
      if (response.status === 401) { window.dispatchEvent(new Event("pocket:auth-expired")); throw new DOMException("Sign in to continue.", "AbortError") }
      if (retryableRead && response.status >= 502 && attempt < 4) {
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
        continue
      }
      const problem = await response.json().catch(() => ({ message: response.statusText })) as { message?: string; code?: string };
      const code = problem.code && !genericCodes.has(problem.code) ? problem.code : response.status >= 502 ? "NETWORK" : null;
      throw new ApiError(problem.message ?? `Request failed (${response.status})`, code, response.status);
    } catch (error) {
      lastFailure = error
      if (init?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error
      if (!retryableRead || attempt >= 4) break
      await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  throw lastFailure instanceof ApiError ? lastFailure : new ApiError(lastFailure instanceof Error ? lastFailure.message : "The local service is unavailable", "NETWORK", null)
}

export const api = {
  audiotoolProfile: (signal?: AbortSignal) => request<{ profile: { userName: string; displayName: string; avatarUrl: string | null } | null }>("/integrations/audiotool/profile", { signal }),
  disconnectAudiotool: async () => { const response = await fetch("/api/v1/integrations/audiotool/session", { method: "DELETE" }); if (!response.ok) throw new Error("Unable to disconnect Audiotool") },
  assistPrompt: (id: string, input: { mode: "rewrite" | "inspire"; direction: string; expectedHeadId: string | null; sectionId: string | null; partId: string | null; protectedPartIds: string[]; sourceIds: string[]; recent: string[] }, key: string, signal?: AbortSignal) => request<{ prompt: string; provenance: "luna" | "fixture" }>(`/projects/${id}/prompt-assistance`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(input), signal }),
  activity: (id: string, query = "", signal?: AbortSignal) => request<WorkspaceActivity>(`/projects/${id}/activity${query}`, { signal }),
  status: () => request<AppStatus>("/status"),
  listProjects: () => request<{ projects: Project[] }>("/projects"),
  createProject: (title: string) => request<{ project: Project }>("/projects", { method: "POST", body: JSON.stringify({ title }) }),
  snapshot: (id: string, signal?: AbortSignal) => request<SessionSnapshot>(`/projects/${id}`, { signal }),
  nativeSnapshot: (id: string, signal?: AbortSignal) => request<NativeSnapshot>(`/projects/${id}/native`, { signal }),
  interpretNative: (projectId: string, input: { direction: string; expectedHeadId: string | null; targetSectionId: string | null; targetPartId: string | null }, idempotencyKey: string) => request<NativeInterpretation>(`/projects/${projectId}/native/interpretations`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) }),
  nativeDraft: (projectId: string, jobId: string, signal?: AbortSignal) => request<NativeDraftView>(`/projects/${projectId}/native/requests/${jobId}/draft`, { signal }),
  nativeCapabilities: (query = "") => request<{ version: string; totalEntities: number; matches: Array<{ type: string; family: string; purpose: string; writableInPocketProducer: boolean }> }>(`/native/capabilities?query=${encodeURIComponent(query)}`),
  soundRecipes: () => request<{ version: string; recipes: SoundRecipe[] }>("/native/sound-recipes"),
  searchLibrarySamples: (query: string, filters: { kind?: "one-shot" | "loop"; minBpm?: number; maxBpm?: number } = {}) => request<{ samples: Array<{ name: string; displayName: string; ownerName: string; durationSeconds: number; bpm: number; sampleKind: string; tags: string[] }>; nextPageToken: string; provenance: string }>(`/native/library/samples?${new URLSearchParams({ query, ...(filters.kind ? { kind: filters.kind } : {}), ...(filters.minBpm !== undefined ? { minBpm: String(filters.minBpm) } : {}), ...(filters.maxBpm !== undefined ? { maxBpm: String(filters.maxBpm) } : {}) })}`),
  inspectLibrarySample: (name: string) => request<{ sample: { name: string; displayName: string }; contentHash: string; measured: { durationSeconds: number; leadingSilenceSeconds: number; suggestedSlices: Array<{ startSeconds: number; endSeconds: number; reason: string }>; limitations: string }; provenance: string }>(`/native/library/sample-analysis?name=${encodeURIComponent(name)}`),
  sampleAudioUrl: (name: string, expectedHash: string) => `/api/v1/native/library/sample-audio?${new URLSearchParams({ name, expectedHash })}`,
  soundFeedback: (projectId: string) => request<{ feedback: SoundFeedback[] }>(`/projects/${projectId}/native/sound-feedback`),
  saveSoundFeedback: (projectId: string, input: Pick<SoundFeedback, "sampleName" | "contentHash" | "rating" | "note">) => request<{ feedback: SoundFeedback }>(`/projects/${projectId}/native/sound-feedback`, { method: "POST", body: JSON.stringify(input) }),
  searchLibraryPresets: (deviceType: "heisenberg" | "pulverisateur" | "gakki" | "beatbox8", query: string) => request<{ presets: Array<{ name: string; displayName: string; ownerName: string; deviceType: string; tags: string[] }>; provenance: string }>(`/native/library/presets?deviceType=${encodeURIComponent(deviceType)}&query=${encodeURIComponent(query)}`),
  producerModels: (signal?: AbortSignal) => request<{ models: ProducerModelOption[]; fallbackModel?: string | null; repository?: { url: string; public: boolean } }>("/producer-models", { signal }),
  constructNative: (projectId: string, direction: string, sourceAssetIds: string[], idempotencyKey: string, profile: "standard" | "extended" = "standard", model?: string, interpretationId?: string) => request<{ jobId: string; duplicate: boolean }>(`/projects/${projectId}/native/constructions`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ direction, profile, model, sourceAssetIds, expectedNativeHeadId: null, ...(interpretationId ? { interpretationId } : {}) }) }),
  reviseNative: (projectId: string, input: { direction: string; model?: string; profile?: "standard" | "extended"; baseNativeRevisionId: string; expectedNativeHeadId: string; targetPartId?: string; targetSectionId?: string; protectionChange?: { expectedPartIds: string[]; desiredPartIds: string[] }; sourceAssetIds: string[]; interpretationId?: string }, idempotencyKey: string) => request<{ jobId: string; duplicate: boolean }>(`/projects/${projectId}/native/revisions`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) }),
  abandonNative: (projectId: string, jobId: string) => request<{ jobId: string; abandoned: boolean }>(`/projects/${projectId}/native/requests/${jobId}/abandon`, { method: "POST", body: "{}" }),
  continueNative: (projectId: string, jobId: string) => request<{ jobId: string }>(`/projects/${projectId}/native/requests/${jobId}/continue`, { method: "POST", body: "{}" }),
  extendNative: (projectId: string, jobId: string, limits: Partial<Pick<NonNullable<NativeDraftView["runLimits"]>, "maxCalls" | "maxInputTokens" | "maxOutputTokens" | "deadlineSeconds" | "maxJobCostUsd">> = {}) => request<{ jobId: string; extended: boolean }>(`/projects/${projectId}/native/requests/${jobId}/extend`, { method: "POST", body: JSON.stringify(limits) }),
  selectNativeVersion: (projectId: string, revisionId: string, expectedNativeHeadId: string) => request(`/projects/${projectId}/native/select-version`, { method: "POST", body: JSON.stringify({ revisionId, expectedNativeHeadId }) }),
  syncNative: (projectId: string, revisionId: string, idempotencyKey: string) => request<{ jobId: string; duplicate: boolean }>(`/projects/${projectId}/native/synchronizations`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ baseNativeRevisionId: revisionId, expectedNativeHeadId: revisionId }) }),
  job: (id: string, signal?: AbortSignal) => request<Job>(`/jobs/${id}`, { signal }),
  commandReceipt: (projectId: string, operation: "native-generation" | "native-revision" | "native-sync", idempotencyKey: string, signal?: AbortSignal) => request<{ job: Job | null }>(`/projects/${projectId}/commands/${operation}/${encodeURIComponent(idempotencyKey)}`, { signal }),
  cancel: (jobId: string) => request(`/jobs/${jobId}/cancel`, { method: "POST", body: "{}" }),
  upload: async (projectId: string, file: File, signal?: AbortSignal) => {
    const form = new FormData(); form.set("file", file);
    const response = await fetch(`/api/v1/projects/${projectId}/assets`, { method: "POST", body: form, signal });
    if (!response.ok) { const body = await response.json().catch(() => ({ message: response.statusText })) as { message?: string }; throw new Error(body.message ?? "Upload failed"); }
    return response.json() as Promise<{ asset: { id: string; name: string } }>;
  }
};
export interface ProducerModelOption { id: string; label: string; provider: string; available: boolean; reason?: string | null }
