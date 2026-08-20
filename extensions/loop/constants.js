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
	NEEDS_PM: "pi:needs-pm",
	APPROVED: "pi:approved",
	MERGE_READY: "pi:merge-ready",
	CHANGES_REQUESTED: "pi:changes-requested",
	REVIEW_REQUESTED: "pi:review-requested",
	TYPE_INFRA: "type:infra",
};

/**
 * Issue size labels (plan.md §23.1). The PM creates only XS/S issues so each
 * fits in a single Engineer session. Larger work is split into a milestone
 * and broken down further (plan.md §16.3).
 */
export const SIZES = {
	XS: "size:xs",
	S: "size:s",
	M: "size:m",
	L: "size:l",
};

/**
 * Issue type labels (plan.md §23.1). `TYPE_INFRA` is defined above; the rest
 * are added here for PM issue creation.
 */
export const TYPES = {
	FEATURE: "type:feature",
	BUG: "type:bug",
	REFACTOR: "type:refactor",
	TEST: "type:test",
	INFRA: "type:infra",
};

/**
 * Milestone label prefix. Issues are labelled `milestone:{slug}` so the PM
 * can group work and the Engineer can scope PRs (plan.md §23.1).
 */
export const MILESTONE_LABEL_PREFIX = "milestone:";

/**
 * PM note marker in an issue body (plan.md §16.2). Matches lines like:
 *   `PI-NOTE persona=PM reason=scope-too-large action=split`
 * The persona=PM part is required; extra key=value attributes are captured.
 */
export const PM_NOTE_RE = /PI-NOTE\s+persona=PM\b([^\n]*)/gi;

/**
 * Marker a PM writes into an issue body to resolve a note after handling it
 * (plan.md §16.2). Once present, the note is considered resolved and the
 * `pi:pm-note` / `pi:needs-pm` labels are removed.
 */
export const PM_NOTE_RESOLVED = "PI-NOTE-RESOLVED";

/**
 * Issue idempotency marker (plan.md §16.3): `<!-- pi:issue-id M1-T3 -->`.
 * Written into a created issue body so the PM can detect duplicates on later
 * cycles and avoid re-creating the same issue.
 */
export const ISSUE_ID_RE = /<!--\s*pi:issue-id\s+(M\d+)-T(\d+)\s*-->/;

/**
 * Milestone marker in a manifest entry: `<!-- pi:milestone M1 -->`.
 * Used to track which milestone an issue belongs to.
 */
export const MILESTONE_MARKER_RE = /<!--\s*pi:milestone\s+(M\d+)\s*-->/;

/**
 * Milestone label (plan.md §23.1): `milestone:{slug}` where slug is lowercase
 * milestone id (e.g. `milestone:m1`).
 */
export function milestoneLabel(id) {
	return MILESTONE_LABEL_PREFIX + String(id || "").toLowerCase();
}
