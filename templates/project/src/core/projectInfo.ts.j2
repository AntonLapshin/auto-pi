/**
 * Core business logic for the project (plan.md §19.1).
 *
 * This module is the single source of truth for project identity and demo info.
 * It is pure TypeScript with no React or DOM dependencies, so it can be tested
 * exhaustively and reused by the UI view models without leaking logic into the
 * view layer.
 */

/** Lifecycle status of the project, rendered by the demo panel. */
export type ProjectStatus = "scaffolded" | "in-progress" | "shipped";

/** Immutable identity + demo info for the project. */
export interface ProjectInfo {
  /** Human-friendly display name. */
  name: string;
  /** One-line description of the project. */
  description: string;
  /** GitHub owner (user or org) that owns the repo. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Current lifecycle status. */
  status: ProjectStatus;
  /** Public demo URL (GitHub Pages). */
  demoUrl: string;
}

/** Inputs used to build a ProjectInfo. */
export interface ProjectInfoInput {
  name: string;
  description?: string;
  owner: string;
  repo: string;
  status?: ProjectStatus;
}

/** The default lifecycle status for a freshly scaffolded project. */
export const DEFAULT_STATUS: ProjectStatus = "scaffolded";

/** Build the GitHub Pages demo URL for an owner/repo pair. */
export function demoUrlFor(owner: string, repo: string): string {
  return `https://${owner}.github.io/${repo}/`;
}

/** Human-readable label for a given status. */
export function statusLabel(status: ProjectStatus): string {
  switch (status) {
    case "scaffolded":
      return "Scaffolded";
    case "in-progress":
      return "In progress";
    case "shipped":
      return "Shipped";
  }
}

/**
 * Create a ProjectInfo from user input, deriving the demo URL and filling in
 * defaults for optional fields.
 */
export function createProjectInfo(input: ProjectInfoInput): ProjectInfo {
  const status = input.status ?? DEFAULT_STATUS;
  return {
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    owner: input.owner.trim(),
    repo: input.repo.trim(),
    status,
    demoUrl: demoUrlFor(input.owner.trim(), input.repo.trim()),
  };
}

/** Whether a project is ready to be shown as a live demo. */
export function isDemoReady(info: Pick<ProjectInfo, "status">): boolean {
  return info.status === "shipped";
}
