import type {
  StatusResponse,
  ProgressEvent,
  RunRecord,
  ErrorRecord,
} from "./types";

/** Tiny typed fetch helper for the backend API. */
async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchStatus(): Promise<StatusResponse> {
  return get<StatusResponse>("/api/status");
}

export async function fetchEvents(limit = 200): Promise<ProgressEvent[]> {
  const data = await get<{ events: ProgressEvent[] }>(`/api/events?limit=${limit}`);
  return data.events;
}

export async function fetchRuns(limit = 100): Promise<RunRecord[]> {
  const data = await get<{ runs: RunRecord[] }>(`/api/runs?limit=${limit}`);
  return data.runs;
}

export async function fetchErrors(limit = 50): Promise<ErrorRecord[]> {
  const data = await get<{ errors: ErrorRecord[] }>(`/api/errors?limit=${limit}`);
  return data.errors;
}
