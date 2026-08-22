import type { RunRecord } from "../lib/types";
import { fmtTokens, fmtTime, fmtDate, fmtDuration } from "../lib/format";

function statusColor(status: string): string {
  if (status === "ok" || status === "ran") return "text-emerald-400";
  if (status === "error") return "text-rose-400";
  if (status === "waiting") return "text-amber-400";
  if (status === "started" || status === "running") return "text-blue-400";
  return "text-slate-400";
}

export function RunsTable({ runs, className = "" }: { runs: RunRecord[]; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900/60 p-5 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
        Persona runs
      </h2>
      {runs.length === 0 ? (
        <p className="text-sm text-slate-500">No runs recorded.</p>
      ) : (
        <div className="max-h-[500px] overflow-y-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3">time</th>
                <th className="py-2 pr-3">persona</th>
                <th className="py-2 pr-3">status</th>
                <th className="py-2 pr-3">action</th>
                <th className="py-2 pr-3 text-right">tokens</th>
                <th className="py-2 pr-3 text-right">duration</th>
                <th className="py-2">reason</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={r.runId || i} className="border-b border-slate-800/60">
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-400">
                    {fmtDate(r.startedAt)} {fmtTime(r.startedAt)}
                  </td>
                  <td className="py-1.5 pr-3 font-medium text-indigo-300">{r.persona || "—"}</td>
                  <td className={`py-1.5 pr-3 font-medium ${statusColor(r.status)}`}>{r.status || r.action}</td>
                  <td className="py-1.5 pr-3 text-slate-300">{r.action}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{fmtTokens(r.tokensTotal)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{fmtDuration(r.durationSeconds)}</td>
                  <td className="max-w-[16rem] truncate py-1.5 text-xs text-slate-500" title={r.reason}>
                    {r.reason || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </section>
  );
}
