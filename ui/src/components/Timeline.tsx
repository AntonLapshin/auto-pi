import type { ProgressEvent } from "../lib/types";
import { eventStyle, fmtTime, fmtTokens } from "../lib/format";

interface TimelineProps {
  events: ProgressEvent[];
  loading: boolean;
  className?: string;
}

export function Timeline({ events, loading, className = "" }: TimelineProps) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900/60 p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Activity timeline
        </h2>
        {loading ? <span className="text-xs text-slate-500">loading…</span> : null}
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-slate-500">No activity yet. Start the loop to see progress.</p>
      ) : (
        <div className="max-h-[28rem] space-y-0 overflow-y-auto pr-1">
          {events.map((e) => {
            const style = eventStyle(e.type);
            return (
              <div key={e.id} className="flex items-start gap-3 border-l border-slate-800 py-1.5 pl-3">
                <div className="shrink-0 whitespace-nowrap pt-0.5 text-right font-mono text-[11px] text-slate-500">
                  {fmtTime(e.at)}
                </div>
                <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${style.color}`}>
                  {style.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    {e.persona ? (
                      <span className="shrink-0 text-xs font-medium text-indigo-300">{e.persona}</span>
                    ) : null}
                    <span className="break-words font-mono text-xs text-slate-300">
                      {eventDetail(e)}
                    </span>
                  </div>
                  {e.runId ? (
                    <div className="text-[10px] text-slate-600">run {e.runId}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function eventDetail(e: ProgressEvent): string {
  const d = e.data;
  switch (e.type) {
    case "persona.spawned":
      return `dispatch ${String(d.decision ?? "")}`;
    case "persona.finished":
      return `ok · ${fmtTokens(Number(d.tokensTotal))} tokens · ${String(d.durationSeconds ?? 0)}s`;
    case "persona.failed":
      const err = String(d.error ?? "");
      const exit = String(d.exitCode ?? "");
      return err ? `exit ${exit} · ${err}` : `exit ${exit}`;
    case "loop.dispatch":
      return `${String(d.decision ?? "")} — ${String(d.reason ?? "")}`;
    case "loop.stop":
    case "loop.wait":
      return String(d.reason ?? "");
    case "llm.retry":
      return `attempt ${String(d.attempt ?? "")} · ${String(d.reason ?? "")}`;
    case "git.commit":
    case "git.push":
    case "git.stage":
    case "git.checkout":
    case "git.branch":
    case "git.merge":
      return String(d.command ?? "");
    case "issue.created":
    case "issue.closed":
    case "issue.edited":
    case "pr.created":
    case "pr.merged":
    case "pr.approved":
    case "pr.reviewed":
    case "pr.commented":
    case "pr.changes_requested":
    case "labels.assigned":
    case "gh.command":
      return String(d.command ?? "");
    default:
      return String(d.command ?? d.reason ?? "");
  }
}
