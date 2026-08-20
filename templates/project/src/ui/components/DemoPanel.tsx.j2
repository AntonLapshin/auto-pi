import { useProjectInfo } from "../viewModels/useProjectInfo";
import type { ProjectStatus } from "../../core/projectInfo";

export interface DemoPanelProps {
  projectName: string;
  owner: string;
  repo: string;
  status?: ProjectStatus;
  description?: string;
}

/**
 * Initial demo panel (plan.md §26.3).
 *
 * Renders the project name, lifecycle status, and demo info. It is a dumb view:
 * it delegates all derivation to the `useProjectInfo` view model, which in turn
 * delegates to the pure `src/core` module. No business logic lives here.
 */
export function DemoPanel({
  projectName,
  owner,
  repo,
  status = "scaffolded",
  description,
}: DemoPanelProps) {
  const info = useProjectInfo(projectName, owner, repo, status, description);

  return (
    <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">{info.name}</h2>
      {info.description && (
        <p className="mt-1 text-sm text-slate-600">{info.description}</p>
      )}

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Status</dt>
          <dd>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              {info.statusText}
            </span>
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Repo</dt>
          <dd className="font-mono text-slate-700">
            {info.owner}/{info.repo}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Demo</dt>
          <dd>
            {info.demoReady ? (
              <a
                href={info.demoUrl}
                className="text-indigo-600 underline hover:text-indigo-800"
              >
                {info.demoUrl}
              </a>
            ) : (
              <span className="text-slate-500">Not deployed yet</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
