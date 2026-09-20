export interface Project { id: string; title: string; currentRevisionId: string | null; version: number; createdAt: string; updatedAt: string }
export interface Asset { id: string; name: string; mime_type: string; duration_seconds: number; readiness: string; provenance: string }
export interface Version { id: string; parentRevisionId: string | null; ordinal: number; title: string; durationSeconds: number; changeSummary: string; protectedTrackHashes: Record<string, string>; createdAt: string }
export interface Revision {
  id: string;
  title: string;
  ordinal: number;
  duration_seconds: number;
  waveform_peaks: number[];
  composition: { tempoBpm: number; sections: Array<{ id: string; name: string; startTick: number; endTick: number }>; tracks: Array<{ id: string; role: string }> };
  change_summary: string;
  producer: Record<string, unknown>;
}
export interface Job { id: string; project_id: string; kind: string; state: string; stage: string | null; error_code: string | null; error_message: string | null; result_revision_id: string | null; events?: Array<{ sequence: number; event_type: string; payload: Record<string, unknown> }> }
export interface ProjectSnapshot { project: Project; assets: Asset[]; revisions: Version[]; latestJob: Job | null; currentRevision: Revision | null }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({ message: response.statusText })) as { message?: string };
    throw new Error(problem.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  status: () => request<{ providers: { openai: boolean; gemini: boolean; audiotool: boolean }; uploadFormats: string[] }>("/status"),
  listProjects: () => request<{ projects: Project[] }>("/projects"),
  createProject: (title: string) => request<{ project: Project }>("/projects", { method: "POST", body: JSON.stringify({ title }) }),
  snapshot: (id: string) => request<ProjectSnapshot>(`/projects/${id}`),
  job: (id: string) => request<Job>(`/jobs/${id}`),
  generate: (projectId: string, direction: string, sourceAssetId?: string) => request<{ jobId: string }>(`/projects/${projectId}/generations`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ direction, sourceAssetId }) }),
  revise: (projectId: string, revisionId: string, direction: string) => request<{ jobId: string }>(`/projects/${projectId}/revisions`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ direction, baseRevisionId: revisionId, expectedHeadRevisionId: revisionId, protectedTrackIds: ["melody"] }) }),
  cancel: (jobId: string) => request(`/jobs/${jobId}/cancel`, { method: "POST", body: "{}" }),
  selectVersion: (projectId: string, revisionId: string, expectedHeadRevisionId: string | null) => request(`/projects/${projectId}/select-version`, { method: "POST", body: JSON.stringify({ revisionId, expectedHeadRevisionId }) }),
  export: (revisionId: string) => request<{ jobId: string }>(`/revisions/${revisionId}/exports`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: "{}" }),
  upload: async (projectId: string, file: File) => {
    const form = new FormData(); form.set("file", file);
    const response = await fetch(`/api/v1/projects/${projectId}/assets`, { method: "POST", body: form });
    if (!response.ok) { const body = await response.json().catch(() => ({ message: response.statusText })) as { message?: string }; throw new Error(body.message ?? "Upload failed"); }
    return response.json() as Promise<{ asset: { id: string; name: string } }>;
  }
};
