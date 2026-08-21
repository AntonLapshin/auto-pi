// Formatting + event-classification helpers for the dashboard.

export function fmtNumber(n: number | undefined | null): string {
  const v = Number(n) || 0;
  return v.toLocaleString();
}

export function fmtTokens(n: number | undefined | null): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

export function fmtDuration(seconds: number | undefined | null): string {
  const s = Number(seconds) || 0;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Map an event type to a Tailwind badge color + short label. */
export function eventStyle(type: string): { color: string; label: string } {
  const t = type;
  if (t.startsWith("persona.spawned")) return { color: "bg-blue-500/20 text-blue-300 border-blue-500/40", label: "spawned" };
  if (t.startsWith("persona.finished")) return { color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "finished" };
  if (t.startsWith("persona.failed")) return { color: "bg-rose-500/20 text-rose-300 border-rose-500/40", label: "failed" };
  if (t.startsWith("issue.created")) return { color: "bg-violet-500/20 text-violet-300 border-violet-500/40", label: "issue created" };
  if (t.startsWith("issue.")) return { color: "bg-violet-500/20 text-violet-300 border-violet-500/40", label: t.slice(6) };
  if (t.startsWith("pr.merged")) return { color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "PR merged" };
  if (t.startsWith("pr.approved")) return { color: "bg-green-500/20 text-green-300 border-green-500/40", label: "approved" };
  if (t.startsWith("pr.changes_requested")) return { color: "bg-amber-500/20 text-amber-300 border-amber-500/40", label: "changes req." };
  if (t.startsWith("pr.created")) return { color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40", label: "PR opened" };
  if (t.startsWith("pr.")) return { color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40", label: t.slice(3) };
  if (t.startsWith("labels.")) return { color: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40", label: "labels" };
  if (t.startsWith("git.")) return { color: "bg-slate-500/20 text-slate-300 border-slate-500/40", label: t.slice(4) };
  if (t.startsWith("gh.")) return { color: "bg-slate-500/20 text-slate-300 border-slate-500/40", label: "gh" };
  if (t.startsWith("llm.retry")) return { color: "bg-orange-500/20 text-orange-300 border-orange-500/40", label: "retry" };
  if (t.startsWith("loop.stop")) return { color: "bg-rose-500/20 text-rose-300 border-rose-500/40", label: "stopped" };
  if (t.startsWith("loop.wait")) return { color: "bg-slate-500/20 text-slate-300 border-slate-500/40", label: "waiting" };
  if (t.startsWith("loop.dispatch")) return { color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40", label: "dispatch" };
  return { color: "bg-slate-500/20 text-slate-300 border-slate-500/40", label: t };
}
