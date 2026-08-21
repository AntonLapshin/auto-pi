import type { StatusResponse } from "../lib/types";
import { StatCard } from "./StatCard";
import { fmtNumber, fmtTokens, fmtDuration } from "../lib/format";

export function SummaryPanel({ status }: { status: StatusResponse }) {
  const s = status;
  const active = s.activePersona;
  const today = s.usage.today;
  const maxDayTokens = Math.max(
    1,
    ...s.usage.byDay.map((d) => d.tokensTotal),
    today.tokensTotal,
  );

  return (
    <section className="grid gap-4">
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

      {/* Token usage over the last 14 days */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Token usage · last {s.usage.byDay.length || 1} days
          </h2>
          <span className="text-xs text-slate-500">total {fmtTokens(s.usage.totals.tokensTotal)}</span>
        </div>
        {s.usage.byDay.length === 0 ? (
          <p className="text-sm text-slate-500">No usage recorded yet.</p>
        ) : (
          <div className="flex h-28 items-end gap-1.5">
            {s.usage.byDay.map((d) => {
              const h = Math.max(4, (d.tokensTotal / maxDayTokens) * 100);
              return (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${fmtTokens(d.tokensTotal)}`}>
                  <div className="w-full rounded-t bg-gradient-to-t from-indigo-600 to-violet-500" style={{ height: `${h}%` }} />
                  <span className="text-[10px] text-slate-500">{d.date.slice(5)}</span>
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
