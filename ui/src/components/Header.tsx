import type { StatusResponse } from "../lib/types";

interface HeaderProps {
  status: StatusResponse | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}

function LoopBadge({ status }: { status: StatusResponse }) {
  const running = status.loop.running;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        running
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : status.loop.stopFilePresent
            ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
            : "border-slate-600 bg-slate-800 text-slate-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${running ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
      {running ? `loop running (pid ${status.loop.pid ?? "?"})` : status.loop.stopFilePresent ? "loop stopped" : "loop idle"}
    </span>
  );
}

export function Header({ status, error, loading, onRefresh }: HeaderProps) {
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 font-mono text-lg font-bold text-white">
            π
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">auto-pi monitor</h1>
            {status ? (
              <p className="text-xs text-slate-400">
                {status.project.name} · {status.project.repo || "no repo"}
              </p>
            ) : (
              <p className="text-xs text-slate-500">waiting for data…</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {error ? (
            <span className="text-xs text-rose-400" title={error}>
              backend unreachable
            </span>
          ) : null}
          {status ? <LoopBadge status={status} /> : null}
          <button
            onClick={onRefresh}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            {loading ? "…" : "refresh"}
          </button>
        </div>
      </div>
    </header>
  );
}
