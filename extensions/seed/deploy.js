/**
 * GitHub Pages deployment support for auto-pi (M4, plan.md §12.4 / §29.1).
 *
 * Provides the helpers the harness uses to:
 *
 *   - read the latest run status of the Pages deploy workflow
 *     (`getLatestWorkflowRun` / `checkDeploymentStatus`)
 *   - detect a completed-but-failed deployment (`deploymentFailed`)
 *   - surface a deployment failure to a human instead of retrying forever by
 *     creating/updating a `pi:needs-human` + `pi:blocked` + `type:infra` issue
 *     carrying a `PI-HUMAN` marker (`createOrUpdateNeedsHumanIssue`)
 *
 * GitHub access is injected as a `gh(args, opts)` async function (same shape as
 * the helper in `extensions/seed/core.js`) so the logic is fully testable with
 * a fake and works identically from the interactive `/seed` command, the loop
 * orchestrator (M6), and the fallback CLI.
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

/** Path (repo-relative) of the Pages deploy workflow generated at scaffold time. */
export const DEPLOY_WORKFLOW_FILE = ".github/workflows/deploy-pages.yml";

/** Labels applied to the human-attention issue created on Pages failure. */
export const PAGES_ISSUE_LABELS = ["pi:needs-human", "pi:blocked", "type:infra"];

/** Unique marker placed in the issue body so we can find/update it later. */
export const PI_HUMAN_MARKER = "PI-HUMAN";

/** Machine-readable reason logged when Pages deployment fails. */
export const REASON_PAGES_DEPLOYMENT_FAILED = "github_pages_deployment_failed";

/** Default title for the needs-human issue. */
export const DEFAULT_ISSUE_TITLE = "GitHub Pages deployment failed — needs human attention";

/**
 * Read the most recent run of the Pages deploy workflow for a repo.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Function} gh  injected `gh(args, opts)` runner
 * @param {object} [opts] { workflowPath? }
 * @returns {Promise<{ ok: boolean, run?: object|null, error?: string }>}
 */
export async function getLatestWorkflowRun(owner, repo, gh, opts = {}) {
	const workflowPath = opts.workflowPath || DEPLOY_WORKFLOW_FILE;
	const res = await gh([
		"run", "list",
		"--repo", `${owner}/${repo}`,
		"--workflow", workflowPath,
		"--limit", "1",
		"--json", "databaseId,status,conclusion,headBranch,createdAt,displayTitle",
	]);
	if (!res.ok) {
		return { ok: false, error: res.stderr?.trim() || res.stdout?.trim() || "gh run list failed" };
	}
	let runs = [];
	try {
		runs = JSON.parse(res.stdout || "[]");
	} catch {
		return { ok: false, error: "gh run list returned non-JSON output" };
	}
	if (!Array.isArray(runs) || runs.length === 0) {
		return { ok: true, run: null };
	}
	return { ok: true, run: runs[0] };
}

/**
 * True when a run has completed with a failing conclusion (the Pages deploy
 * workflow reports failure on a bad build, missing Pages source, plan/visibility
 * block, etc.). Runs that never ran or are still in progress are not failures.
 *
 * @param {object|null} run  a run object from `getLatestWorkflowRun`
 * @returns {boolean}
 */
export function deploymentFailed(run) {
	if (!run) return false;
	if (run.status !== "completed") return false;
	const conclusion = String(run.conclusion || "").toLowerCase();
	return conclusion === "failure" || conclusion === "cancelled";
}

/**
 * Classify the current Pages deployment state for a repo.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   state: "success"|"failed"|"in_progress"|"not_run"|"unknown",
 *   run?: object|null,
 *   error?: string
 * }>}
 */
export async function checkDeploymentStatus(owner, repo, gh, opts = {}) {
	const { ok, run, error } = await getLatestWorkflowRun(owner, repo, gh, opts);
	if (!ok) return { ok: false, state: "unknown", error };
	if (!run) return { ok: true, state: "not_run", run: null };
	if (run.status !== "completed") return { ok: true, state: "in_progress", run };
	const conclusion = String(run.conclusion || "").toLowerCase();
	if (conclusion === "success") return { ok: true, state: "success", run };
	if (conclusion === "failure" || conclusion === "cancelled") {
		return { ok: true, state: "failed", run };
	}
	return { ok: true, state: conclusion || "unknown", run };
}

/**
 * Find an existing Pages-deployment needs-human issue for the repo (by body
 * marker). Returns null when none exists.
 *
 * @returns {Promise<{ ok: boolean, issue?: object|null, error?: string }>}
 */
export async function findNeedsHumanIssue(owner, repo, gh) {
	const res = await gh([
		"issue", "list",
		"--repo", `${owner}/${repo}`,
		"--label", "pi:needs-human",
		"--state", "open",
		"--json", "number,title,body,url",
	]);
	if (!res.ok) {
		return { ok: false, error: res.stderr?.trim() || res.stdout?.trim() || "gh issue list failed" };
	}
	let issues = [];
	try {
		issues = JSON.parse(res.stdout || "[]");
	} catch {
		return { ok: false, error: "gh issue list returned non-JSON output" };
	}
	const match = (Array.isArray(issues) ? issues : []).find(
		(i) => i.body && i.body.includes(PI_HUMAN_MARKER) && /pages deployment/i.test(i.title || ""),
	);
	return { ok: true, issue: match || null };
}

