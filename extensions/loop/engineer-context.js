/**
 * Engineer context packer for the auto-pi loop (M8, plan.md §21.1 context rules).
 *
 * Builds the focused context file passed to a fresh Engineer persona session.
 * Per plan.md §21.1 the Engineer context carries ONLY what the Engineer needs to
 * implement an issue or address review comments and open/merge a PR:
 *
 *   - the target issue — full body + acceptance criteria + comments (when
 *     implementing a `pi:ready` issue)
 *   - the target PR — review comments to address (when the dispatcher routed the
 *     Engineer to address changes-requested / merge an approved PR)
 *   - project structure — where core / view-models / components / adapters live
 *     (plan.md §17.3 / §19)
 *   - test commands — how to run lint / test / coverage / build
 *   - recent merged PR summaries — what has been shipped recently
 *   - policy excerpts — engineering guidelines, testing policy, UI thin-layer
 *     policy (plan.md §25)
 *   - changelog — so the Engineer can append a consistent entry
 *
 * The packer is deterministic: it reads the workspace files, the scanned GitHub
 * state, queries GitHub for the target issue/PR details, and excerpts any policy
 * files that exist in `policies/`. The persona then performs the Engineer logic
 * (implement, test, PR, review-address, merge) using its own tools.
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ISSUE_ID_RE, LABELS } from "./constants.js";

/** Relative (to workspace) paths of the project files the Engineer reads. */
export const PROJECT_FILES = {
	changelog: "CHANGELOG.md",
	manifest: "manifest.md",
	projectState: "project-state.md",
};

/** Relative (to workspace) path of the policies directory. */
export const POLICIES_DIR = "policies";

/** Number of recent merged PRs to summarise (plan.md §21.1). */
export const MERGED_PR_LIMIT = 5;

