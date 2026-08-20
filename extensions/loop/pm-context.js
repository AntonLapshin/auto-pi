/**
 * PM context packer for the auto-pi loop (M7, plan.md §21.1 context rules).
 *
 * Builds the focused context file passed to a fresh PM persona session. Per
 * plan.md §21.1 the PM context carries ONLY what the PM needs to plan the next
 * slice of work:
 *
 *   - `manifest.md`        — project charter / intent
 *   - `project-state.md`   — current state and progress
 *   - `CHANGELOG.md`       — what has changed so far
 *   - open issue summaries — what is already planned / in flight (with labels)
 *   - open PR summaries    — what is being implemented / reviewed
 *   - recent merged PR summaries — recently completed work
 *   - policy excerpts      — issue-granularity, done-definition, etc. (if any)
 *
 * The packer is deterministic: it reads the workspace files and the scanned
 * GitHub state, queries GitHub for recent merged PRs, and excerpts any policy
 * files that exist in `policies/`. The persona then performs the PM logic
 * (PM-note handling, issue creation, done detection) using its own tools.
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PM_NOTE_RE, PM_NOTE_RESOLVED, ISSUE_ID_RE } from "./constants.js";

/** Relative (to workspace) paths of the project files the PM reads. */
export const PROJECT_FILES = {
	manifest: "manifest.md",
	projectState: "project-state.md",
	changelog: "CHANGELOG.md",
};

/** Relative (to workspace) path of the policies directory. */
export const POLICIES_DIR = "policies";

/** Number of recent merged PRs to summarise (plan.md §21.1). */
export const MERGED_PR_LIMIT = 5;

/** Default `gh` runner (same shape as state-scanner / seed). */
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
 * Fetch recent merged PR summaries from GitHub (plan.md §21.1). Returns an
 * array of { number, title, mergedAt, labels }.
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
 * Summarise an open issue for the PM context (plan.md §21.1).
 */
function issueSummary(i) {
	const noteFlags = [];
	if (PM_NOTE_RE.test(i.body || "")) noteFlags.push("pm-note");
	if (i.body && i.body.includes(PM_NOTE_RESOLVED)) noteFlags.push("note-resolved");
	const idMatch = ISSUE_ID_RE.exec(i.body || "");
	const id = idMatch ? `${idMatch[1]}-T${idMatch[2]}` : "";
	return `- #${i.number} **${i.title}** [${i.labels.join(", ") || "no labels"}]${id ? ` (id:${id})` : ""}${noteFlags.length ? ` — ${noteFlags.join(", ")}` : ""}`;
}

/**
 * Build the PM persona context (plan.md §21.1). Reads the workspace project
 * files (manifest, project-state, changelog), the scanned GitHub state (open
 * issues + PRs), recent merged PRs, and policy excerpts.
 *
 * @param {object} params
 * @param {string} params.workspace   absolute project root
 * @param {object} params.config      parsed .pi/config.json
 * @param {object} params.state       scanned GitHub state (issues, prs, ci, ...)
 * @param {object} params.decision    dispatcher decision
 * @param {Function} [params.ghFn]    injected gh runner (defaults to real gh)
 * @returns {Promise<string>} markdown context
 */
export async function buildPmContext({ workspace, config, state, decision, ghFn }) {
	const project = config?.project || {};
	const fullName = state?.fullName || `${project.owner || ""}/${project.repo || ""}`;

	const [manifest, projectState, changelog, mergedPrs, policies] = await Promise.all([
		readProjectFile(workspace, PROJECT_FILES.manifest),
		readProjectFile(workspace, PROJECT_FILES.projectState),
		readProjectFile(workspace, PROJECT_FILES.changelog),
		fetchMergedPrs(project.owner || state?.owner || "", project.repo || state?.repo || "", ghFn),
		readPolicyExcerpts(workspace, ["issue-granularity", "done-definition", "engineering-guidelines"]),
	]);

	const issues = state?.issues || [];
	const prs = state?.prs || [];

	const lines = [
		`# auto-pi PM persona context`,
		``,
		`## Project`,
		``,
		`- Name: ${project.name || ""}`,
		`- Repo: ${fullName}`,
		`- Default branch: ${project.defaultBranch || "main"}`,
		`- Demo URL: ${project.demoUrl || "(not yet)"}`,
		``,
		`## Dispatch`,
		``,
		`- Decision: ${decision?.decision || "pm"}`,
		`- Persona: ${decision?.persona || "pm"}`,
		`- Reason: ${decision?.reason || ""}`,
		``,
		`## GitHub state (scanned at ${state?.scannedAt || "unknown"})`,
		``,
	];

	// Open issues.
	lines.push(`### Open issues (${issues.length})`, ``);
	if (issues.length) {
		for (const i of issues) lines.push(issueSummary(i));
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

	// Manifest.
	if (manifest) {
		lines.push(`## Manifest (manifest.md)`, ``);
		lines.push(excerpt(manifest, 4000));
		lines.push(``);
	}

	// Project state.
	if (projectState) {
		lines.push(`## Project state (project-state.md)`, ``);
		lines.push(excerpt(projectState, 4000));
		lines.push(``);
	}

	// Changelog.
	if (changelog) {
		lines.push(`## Changelog (CHANGELOG.md)`, ``);
		lines.push(excerpt(changelog, 3000));
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
	}

	lines.push(`## Task`, ``);
	lines.push(`You are the PM persona. Using the context above and the repo at ${workspace}, perform the PM work described in your system prompt (handle PM notes, plan issues, update project state, detect done).`);
	lines.push(``);

	return lines.join("\n");
}

/** Re-exported gh runner for tests. */
export { gh as defaultGh };
