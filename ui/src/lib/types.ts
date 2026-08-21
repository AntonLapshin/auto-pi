// Shared types for the auto-pi monitor dashboard.

export interface ProjectInfo {
  name: string;
  repo: string;
  workspace: string;
  startedAt: string;
}

export interface LoopState {
  running: boolean;
  pid: number | null;
  stale: boolean;
  stopFilePresent: boolean;
}

export interface ActivePersona {
  persona: string;
  runId: string;
  startedAt: string;
  status: string;
}

export interface PersonaStats {
  byPersona: Record<
    string,
    { runs: number; ok: number; error: number; tokensTotal: number; durationSeconds: number }
  >;
  counts: { ok: number; error: number; waiting: number; stopped: number; started: number };
}

export interface HealthSummary {
  total: number;
  ok: number;
  successRate: number;
  outcomeSuccessRate: number;
  recentSuccessRate: number;
  totalRetries: number;
  byProvider: Record<
    string,
    { total: number; ok: number; failures: { at: string; persona: string; reason: string; retryable: boolean }[] }
  >;
  recentFailures: { at: string; persona: string; reason: string; retryable: boolean }[];
}

export interface StatusResponse {
  project: ProjectInfo;
  config: {
    model: string;
    provider: string;
    intervalSeconds?: number;
    limits: Record<string, unknown>;
  } | null;
  loop: LoopState;
  activePersona: ActivePersona | null;
  stats: PersonaStats;
  usage: {
    today: { tokensTotal: number; runs: number };
    totals: { tokensTotal: number; runs: number };
    byDay: { date: string; tokensTotal: number; runs: number }[];
  };
  health: HealthSummary;
  counts: { runs: number; errors: number; events: number };
  generatedAt: string;
}

export interface ProgressEvent {
  version: number;
  id: string;
  at: string;
  type: string;
  persona: string;
  runId: string;
  data: Record<string, unknown>;
}

export interface RunRecord {
  version?: number;
  runId: string;
  startedAt: string;
  finishedAt: string;
  persona: string;
  trigger: string;
  projectName: string;
  repo: string;
  issueNumber: number | null;
  prNumber: number | null;
  status: string;
  action: string;
  reason: string;
  error: string;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  durationSeconds: number;
  gitSha: string;
}

export interface ErrorRecord {
  version?: number;
  at: string;
  runId?: string;
  persona?: string;
  error: string;
  action?: string;
  context?: string;
}
