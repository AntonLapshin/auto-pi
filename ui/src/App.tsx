import { useCallback } from "react";
import { Header } from "./components/Header";
import { SummaryPanel } from "./components/SummaryPanel";
import { HealthPanel } from "./components/HealthPanel";
import { Timeline } from "./components/Timeline";
import { RunsTable } from "./components/RunsTable";
import { ErrorsPanel } from "./components/ErrorsPanel";
import { usePoll } from "./lib/usePoll";
import { fetchStatus, fetchEvents, fetchRuns, fetchErrors } from "./lib/api";

export default function App() {
  const status = usePoll(useCallback(() => fetchStatus(), []), 4000);
  const events = usePoll(useCallback(() => fetchEvents(300), []), 4000);
  const runs = usePoll(useCallback(() => fetchRuns(100), []), 6000);
  const errors = usePoll(useCallback(() => fetchErrors(50), []), 6000);

  const refreshAll = () => {
    status.refresh();
    events.refresh();
    runs.refresh();
    errors.refresh();
  };

  const backendDown = status.error && !status.data;

  return (
    <div className="min-h-screen">
      <Header
        status={status.data}
        error={backendDown ? status.error : null}
        loading={status.loading}
        onRefresh={refreshAll}
      />

      <main className="dashboard-grid mx-auto max-w-7xl px-4 py-6">
        {backendDown ? (
          <div className="area-full rounded-xl border border-rose-900/50 bg-rose-950/30 p-8 text-center">
            <h2 className="text-lg font-semibold text-rose-300">Backend not reachable</h2>
            <p className="mt-1 text-sm text-slate-400">
              Start the auto-pi UI backend with <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs">node ui/server/server.js</code>,
              then refresh.
            </p>
            <p className="mt-2 text-xs text-slate-500">{status.error}</p>
          </div>
        ) : !status.data ? (
          <div className="area-full rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
            Loading…
          </div>
        ) : (
          <>
            <SummaryPanel status={status.data} className="area-summary" />
            <HealthPanel status={status.data} className="area-health" />
            <Timeline events={events.data ?? []} loading={events.loading} className="area-timeline" />
            <ErrorsPanel errors={errors.data ?? []} className="area-errors" />
            <RunsTable runs={runs.data ?? []} className="area-runs" />
          </>
        )}

        <footer className="area-footer border-t border-slate-800 py-4 text-center text-xs text-slate-600">
          auto-pi monitor · reads {status.data?.project.workspace ?? "the active project"}'s local .pi/logs
        </footer>
      </main>
    </div>
  );
}