/**
 * Build the needs-human issue body for a Pages deployment failure.
 *
 * @param {object} params { owner, repo, run, detail? }
 * @returns {string} markdown issue body
 */
export function buildNeedsHumanBody({ owner, repo, run = null, detail = "" }) {
	const runId = run?.databaseId ? `#${run.databaseId}` : "(unknown run)";
	const branch = run?.headBranch ? `\`${run.headBranch}\`` : "`main`";
	const lines = [
		`${PI_HUMAN_MARKER}`,
		"",
		"## GitHub Pages deployment failed",
		"",
		`The Pages deployment workflow for \`${owner}/${repo}\` failed and auto-pi will **not** retry it automatically.`,
		"",
		`- Workflow: \`.github/workflows/deploy-pages.yml\``,
		`- Latest run: ${runId} (branch ${branch})`,
		`- Status: \`${run?.conclusion || "failure"}\``,
		`- Reason: \`${REASON_PAGES_DEPLOYMENT_FAILED}\``,
		"",
		detail ? `${detail}\n` : "",
		"### Likely causes on the free plan",
		"",
		"- **Private repo on GitHub Free / Pro:** GitHub Pages is only available for **public** repositories on the free plan (Pro/Team allow private Pages).",
		"- **Pages not enabled:** the repo's Pages source must be set to **GitHub Actions** (Settings → Pages → Build and deployment → Source).",
		"- **Build error:** `npm run build` failed in CI (asset base path, TypeScript, or missing dependency).",
		"",
		"### How to resolve",
		"",
		"1. Make the repo public (or upgrade the plan) if it is private, or",
		"2. Enable Pages with source **GitHub Actions**, or",
		"3. Fix the build error and push again.",
		"",
		"Once resolved, re-run the deployment (push to `main` or run the workflow manually) and auto-pi will pick up the successful deployment.",
	];
	return lines.join("\n");
}

/**
 * Create a `pi:needs-human` + `pi:blocked` + `type:infra` issue for a Pages
 * deployment failure, or update the existing one so we never spam duplicates
 * (and never retry forever). Returns the created/updated issue.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Function} gh
 * @param {object} [opts] { run?, detail?, title?, dryRun? }
 * @returns {Promise<{ ok: boolean, created?: boolean, issue?: object, error?: string }>}
 */
export async function createOrUpdateNeedsHumanIssue(owner, repo, gh, opts = {}) {
	const title = opts.title || DEFAULT_ISSUE_TITLE;
	const body = buildNeedsHumanBody({
		owner,
		repo,
		run: opts.run || null,
		detail: opts.detail || "",
	});

	// Find any existing needs-human Pages issue first so we update rather than
	// duplicate — this is what prevents unbounded retries / issue spam.
	const existing = await findNeedsHumanIssue(owner, repo, gh);
	if (!existing.ok) {
		return { ok: false, error: existing.error };
	}
	if (existing.issue) {
		if (opts.dryRun) {
			return { ok: true, created: false, issue: existing.issue };
		}
		const res = await gh([
			"issue", "edit", String(existing.issue.number),
			"--repo", `${owner}/${repo}`,
			"--title", title,
			"--body", body,
		]);
		if (!res.ok) {
			return { ok: false, error: res.stderr?.trim() || res.stdout?.trim() || "gh issue edit failed" };
		}
		return { ok: true, created: false, issue: { ...existing.issue, title, body } };
	}

	if (opts.dryRun) {
		return { ok: true, created: true, issue: { number: 0, title, body } };
	}
	const res = await gh([
		"issue", "create",
		"--repo", `${owner}/${repo}`,
		"--title", title,
		"--body", body,
		"--label", PAGES_ISSUE_LABELS.join(","),
	]);
	if (!res.ok) {
		return { ok: false, error: res.stderr?.trim() || res.stdout?.trim() || "gh issue create failed" };
	}
	// `gh issue create` prints the issue URL on stdout; parse the number from it.
	const url = (res.stdout || "").trim();
	const numberMatch = /\/issues\/(\d+)\s*$/.exec(url);
	return {
		ok: true,
		created: true,
		issue: { number: numberMatch ? Number(numberMatch[1]) : 0, title, body, url },
	};
}

/**
 * One-shot "handle a Pages deployment failure" helper: classify the latest run
 * and, if it failed, ensure a needs-human issue exists. If the deployment is
 * healthy (success / not run / in progress), it does nothing. This is the
 * surface the loop calls each cycle — it never retries the deployment itself,
 * so a persistent failure converges on a single human-attention issue.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   state: string,
 *   handled?: boolean,
 *   issue?: object|null,
 *   error?: string
 * }>}
 */
export async function handlePagesDeployment(owner, repo, gh, opts = {}) {
	const status = await checkDeploymentStatus(owner, repo, gh, opts);
	if (!status.ok) {
		return { ok: false, state: status.state, error: status.error };
	}
	if (status.state !== "failed") {
		return { ok: true, state: status.state, handled: false, issue: null };
	}
	const result = await createOrUpdateNeedsHumanIssue(owner, repo, gh, {
		run: status.run,
		detail: opts.detail,
		dryRun: opts.dryRun,
	});
	if (!result.ok) {
		return { ok: false, state: status.state, handled: false, error: result.error };
	}
	return { ok: true, state: status.state, handled: true, issue: result.issue };
}
