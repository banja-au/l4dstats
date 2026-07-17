import type { ReviewState } from "./data";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ?? `Workbench API returned ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export interface ApiNote {
  id: string;
  body: string;
  createdAt: string;
}

export interface ApiJob {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  message: string | null;
  source: { kind: "local" | "remote"; sha256?: string; bytes?: number };
}

export interface ApiCase {
  id: string;
  playerKey: string;
  status: ReviewState;
  scoreJson: string;
  createdAt: string;
  updatedAt: string;
  score?: Record<string, unknown>;
  presentation?: CasePresentationV1;
  lineage?: Record<string, unknown>;
}

export interface CasePresentationV1 {
  schemaVersion: 1;
  id: string;
  alias: string;
  identityLabel: string;
  provenance: { controlledFixture: boolean; label: string };
  demos: Array<{
    id: string;
    sha256: string;
    mapName: string;
    sourceLabel: string;
    quality: { value: number | null; basis: string[] };
    corroboration: "same-stable-player" | "unassociated";
  }>;
  evidence: Array<{
    id: string;
    family: string;
    title: string;
    tick: number;
    tickRange: { start: number; end: number };
    quality: { value: number; basis: string[] };
    contribution: number | null;
    explanation: string;
    counterevidence: string[];
    limitations: string[];
    demoSha256: string;
    window: { startTick: number; endTick: number; contextSeconds: number };
  }>;
  association: {
    kind: "stable-privacy-token" | "demo-local-epoch";
    stableToken?: string;
    corroboratingDemoCount: number;
    explanation: string;
  };
  summary: { encounterCount: number; independentSignalFamilies: string[] };
}

export interface TelemetryWindow {
  caseId: string;
  startTick: number;
  endTick: number;
  chunks: Array<{
    schemaVersion?: number;
    startTick?: number;
    endTick?: number;
    bounded?: boolean;
    poses?: Array<{
      tick: number;
      subject: [number, number];
      target: [number, number];
    }>;
  }>;
}

export const workbenchApi = {
  async cases(): Promise<ApiCase[]> {
    const summaries = (
      await requestJson<{ items: ApiCase[] }>("/api/cases?limit=100&offset=0")
    ).items;
    return Promise.all(
      summaries.map((item) =>
        requestJson<ApiCase>(`/api/cases/${encodeURIComponent(item.id)}`),
      ),
    );
  },
  case(caseId: string) {
    return requestJson<ApiCase>(`/api/cases/${encodeURIComponent(caseId)}`);
  },
  telemetry(
    caseId: string,
    startTick: number,
    endTick: number,
    demoSha256?: string,
  ) {
    return requestJson<TelemetryWindow>(
      `/api/cases/${encodeURIComponent(caseId)}/telemetry?start=${startTick}&end=${endTick}${demoSha256 ? `&demo=${encodeURIComponent(demoSha256)}` : ""}`,
    );
  },
  createJob(
    source: { kind: "local"; path: string } | { kind: "remote"; url: string },
  ) {
    return requestJson<ApiJob>("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        source,
        idempotencyKey: `${source.kind}:${source.kind === "local" ? source.path : source.url}`,
      }),
    });
  },
  job(id: string) {
    return requestJson<ApiJob>(`/api/jobs/${encodeURIComponent(id)}`);
  },
  cancelJob(id: string) {
    return requestJson<ApiJob>(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
  },
  retryJob(id: string) {
    return requestJson<ApiJob>(`/api/jobs/${encodeURIComponent(id)}/retry`, {
      method: "POST",
    });
  },
  async reviewStatus(caseId: string): Promise<ReviewState> {
    return (
      await requestJson<{ status: ReviewState }>(
        `/api/cases/${encodeURIComponent(caseId)}`,
      )
    ).status;
  },
  setReviewStatus(caseId: string, status: ReviewState) {
    return requestJson(
      `/api/cases/${encodeURIComponent(caseId)}/review-status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status }),
      },
    );
  },
  addNote(caseId: string, body: string, tick: number | null) {
    return requestJson<ApiNote>(
      `/api/cases/${encodeURIComponent(caseId)}/notes`,
      { method: "POST", body: JSON.stringify({ body, tick }) },
    );
  },
  async notes(caseId: string): Promise<ApiNote[]> {
    return (
      await requestJson<{ items: ApiNote[] }>(
        `/api/cases/${encodeURIComponent(caseId)}/notes`,
      )
    ).items;
  },
  async downloadVerifiedReport(caseId: string): Promise<string> {
    const result = await requestJson<{
      sha256: string;
      canonicalJson: string;
    }>(`/api/cases/${encodeURIComponent(caseId)}/report`);
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(result.canonicalJson),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== result.sha256)
      throw new Error("Report failed SHA-256 verification");
    const url = URL.createObjectURL(
      new Blob([result.canonicalJson], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${caseId}-${result.sha256}.report.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    return result.sha256;
  },
};
