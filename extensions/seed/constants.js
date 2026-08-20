/**
 * Shared constants for the auto-pi `/seed` initiation flow (M2).
 *
 * Plain JS so it can be imported both by the interactive `/seed` command
 * (`extensions/seed/index.ts` via jiti) and by the fallback CLI
 * (`scripts/seed.js` under `node scripts/seed.js`).
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** Top-level per-machine harness workspace (same as extensions/doctor/core.js). */
export const AUTO_PI_DIR = join(homedir(), ".auto-pi");

/**
 * File recording the single active project on this machine (plan.md §2.2).
 * Located at the workspace root so it survives project re-installs.
 */
export const CURRENT_PROJECT_FILE = join(AUTO_PI_DIR, "current-project.json");

/** Parent dir under which each project's local workspace is created. */
export const WORKSPACES_DIR = join(AUTO_PI_DIR, "workspaces");

/** Re-read GitHub owner from `gh` rather than guessing. */
export const DEFAULT_VISIBILITY = "private";

/** Default branch created for new repos (matches config.default.json). */
export const DEFAULT_BRANCH = "main";

/** Version of the initiation state schema (plan.md §8.2). */
export const INITIATION_STATE_VERSION = 1;

/** Statuses recorded in current-project.json over a project's life. */
export const PROJECT_STATUS = {
	ACTIVE: "active",
};
