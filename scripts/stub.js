/**
 * Shared not-implemented stub used by the fallback CLI scripts in the M0 skeleton.
 * Each later milestone replaces the corresponding script with real logic.
 *
 * Plain JS on purpose — these run under `node scripts/*.js` (no TS transpile).
 */

const MAP = {
	seed: "M2  (initiation & repo creation)",
	loop: "M6  (autonomous loop orchestrator)",
	stop: "M6  (stop the autonomous loop)",
	status: "M13 (active project & loop status)",
	doctor: "M1  (environment prerequisite check)",
};

export function runStub(cmd) {
	process.stdout.write(
		`[auto-pi] ${cmd}: not implemented yet (milestone skeleton) — see ` +
			`todo/milestone_0.md and ${MAP[cmd] ?? "a later milestone"}.\n`,
	);
	process.exit(0);
}