/** Default `gh` runner (same shape as state-scanner / pm-context). */
async function gh(args, opts = {}) {
	const { execa } = await import("execa");
	try {
		const res = await execa("gh", args, { reject: false, timeout: 30000, ...opts });
		return { ok: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
	} catch (err) {
		return { ok: false, stdout: "", stderr: String(err?.message || err), exitCode: 1 };
	}
}

/** Parse a `gh ... --json` array defensively. */
function parseJsonArray(stdout) {
	try {
		const parsed = JSON.parse(stdout || "[]");
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** Parse a `gh ... --json` object defensively. */
function parseJsonObject(stdout) {
	try {
		const parsed = JSON.parse(stdout || "{}");
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** Read a workspace file, returning null when missing/unreadable. */
async function readProjectFile(workspace, rel) {
	const file = join(workspace, rel);
	if (!existsSync(file)) return null;
	try {
		return await readFile(file, "utf8");
	} catch {
		return null;
	}
}

/** Truncate long text to a bounded excerpt (keeps context small). */
function excerpt(text, max = 4000) {
	if (text == null) return "";
	const s = String(text).trim();
	if (s.length <= max) return s;
	return s.slice(0, max) + "\n… (truncated)";
}

/**
 * Fetch the full body + comments of an issue (plan.md §21.1). Comments are
 * fetched via the GitHub API and appended as a compact thread.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} number
 * @param {Function} [ghFn] injected gh runner
 * @returns {Promise<{ ok: boolean, issue?: object, error?: string }>}
 */
export async function fetchIssueDetail(owner, repo, number, ghFn = gh) {
	const fullName = `${owner}/${repo}`;
	const issueRes = await ghFn(["issue", "view", String(number), "--repo", fullName, "--json",
		"number,title,body,state,labels,url,createdAt,updatedAt"]);
	if (!issueRes.ok) {
		return { ok: false, error: issueRes.stderr?.trim() || issueRes.stdout?.trim() || "gh issue view failed" };
	}
	const issue = parseJsonObject(issueRes.stdout);

	// Fetch issue comments (thread) via the API.
	const commentsRes = await ghFn(["api", `repos/${fullName}/issues/${number}/comments`, "--jq",
		".[] | {user: .user.login, createdAt: .created_at, body: .body}"]);
	let comments = [];
	if (commentsRes.ok) {
		comments = parseJsonArray(commentsRes.stdout);
	}

	return {
		ok: true,
		issue: {
			number: issue.number,
			title: issue.title,
			body: issue.body || "",
			state: issue.state,
			url: issue.url,
			labels: Array.isArray(issue.labels)
				? issue.labels.map((l) => (typeof l === "string" ? l : l?.name || "")).filter(Boolean)
				: [],
			createdAt: issue.createdAt,
			updatedAt: issue.updatedAt,
			comments,
		},
	};
}

/**
 * Fetch the review comments of a PR (plan.md §21.1 — the Engineer needs these
 * when the dispatcher routed it to address changes-requested). Returns inline
 * comments plus the review-thread comments.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} number
 * @param {Function} [ghFn] injected gh runner
 * @returns {Promise<{ ok: boolean, comments?: object[], error?: string }>}
 */
export async function fetchPrReviewComments(owner, repo, number, ghFn = gh) {
	const fullName = `${owner}/${repo}`;
	// Inline review comments (on code lines).
	const inlineRes = await ghFn(["api", `repos/${fullName}/pulls/${number}/comments`, "--jq",
		".[] | {user: .user.login, path: .path, line: .line, body: .body, createdAt: .created_at}"]);
	let inline = [];
	if (inlineRes.ok) {
		inline = parseJsonArray(inlineRes.stdout);
	}
	// Review-thread comments (top-level review bodies).
	const reviewsRes = await ghFn(["api", `repos/${fullName}/pulls/${number}/reviews`, "--jq",
		".[] | {user: .user.login, state: .state, body: .body, submittedAt: .submitted_at}"]);
	let reviews = [];
	if (reviewsRes.ok) {
		reviews = parseJsonArray(reviewsRes.stdout);
	}
	return { ok: true, comments: { inline, reviews } };
}

/**
 * Fetch recent merged PR summaries from GitHub (plan.md §21.1).
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Function} [ghFn] injected gh runner
 * @param {number} [limit]
 */
export async function fetchMergedPrs(owner, repo, ghFn = gh, limit = MERGED_PR_LIMIT) {
	const fullName = `${owner}/${repo}`;
	const res = await ghFn([
		"pr", "list", "--repo", fullName, "--state", "merged",
		"--limit", String(limit),
		"--json", "number,title,labels,mergedAt",
	]);
	if (!res.ok) return [];
	return parseJsonArray(res.stdout).map((p) => ({
		number: p.number,
		title: p.title,
		mergedAt: p.mergedAt || "",
		labels: Array.isArray(p.labels)
			? p.labels.map((l) => (typeof l === "string" ? l : l?.name || "")).filter(Boolean)
			: [],
	}));
}

/**
 * Read policy excerpts from `{workspace}/policies/*.md` (plan.md §21.1). Only
 * the named policies are excerpted; each is bounded. Returns a map of
 * { filename: excerpt }.
 *
 * @param {string} workspace
 * @returns {Promise<object>} { [name]: text }
 */
export async function readPolicyExcerpts(workspace, names = []) {
	const dir = join(workspace, POLICIES_DIR);
	if (!existsSync(dir)) return {};
	const result = {};
	let files;
	try {
		files = await readdir(dir);
	} catch {
		return {};
	}
	for (const name of names) {
		const file = join(dir, `${name}.md`);
		if (!files.includes(`${name}.md`)) continue;
		const text = await readProjectFile(workspace, join(POLICIES_DIR, `${name}.md`));
		if (text) result[name] = excerpt(text, 2500);
	}
	return result;
}

/**
 * Resolve the target work item for the Engineer from the scanned state.
 *
 * Dispatch priority (matches the dispatcher §15 order):
 *   1. a PR with changes requested → address review comments on that PR
 *   2. a PR approved + merge-ready → merge that PR
 *   3. a `pi:ready` issue → implement that issue
 *
 * @param {object} state scanned GitHub state
 * @returns {{ kind: "review"|"merge"|"implement", number: number, labels: string[] }|null}
 */
export function resolveTarget(state) {
	const issues = state?.issues || [];
	const prs = state?.prs || [];
	const hasLabel = (labels, label) => labels.includes(label);

	// 1. Address review comments on a PR with changes requested.
	const changesRequested = prs.find((p) => p.review === "changes_requested");
	if (changesRequested) {
		return { kind: "review", number: changesRequested.number, labels: changesRequested.labels };
	}

	// 2. Merge an approved + merge-ready PR.
	const approvedMerge = prs.find(
		(p) => p.review === "approved" && (p.mergeable || hasLabel(p.labels, LABELS.MERGE_READY)),
	);
	if (approvedMerge) {
		return { kind: "merge", number: approvedMerge.number, labels: approvedMerge.labels };
	}

	// 3. Implement the lowest-numbered `pi:ready` issue not already in flight.
	const ready = issues.filter((i) => hasLabel(i.labels, LABELS.READY));
	if (ready.length) {
		// Skip issues that already have an open PR or a task branch in flight.
		const inFlightPrNumbers = new Set(prs.map((p) => p.number));
		const candidate = ready
			.filter((i) => !inFlightPrNumbers.has(i.number))
			.sort((a, b) => a.number - b.number)[0];
		if (candidate) {
			return { kind: "implement", number: candidate.number, labels: candidate.labels };
		}
	}

	return null;
}

/**
 * Build the Engineer persona context (plan.md §21.1). Reads the workspace
 * project files (manifest, project-state, changelog), the scanned GitHub state,
 * the target issue/PR details, recent merged PRs, and policy excerpts.
 *
 * @param {object} params
 * @param {string} params.workspace   absolute project root
 * @param {object} params.config      parsed .pi/config.json
 * @param {object} params.state       scanned GitHub state (issues, prs, ci, ...)
 * @param {object} params.decision    dispatcher decision
 * @param {Function} [params.ghFn]    injected gh runner (defaults to real gh)
 * @returns {Promise<string>} markdown context
 */
export async function buildEngineerContext({ workspace, config, state, decision, ghFn }) {
	const project = config?.project || {};
	const fullName = state?.fullName || `${project.owner || ""}/${project.repo || ""}`;
	const owner = project.owner || state?.owner || "";
	const repo = project.repo || state?.repo || "";

	const target = resolveTarget(state);

	const [manifest, projectState, changelog, mergedPrs, policies] = await Promise.all([
		readProjectFile(workspace, PROJECT_FILES.manifest),
		readProjectFile(workspace, PROJECT_FILES.projectState),
		readProjectFile(workspace, PROJECT_FILES.changelog),
		fetchMergedPrs(owner, repo, ghFn),
		readPolicyExcerpts(workspace, ["engineering-guidelines", "testing-policy", "ui-thin-layer-policy", "pr-policy"]),
	]);

	// Fetch the target detail (issue or PR review comments) when relevant.
	let issueDetail = null;
	let prReview = null;
	if (target?.kind === "implement") {
		const res = await fetchIssueDetail(owner, repo, target.number, ghFn);
		if (res.ok) issueDetail = res.issue;
	}
	if (target?.kind === "review") {
		const res = await fetchPrReviewComments(owner, repo, target.number, ghFn);
		if (res.ok) prReview = res.comments;
	}

	const issues = state?.issues || [];
	const prs = state?.prs || [];
	const stack = config?.stack || {};

	const lines = [
		`# auto-pi Engineer persona context`,
		``,
		`## Project`,
		``,
		`- Name: ${project.name || ""}`,
		`- Repo: ${fullName}`,
		`- Default branch: ${project.defaultBranch || "main"}`,
		`- Demo URL: ${project.demoUrl || "(not yet)"}`,
		`- Stack: ${[stack.framework, stack.typescript ? "TypeScript" : "JS", stack.tailwind ? "Tailwind" : ""].filter(Boolean).join(", ") || "unknown"}`,
		``,
		`## Dispatch`,
		``,
		`- Decision: ${decision?.decision || "engineer"}`,
		`- Persona: ${decision?.persona || "engineer"}`,
		`- Reason: ${decision?.reason || ""}`,
		``,
		`## GitHub state (scanned at ${state?.scannedAt || "unknown"})`,
		``,
	];

	// Open issues.
	lines.push(`### Open issues (${issues.length})`, ``);
	if (issues.length) {
		for (const i of issues) {
			const idMatch = ISSUE_ID_RE.exec(i.body || "");
			const id = idMatch ? ` (id:${idMatch[1]}-T${idMatch[2]})` : "";
			lines.push(`- #${i.number} **${i.title}** [${i.labels.join(", ") || "no labels"}]${id}`);
		}
		lines.push(``);
	} else {
		lines.push(`No open issues.`, ``);
		lines.push(``);
	}

	// Open PRs.
	lines.push(`### Open PRs (${prs.length})`, ``);
	if (prs.length) {
		for (const p of prs) {
			lines.push(`- #${p.number} **${p.title}** (review: ${p.review}, mergeable: ${p.mergeable}) [${p.labels.join(", ") || "no labels"}]`);
		}
		lines.push(``);
	} else {
		lines.push(`No open PRs.`, ``);
		lines.push(``);
	}

	// Recent merged PRs.
	lines.push(`### Recent merged PRs (${mergedPrs.length})`, ``);
	if (mergedPrs.length) {
		for (const p of mergedPrs) {
			lines.push(`- #${p.number} **${p.title}** (merged ${p.mergedAt})`);
		}
		lines.push(``);
	} else {
		lines.push(`No merged PRs yet.`, ``);
		lines.push(``);
	}

	// CI.
	lines.push(`### CI`, ``);
	lines.push(`- Latest workflow run: ${state?.ci?.status || "unknown"} / ${state?.ci?.conclusion || "unknown"}${state?.ci?.headBranch ? ` (${state.ci.headBranch})` : ""}`);
	lines.push(``);

	// Target work item.
	lines.push(`## Target work item`, ``);
	if (!target) {
		lines.push(`No \`pi:ready\` issue, no changes-requested PR, and no approved merge-ready PR was found. Report that there is nothing to do and stop — do not invent work.`);
		lines.push(``);
	} else if (target.kind === "implement") {
		lines.push(`**Implement issue #${target.number}** (labels: ${target.labels.join(", ") || "none"}).`);
		lines.push(``);
		if (issueDetail) {
			lines.push(`### Issue #${target.number} — ${issueDetail.title}`, ``);
			lines.push(issueDetail.body || `(no body)`);
			lines.push(``);
			if (issueDetail.comments?.length) {
				lines.push(`### Issue comments (${issueDetail.comments.length})`, ``);
				for (const c of issueDetail.comments) {
					lines.push(`- **@${c.user}** (${c.createdAt}): ${excerpt(c.body, 800)}`);
				}
				lines.push(``);
			}
		} else {
			lines.push(`(Could not fetch issue detail. Use the open-issue summary above.)`, ``);
			lines.push(``);
		}
	} else if (target.kind === "review") {
		lines.push(`**Address review comments on PR #${target.number}** (labels: ${target.labels.join(", ") || "none"}).`);
		lines.push(``);
		if (prReview) {
			if (prReview.reviews?.length) {
				lines.push(`### PR review thread (${prReview.reviews.length})`, ``);
				for (const r of prReview.reviews) {
					lines.push(`- **[${r.state}] @${r.user}** (${r.submittedAt}): ${excerpt(r.body || "(no body)", 1500)}`);
				}
				lines.push(``);
			}
			if (prReview.inline?.length) {
				lines.push(`### Inline review comments (${prReview.inline.length})`, ``);
				for (const c of prReview.inline) {
					lines.push(`- **@${c.user}** on \`${c.path}${c.line ? `:${c.line}` : ""}\` (${c.createdAt}): ${excerpt(c.body, 1500)}`);
				}
				lines.push(``);
			}
			if (!prReview.reviews?.length && !prReview.inline?.length) {
				lines.push(`(No review comments fetched — check the PR directly.)`, ``);
				lines.push(``);
			}
		}
	} else if (target.kind === "merge") {
		lines.push(`**Merge approved PR #${target.number}** (labels: ${target.labels.join(", ") || "none"}).`);
		lines.push(``);
		lines.push(`Merge it with \`gh pr merge ${target.number} --repo ${fullName} --squash --delete-branch\` only if it is approved, CI passes, has no unresolved testable comments, no conflict, and valid scope.`);
		lines.push(``);
	}

	// Project structure (plan.md §17.3 / §19).
	lines.push(`## Project structure (follow strictly)`, ``);
	lines.push(`- **\`src/core\`** — pure business logic. No React, no Tailwind, no browser APIs. Must be 100% covered.`);
	lines.push(`- **\`src/ui/viewModels\`** — thin view models. No business logic; bind core to component state.`);
	lines.push(`- **\`src/ui/components\`** — thin, dumb components. No business logic; render props and call callbacks.`);
	lines.push(`- **\`src/adapters\`** — storage / fetch / external adapters. Impure I/O lives here, never in core.`);
	lines.push(``);

	// Test commands.
	lines.push(`## Test commands`, ``);
	lines.push(`- \`npm ci\` — install dependencies`);
	lines.push(`- \`npm run lint\` — lint`);
	lines.push(`- \`npm test\` — run tests`);
	lines.push(`- \`npm run test:coverage\` — coverage (core must be 100%)`);
	lines.push(`- \`npm run build\` — production build`);
	lines.push(``);

	// Manifest.
	if (manifest) {
		lines.push(`## Manifest (manifest.md)`, ``);
		lines.push(excerpt(manifest, 2500));
		lines.push(``);
	}

	// Project state.
	if (projectState) {
		lines.push(`## Project state (project-state.md)`, ``);
		lines.push(excerpt(projectState, 2500));
		lines.push(``);
	}

	// Changelog.
	if (changelog) {
		lines.push(`## Changelog (CHANGELOG.md)`, ``);
		lines.push(excerpt(changelog, 2500));
		lines.push(``);
	}

	// Policy excerpts.
	const policyNames = Object.keys(policies);
	if (policyNames.length) {
		lines.push(`## Policy excerpts`, ``);
		for (const name of policyNames) {
			lines.push(`### ${name}`, ``);
			lines.push(policies[name]);
			lines.push(``);
		}
	} else {
		lines.push(`## Policy excerpts`, ``);
		lines.push(`(No policy files found in policies/ yet.)`, ``);
		lines.push(``);
	}

	lines.push(`## Task`, ``);
	lines.push(`You are the Engineer persona. Using the context above and the repo at ${workspace}, perform the Engineer work described in your system prompt (implement the target issue with tests, open a PR, address review comments, or squash-merge an approved PR).`);
	lines.push(``);

	return lines.join("\n");
}

/** Re-exported gh runner for tests. */
export { gh as defaultGh };
