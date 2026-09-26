export interface Project { id: string; title: string; currentRevisionId: string | null; version: number; createdAt: string; updatedAt: string }
export interface Asset { id: string; name: string; mimeType: string; durationSeconds: number; sampleRate: number; channels: number; readiness: string; provenance: string; audioUrl: string; createdAt: string }
export interface Version { id: string; parentRevisionId: string | null; ordinal: number; title: string; durationSeconds: number; waveformPeaks: number[]; audioUrl: string; changeSummary: string; protectedTrackHashes: Record<string, string>; producer: Record<string, unknown>; createdAt: string }
export interface Revision {
  id: string;
  title: string;
  ordinal: number;
  durationSeconds: number;
  waveformPeaks: number[];
  audioUrl: string;
  composition: { tempoBpm: number; sections: Array<{ id: string; name: string; startTick: number; endTick: number }>; tracks: Array<{ id: string; role: string }> };
  changeSummary: string;
  producer: Record<string, unknown>;
}
export interface Job { id: string; project_id: string; kind: string; state: string; stage: string | null; error_code: string | null; error_message: string | null; result_revision_id: string | null; events?: Array<{ sequence: number; event_type: string; payload: Record<string, unknown> }> }
export interface NativeNote { id: string; startTick: number; durationTicks: number; pitch: number; velocity: number }
export interface NativeAutomation { id: string; target: string; points: Array<{ tick: number; value: number; interpolation?: "step" | "linear" | "sloped"; slope?: number }> }
export interface NativePlacement { id: string; motifId: string; startTick: number; repeats: number; transpose: number }
export interface NativeClip { id: string; startTick: number; durationTicks: number; sourceStartSeconds: number; sourceDurationSeconds: number; playbackMode?: "once" | "loop"; gain: number; playbackRate?: number; stretchMode?: "resample" | "preservePitch"; pitchShiftSemitones?: number }
export interface NativePart { id: string; name: string; role: string; device: { type: string; parameters: Record<string, number>; preset?: { name: string; displayName: string; ownerName: string; contentHash?: string } }; gain: number; pan: number; groupId?: string; sends?: Array<{ busId: string; gain: number }>; notes: NativeNote[]; placements: NativePlacement[]; sourceRegions: Array<NativeClip & { assetId: string; assetHash: string; rights: string; sampleId?: string }>; libraryRegions?: Array<NativeClip & { sampleName: string; displayName: string; ownerName: string; durationSeconds: number; bpm: number; provenance: "audiotool-library" }>; effects: Array<{ id: string; type: string; parameters: Record<string, number> }>; parallel?: { wetMix: number; effects: Array<{ id: string; type: string; parameters: Record<string, number> }> }; automation: NativeAutomation[] }
export interface Analysis { id: string; revisionId: string | null; assetHash: string; status: string; provider: string; model: string; purpose: "source-analysis" | "preview-critique"; observations: string[]; uncertainty: string; modelCostUsd: number }
export interface ProjectSnapshot { project: Project; assets: Asset[]; revisions: Version[]; analyses: Analysis[]; latestJob: Job | null; currentRevision: Revision | null }
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
export interface NativeVersion { id: string; parentRevisionId: string | null; ordinal: number; document: NativeDocument; documentHash: string; changeSummary: string; structuralDiff: NativeDiff; producer: Record<string, unknown>; createdAt: string }
export interface NativeSnapshot { currentRevisionId: string | null; headVersion: number; current: NativeVersion | null; versions: NativeVersion[]; comparisons: Record<string, NativeDiff>; context: Record<string, unknown> | null; synchronization: { state: string; projectId: string | null; observedHash: string | null; mappingVersion: string | null; verifiedAt: string | null; url: string | null; revisionId: string | null; error: string | null }; legacyAudio: string }
export interface NativeDraftView { jobId: string; state: string; selected: false; baseRevisionId: string | null; headMatches: boolean; stepCount: number; document: NativeDocument | null; documentHash: string | null; plan?: { plan: { intent: string; sections: Array<{ name: string; purpose: string }>; soundGoals: string[]; hardConstraints: string[]; developmentTasks: string[] }; stage: "planned" | "building" | "refining" | "reviewed"; inspectedDocumentHash: string | null } | null; runLimits?: { profile: "standard" | "extended"; maxCalls: number; maxInputTokens: number; maxOutputTokens: number; deadlineSeconds: number; maxJobCostUsd: number } | null; budget?: { spentUsd: number; reservedUsd: number; unknownUsd: number; siteRemainingUsd: number; minimumNextCallUsd: number; modelCalls: number }; extensionCeiling?: { maxCalls: number; maxInputTokens: number; maxOutputTokens: number; deadlineSeconds: number; maxJobCostUsd: number }; suggestedProfileExtension?: NativeDraftView["runLimits"]; canContinue: boolean; canExtend: boolean; continuationReason: string | null; stopReason?: string }
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const retryableRead = !init?.method || init.method === "GET"
  let lastFailure: unknown
  for (let attempt = 0; attempt < (retryableRead ? 5 : 1); attempt += 1) {
    try {
      const response = await fetch(`/api/v1${path}`, { cache: "no-store", ...init, headers });
      if (response.ok) return await response.json() as T;
      if (retryableRead && response.status >= 502 && attempt < 4) {
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
        continue
      }
      const problem = await response.json().catch(() => ({ message: response.statusText })) as { message?: string };
      throw new Error(problem.message ?? `Request failed (${response.status})`);
    } catch (error) {
      lastFailure = error
      if (init?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error
      if (!retryableRead || attempt >= 4) break
      await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  throw lastFailure instanceof Error ? lastFailure : new Error("The local service is unavailable")
}

export const api = {
  status: () => request<AppStatus>("/status"),
  listProjects: () => request<{ projects: Project[] }>("/projects"),
  createProject: (title: string) => request<{ project: Project }>("/projects", { method: "POST", body: JSON.stringify({ title }) }),
  snapshot: (id: string, signal?: AbortSignal) => request<ProjectSnapshot>(`/projects/${id}`, { signal }),
  nativeSnapshot: (id: string, signal?: AbortSignal) => request<NativeSnapshot>(`/projects/${id}/native`, { signal }),
  nativePreservationPreview: (projectId: string, direction: string, expectedNativeHeadId: string, targetSectionId: string | null, signal?: AbortSignal) => request<{ revisionId: string; sectionId: string | null; namedParts: Array<{ id: string; name: string; evidence: string }>; theme: { familyId: string; motifIds: string[]; label: string; evidence: string } | null; unresolved: string[] }>(`/projects/${projectId}/native/preservation-preview`, { method: "POST", body: JSON.stringify({ direction, expectedNativeHeadId, targetSectionId }), signal }),
  nativeDraft: (projectId: string, jobId: string, signal?: AbortSignal) => request<NativeDraftView>(`/projects/${projectId}/native/requests/${jobId}/draft`, { signal }),
  nativeCapabilities: (query = "") => request<{ version: string; totalEntities: number; matches: Array<{ type: string; family: string; purpose: string; writableInPocketProducer: boolean }> }>(`/native/capabilities?query=${encodeURIComponent(query)}`),
  searchLibrarySamples: (query: string) => request<{ samples: Array<{ name: string; displayName: string; ownerName: string; durationSeconds: number; bpm: number; sampleKind: string; tags: string[] }>; nextPageToken: string; provenance: string }>(`/native/library/samples?query=${encodeURIComponent(query)}`),
  searchLibraryPresets: (deviceType: "heisenberg" | "pulverisateur" | "gakki" | "beatbox8", query: string) => request<{ presets: Array<{ name: string; displayName: string; ownerName: string; deviceType: string; tags: string[] }>; provenance: string }>(`/native/library/presets?deviceType=${encodeURIComponent(deviceType)}&query=${encodeURIComponent(query)}`),
  constructNative: (projectId: string, direction: string, sourceAssetIds: string[], idempotencyKey: string, profile: "standard" | "extended" = "standard") => request<{ jobId: string; duplicate: boolean }>(`/projects/${projectId}/native/constructions`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ direction, profile, sourceAssetIds, expectedNativeHeadId: null }) }),
  reviseNative: (projectId: string, input: { direction: string; profile?: "standard" | "extended"; baseNativeRevisionId: string; expectedNativeHeadId: string; targetPartId?: string; targetSectionId?: string; protectionChange?: { expectedPartIds: string[]; desiredPartIds: string[] }; sourceAssetIds: string[] }, idempotencyKey: string) => request<{ jobId: string; duplicate: boolean }>(`/projects/${projectId}/native/revisions`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) }),
  continueNative: (projectId: string, jobId: string) => request<{ jobId: string }>(`/projects/${projectId}/native/requests/${jobId}/continue`, { method: "POST", body: "{}" }),
  extendNative: (projectId: string, jobId: string, limits: Partial<Pick<NonNullable<NativeDraftView["runLimits"]>, "maxCalls" | "maxInputTokens" | "maxOutputTokens" | "deadlineSeconds" | "maxJobCostUsd">> = {}) => request<{ jobId: string; extended: boolean }>(`/projects/${projectId}/native/requests/${jobId}/extend`, { method: "POST", body: JSON.stringify(limits) }),
  selectNativeVersion: (projectId: string, revisionId: string, expectedNativeHeadId: string) => request(`/projects/${projectId}/native/select-version`, { method: "POST", body: JSON.stringify({ revisionId, expectedNativeHeadId }) }),
  syncNative: (projectId: string, revisionId: string, idempotencyKey: string) => request<{ jobId: string; duplicate: boolean }>(`/projects/${projectId}/native/synchronizations`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ baseNativeRevisionId: revisionId, expectedNativeHeadId: revisionId }) }),
  job: (id: string, signal?: AbortSignal) => request<Job>(`/jobs/${id}`, { signal }),
  commandReceipt: (projectId: string, operation: "generation" | "revision" | "export" | "native-generation" | "native-revision" | "native-sync", idempotencyKey: string, signal?: AbortSignal) => request<{ job: Job | null }>(`/projects/${projectId}/commands/${operation}/${encodeURIComponent(idempotencyKey)}`, { signal }),
  generate: (projectId: string, direction: string, idempotencyKey: string, sourceAssetId?: string) => request<{ jobId: string }>(`/projects/${projectId}/generations`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ direction, sourceAssetId }) }),
  revise: (projectId: string, revisionId: string, direction: string, idempotencyKey: string) => request<{ jobId: string }>(`/projects/${projectId}/revisions`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ direction, baseRevisionId: revisionId, expectedHeadRevisionId: revisionId, protectedTrackIds: ["melody"], sectionId: "groove" }) }),
  cancel: (jobId: string) => request(`/jobs/${jobId}/cancel`, { method: "POST", body: "{}" }),
  selectVersion: (projectId: string, revisionId: string, expectedHeadRevisionId: string | null) => request(`/projects/${projectId}/select-version`, { method: "POST", body: JSON.stringify({ revisionId, expectedHeadRevisionId }) }),
  reconcile: (jobId: string, signal?: AbortSignal) => request<{ job: Job; export: { state: string; remote_url: string | null; error_message: string | null } | null }>(`/jobs/${jobId}/reconcile`, { method: "POST", body: "{}", signal }),
  export: (revisionId: string, idempotencyKey: string) => request<{ jobId: string }>(`/revisions/${revisionId}/exports`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: "{}" }),
  exportStatus: (revisionId: string, signal?: AbortSignal) => request<{ export: { state: string; fidelity: Record<string, unknown>; remote_url: string | null; error_message: string | null } | null }>(`/exports/${revisionId}`, { signal }),
  upload: async (projectId: string, file: File, signal?: AbortSignal) => {
    const form = new FormData(); form.set("file", file);
    const response = await fetch(`/api/v1/projects/${projectId}/assets`, { method: "POST", body: form, signal });
    if (!response.ok) { const body = await response.json().catch(() => ({ message: response.statusText })) as { message?: string }; throw new Error(body.message ?? "Upload failed"); }
    return response.json() as Promise<{ asset: { id: string; name: string } }>;
  }
};
