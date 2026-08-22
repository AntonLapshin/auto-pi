import type { ErrorRecord } from "../lib/types";
import { fmtTime, fmtDate } from "../lib/format";

export function ErrorsPanel({ errors, className = "" }: { errors: ErrorRecord[]; className?: string }) {
  return (
    <section className={`rounded-xl border border-rose-900/40 bg-rose-950/20 p-5 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-rose-300">
        Errors ({errors.length})
      </h2>
      {errors.length === 0 ? (
        <p className="text-sm text-slate-500">No errors recorded. 🎉</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {errors.map((e, i) => (
            <li key={i} className="rounded-lg bg-slate-900/70 px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-slate-500">
                  {fmtDate(e.at)} {fmtTime(e.at)}
                </span>
                {e.persona ? (
                  <span className="font-medium text-rose-300">{e.persona}</span>
                ) : null}
                {e.action ? <span className="text-slate-500">({e.action})</span> : null}
              </div>
              <p className="mt-1 break-words font-mono text-xs text-slate-300">{e.error}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
