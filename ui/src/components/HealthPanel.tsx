import type { StatusResponse } from "../lib/types";
import { fmtNumber, fmtTokens } from "../lib/format";

function Bar({ value, className }: { value: number; className: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className={`h-full rounded-full ${className}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function HealthPanel({ status }: { status: StatusResponse }) {
  const h = status.health;
  const personas = Object.entries(status.stats.byPersona);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
        Health · LLM provider
      </h2>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="text-xs text-slate-500">Success rate</div>
          <div className="text-2xl font-semibold text-emerald-400">{h.successRate}%</div>
          <div className="text-xs text-slate-500">{h.ok} / {h.total} invocations</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Outcome rate</div>
          <div className="text-2xl font-semibold text-emerald-400">{h.outcomeSuccessRate}%</div>
          <div className="text-xs text-slate-500">per persona run</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Retries</div>
          <div className="text-2xl font-semibold text-amber-400">{fmtNumber(h.totalRetries)}</div>
          <div className="text-xs text-slate-500">transient failures</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Provider</div>
          <div className="truncate text-2xl font-semibold text-slate-200">
            {status.config?.provider || "unknown"}
          </div>
          <div className="truncate text-xs text-slate-500">{status.config?.model || ""}</div>
        </div>
      </div>

      {Object.keys(h.byProvider).length > 0 ? (
        <div className="mt-5 space-y-2">
          {Object.entries(h.byProvider).map(([provider, p]) => {
            const rate = p.total ? Math.round((p.ok / p.total) * 1000) / 10 : 0;
            return (
              <div key={provider} className="flex items-center gap-3">
                <span className="w-28 truncate text-xs text-slate-400">{provider}</span>
                <div className="flex-1">
                  <Bar value={rate} className={rate >= 90 ? "bg-emerald-500" : rate >= 70 ? "bg-amber-500" : "bg-rose-500"} />
                </div>
                <span className="w-24 text-right text-xs text-slate-400">{rate}% · {p.ok}/{p.total}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {h.recentFailures.length > 0 ? (
        <div className="mt-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            Recent failures
          </div>
          <ul className="space-y-1.5">
            {h.recentFailures.slice(0, 6).map((f, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                <span className="text-slate-300">{f.persona || "?"}:</span>
                <span className="truncate text-slate-400">{f.reason || "no reason"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-slate-400">
        Personas
      </h2>
      {personas.length === 0 ? (
        <p className="text-sm text-slate-500">No persona runs yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {personas.map(([name, p]) => {
            const okRate = p.runs ? Math.round((p.ok / p.runs) * 1000) / 10 : 0;
            return (
              <div key={name} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">{name}</span>
                  <span className={`text-xs font-semibold ${okRate >= 90 ? "text-emerald-400" : okRate >= 70 ? "text-amber-400" : "text-rose-400"}`}>
                    {okRate}%
                  </span>
                </div>
                <div className="mt-2">
                  <Bar value={okRate} className={okRate >= 90 ? "bg-emerald-500" : okRate >= 70 ? "bg-amber-500" : "bg-rose-500"} />
                </div>
                <div className="mt-2 flex justify-between text-xs text-slate-500">
                  <span>{p.runs} runs</span>
                  <span>{fmtTokens(p.tokensTotal)} tokens</span>
                  <span>{Math.round(p.durationSeconds)}s</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
