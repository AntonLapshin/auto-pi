/**
 * Shared constants for the auto-pi loop orchestrator (M6).
 *
 * Plain JS on purpose — imported both by `scripts/loop.js` / `scripts/stop.js`
 * (fallback CLIs under `node scripts/*.js`) and by `extensions/loop/index.ts`
 * (the interactive `/loop` / `/stop` commands, loaded by pi through jiti).
 *
 * All loop state lives inside the active project's workspace under `.pi/`:
 *
 *   {workspace}/.pi/config.json        project config (written at seed time, M5)
 *   {workspace}/.pi/state/loop.lock    PID + lock file (one loop per project)
 *   {workspace}/.pi/state/stop         stop file (checked every cycle)
 *   {workspace}/.pi/logs/loop.out      nohup stdout/stderr capture
 *   {workspace}/.pi/logs/runs.jsonl    one JSON line per persona invocation
 *   {workspace}/.pi/runs/{runId}/      per-run output (context, transcript)
 */

/** Relative (to workspace) path of the loop lock file. */
export const LOOP_LOCK_REL = ".pi/state/loop.lock";

/** Relative (to workspace) path of the stop file. */
export const STOP_FILE_REL = ".pi/state/stop";

/** Relative (to workspace) path of the loop nohup log. */
export const LOOP_LOG_REL = ".pi/logs/loop.out";

/** Relative (to workspace) path of the persona-run ledger. */
export const RUNS_LEDGER_REL = ".pi/logs/runs.jsonl";

/** Relative (to workspace) root of the per-run output directories. */
export const RUNS_DIR_REL = ".pi/runs";

/** Relative (to workspace) path of the initiation state (plan.md §8.2). */
export const INITIATION_STATE_REL = ".pi/state/initiation.json";

/** Version of the loop lock file schema. */
export const LOCK_VERSION = 1;

/** Version of the run-ledger line schema. */
export const RUN_LEDGER_VERSION = 1;

/** Dispatcher decision codes (plan.md §15). */
export const DECISION = {
	STOP: "stop",
	WAIT: "wait",
	ENGINEER: "engineer",
	ENGINEER_MERGE: "engineer_merge",
	REVIEW: "review",
	PM: "pm",
};

/** Persona names recognised by the dispatcher (personas/*.md in M7–M9). */
export const PERSONAS = {
	PM: "pm",
	ENGINEER: "engineer",
	REVIEW: "review-engineer",
};

/** Labels applied by the harness to issues/PRs (plan.md §15 / M7–M9). */
export const LABELS = {
	READY: "pi:ready",
	NEEDS_HUMAN: "pi:needs-human",
	BLOCKED: "pi:blocked",
	PM_NOTE: "pi:pm-note",
	APPROVED: "pi:approved",
	MERGE_READY: "pi:merge-ready",
	CHANGES_REQUESTED: "pi:changes-requested",
	REVIEW_REQUESTED: "pi:review-requested",
	TYPE_INFRA: "type:infra",
};
