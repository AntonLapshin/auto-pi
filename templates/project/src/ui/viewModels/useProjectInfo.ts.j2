import { useMemo } from "react";
import {
  createProjectInfo,
  statusLabel,
  isDemoReady,
  type ProjectInfo,
  type ProjectStatus,
} from "../../core/projectInfo";

/**
 * Thin view model for the demo panel.
 *
 * Contains no business logic — it just adapts the project's core module into a
 * shape the (dumb) component can render. All decisions live in `src/core`.
 */
export function useProjectInfo(
  name: string,
  owner: string,
  repo: string,
  status: ProjectStatus,
  description?: string,
): ProjectInfo & { statusText: string; demoReady: boolean } {
  return useMemo(() => {
    const info = createProjectInfo({ name, owner, repo, status, description });
    return {
      ...info,
      statusText: statusLabel(info.status),
      demoReady: isDemoReady(info),
    };
  }, [name, owner, repo, status, description]);
}
