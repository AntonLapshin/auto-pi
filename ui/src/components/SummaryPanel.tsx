import type { StatusResponse } from "../lib/types";
import { StatCard } from "./StatCard";
import { fmtNumber, fmtTokens, fmtDuration } from "../lib/format";

export function SummaryPanel({ status, className = "" }: { status: StatusResponse; className?: string }) {
  const s = status;
  const active = s.activePersona;
  const today = s.usage.today;
  const usageByHour = s.usage.byHour ?? [];
  const maxHourTokens = Math.max(1, ...usageByHour.map((d) => d.tokensTotal));

  return (
    <section className={`grid gap-4 ${className}`}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Active persona"
          value={active ? active.persona : "—"}
          sub={active ? `run ${active.runId}` : "none running"}
          accent={active ? "blue" : "slate"}
        />
        <StatCard
          label="Persona runs"
          value={fmtNumber(s.counts.runs)}
          sub={`${s.stats.counts.ok} ok · ${s.stats.counts.error} error`}
          accent="emerald"
        />
        <StatCard
          label="Tokens today"
          value={fmtTokens(today.tokensTotal)}
          sub={`${fmtNumber(today.runs)} runs today`}
          accent="violet"
        />
        <StatCard
          label="Events logged"
          value={fmtNumber(s.counts.events)}
          sub={`${fmtNumber(s.counts.errors)} errors`}
          accent={s.counts.errors > 0 ? "rose" : "slate"}
        />
      </div>

      {/* Token usage over the last 24 hours */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Token usage · last {usageByHour.length || 1} hours
          </h2>
          <span className="text-xs text-slate-500">total {fmtTokens(s.usage.totals.tokensTotal)}</span>
        </div>
        {usageByHour.length === 0 ? (
          <p className="text-sm text-slate-500">No usage recorded yet.</p>
        ) : (
          <div className="flex h-28 gap-1.5">
            {usageByHour.map((d) => {
              const h = Math.max(4, (d.tokensTotal / maxHourTokens) * 100);
              return (
                <div key={d.hour} className="flex h-full flex-1 flex-col items-center" title={`${d.hour}:00 — ${fmtTokens(d.tokensTotal)}`}>
                  <div className="flex w-full flex-1 items-end">
                    <div className="w-full rounded-t bg-gradient-to-t from-indigo-600 to-violet-500" style={{ height: `${h}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-[10px] text-slate-500">{d.hour.slice(11)}h</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Run outcome summary chips */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="ok" value={fmtNumber(s.stats.counts.ok)} accent="emerald" />
        <StatCard label="error" value={fmtNumber(s.stats.counts.error)} accent={s.stats.counts.error ? "rose" : "slate"} />
        <StatCard label="waiting" value={fmtNumber(s.stats.counts.waiting)} accent="amber" />
        <StatCard label="stopped" value={fmtNumber(s.stats.counts.stopped)} accent="slate" />
      </div>
    </section>
  );
}

export { fmtDuration };
