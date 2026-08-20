/**
 * Review Engineer context packer for the auto-pi loop (M9, plan.md §21.1 context rules).
 *
 * Builds the focused context file passed to a fresh Review Engineer persona
 * session. Per plan.md §21.1 the Review Engineer context carries ONLY what it
 * needs to physically verify a PR:
 *
 *   - the target PR — body, labels, head/base refs, mergeable, review state
 *   - the PR diff summary — a compact per-file change summary (additions,
 *     deletions, files touched) so the reviewer can scope the review
 *   - the linked issue — body + acceptance criteria (the `- [ ]` checklist)
 *   - open issue + PR summaries (what else is in flight)
 *   - test / coverage / build output — the verification evidence to check
 *   - policy excerpts — testing policy, ui-thin-layer policy, done-definition,
 *     engineering guidelines (plan.md §25)
 *   - review settings — `config.review.reviewerCanPushTestCommits` (default false)
 *
 * The packer is deterministic: it reads the workspace files, the scanned GitHub
 * state, queries GitHub for the target PR + linked issue, and excerpts any
 * policy files that exist in `policies/`. The persona then performs the review
 * logic (run verification commands, post PI-REVIEW comments, approve or request
 * changes) using its own tools.
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LABELS, REVIEWER_CAN_PUSH_TEST_COMMITS_DEFAULT } from "./constants.js";

/** Relative (to workspace) paths of the project files the Reviewer reads. */
export const PROJECT_FILES = {
	manifest: "manifest.md",
	projectState: "project-state.md",
	changelog: "CHANGELOG.md",
};

/** Relative (to workspace) path of the policies directory. */
export const POLICIES_DIR = "policies";

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
 * Extract the linked issue number(s) from a PR body (plan.md §21.1). Looks for
 * `Closes #N`, `#N`, and the `<!-- pi:pr issue=N -->` marker.
 *
 * @param {string} body PR body
 * @returns {number|null} the first linked issue number, or null
 */
export function linkedIssueNumber(body) {
	const text = String(body || "");
	// Explicit `<!-- pi:pr issue=N -->` marker.
	const marker = /<!--\s*pi:pr\s+issue=(\d+)\s*-->/i.exec(text);
	if (marker) return Number(marker[1]);
	// `Closes #N` / `Fixes #N` / `Resolves #N`.
	const closes = /\b(?:closes|fixes|resolves)\s+#(\d+)/i.exec(text);
	if (closes) return Number(closes[1]);
	// Bare `#N` reference.
	const bare = /(?:^|\s)#(\d+)\b/.exec(text);
	if (bare) return Number(bare[1]);
	return null;
}

/**
 * Extract acceptance criteria from an issue body (plan.md §21.1). Returns the
 * list of `- [ ]` checklist items (and `- [x]` items, marked done).
 *
 * @param {string} body issue body
 * @returns {{ unchecked: string[], checked: string[] }}
 */
export function acceptanceCriteria(body) {
	const text = String(body || "");
	const unchecked = [];
	const checked = [];
	for (const line of text.split("\n")) {
		const m = /^\s*[-*]\s*\[( |x|X)\]\s*(.+)$/.exec(line);
		if (!m) continue;
		const item = m[2].trim();
		if (m[1].toLowerCase() === "x") checked.push(item);
		else unchecked.push(item);
	}
	return { unchecked, checked };
}

/**
 * Fetch the full body + labels of a PR (plan.md §21.1).
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} number
 * @param {Function} [ghFn] injected gh runner
 * @returns {Promise<{ ok: boolean, pr?: object, error?: string }>}
 */
export async function fetchPrDetail(owner, repo, number, ghFn = gh) {
	const fullName = `${owner}/${repo}`;
	const res = await ghFn(["pr", "view", String(number), "--repo", fullName, "--json",
		"number,title,body,headRefName,baseRefName,labels,mergeable,reviewDecision,url,createdAt,updatedAt"]);
	if (!res.ok) {
		return { ok: false, error: res.stderr?.trim() || res.stdout?.trim() || "gh pr view failed" };
	}
	const pr = parseJsonObject(res.stdout);
	return {
		ok: true,
		pr: {
			number: pr.number,
			title: pr.title,
			body: pr.body || "",
			headRefName: pr.headRefName,
			baseRefName: pr.baseRefName,
			url: pr.url,
			labels: Array.isArray(pr.labels)
				? pr.labels.map((l) => (typeof l === "string" ? l : l?.name || "")).filter(Boolean)
				: [],
			mergeable: pr.mergeable === "MERGEABLE",
			reviewDecision: pr.reviewDecision || "",
			createdAt: pr.createdAt,
			updatedAt: pr.updatedAt,
		},
	};
}

/**
 * Fetch a compact per-file diff summary for a PR (plan.md §21.1). Uses the
 * GitHub API to list changed files with additions/deletions, so the reviewer
 * can scope the review without pulling the entire diff into context.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} number
 * @param {Function} [ghFn] injected gh runner
 * @returns {Promise<{ ok: boolean, files?: object[], error?: string }>}
 */
export async function fetchPrDiffSummary(owner, repo, number, ghFn = gh) {
	const fullName = `${owner}/${repo}`;
	const res = await ghFn(["api", `repos/${fullName}/pulls/${number}/files`, "--paginate", "--jq",
		".[] | {filename, status, additions, deletions, changes}"]);
	if (!res.ok) {
		return { ok: false, error: res.stderr?.trim() || res.stdout?.trim() || "gh api pull files failed" };
	}
	return { ok: true, files: parseJsonArray(res.stdout) };
}

/**
 * Fetch the full body + comments of a linked issue (plan.md §21.1).
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
		"number,title,body,state,labels,url"]);
	if (!issueRes.ok) {
		return { ok: false, error: issueRes.stderr?.trim() || issueRes.stdout?.trim() || "gh issue view failed" };
	}
	const issue = parseJsonObject(issueRes.stdout);
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
		},
	};
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
 * Resolve the target PR to review from the scanned state.
 *
 * A PR is "ready for review" when it carries the `pi:review-needed` label, has
 * `reviewDecision === review_requested`, or is otherwise awaiting review but not
 * yet approved or changes-requested. Returns the first such PR, or null.
 *
 * @param {object} state scanned GitHub state
 * @returns {{ number: number, labels: string[] }|null}
 */
export function resolveReviewTarget(state) {
	const prs = state?.prs || [];
	const hasLabel = (labels, label) => labels.includes(label);
	const candidate = prs.find(
		(p) =>
			hasLabel(p.labels, LABELS.REVIEW_NEEDED) ||
			hasLabel(p.labels, LABELS.REVIEW_REQUESTED) ||
			p.review === "review_requested",
	);
	if (candidate) return { number: candidate.number, labels: candidate.labels };
	return null;
}

/**
 * Build the Review Engineer persona context (plan.md §21.1). Reads the workspace
 * project files, the scanned GitHub state, the target PR + linked issue details,
 * the PR diff summary, and policy excerpts.
 *
 * @param {object} params
 * @param {string} params.workspace   absolute project root
 * @param {object} params.config      parsed .pi/config.json
 * @param {object} params.state       scanned GitHub state (issues, prs, ci, ...)
 * @param {object} params.decision    dispatcher decision
 * @param {Function} [params.ghFn]    injected gh runner (defaults to real gh)
 * @returns {Promise<string>} markdown context
 */
export async function buildReviewContext({ workspace, config, state, decision, ghFn }) {
	const project = config?.project || {};
	const fullName = state?.fullName || `${project.owner || ""}/${project.repo || ""}`;
	const owner = project.owner || state?.owner || "";
	const repo = project.repo || state?.repo || "";

	const target = resolveReviewTarget(state);
	const reviewCfg = config?.review || {};

	const [manifest, projectState, changelog, policies, prDetail, diffSummary] =
		await Promise.all([
			readProjectFile(workspace, PROJECT_FILES.manifest),
			readProjectFile(workspace, PROJECT_FILES.projectState),
			readProjectFile(workspace, PROJECT_FILES.changelog),
			readPolicyExcerpts(workspace, ["engineering-guidelines", "testing-policy", "ui-thin-layer-policy", "done-definition", "pr-policy"]),
			target ? fetchPrDetail(owner, repo, target.number, ghFn) : Promise.resolve({ ok: false }),
			target ? fetchPrDiffSummary(owner, repo, target.number, ghFn) : Promise.resolve({ ok: false }),
		]);

	// Resolve the linked issue from the PR body (after PR detail is available).
	let issue = null;
	if (prDetail?.ok && prDetail.pr) {
		const linked = linkedIssueNumber(prDetail.pr.body);
		if (linked) {
			const res = await fetchIssueDetail(owner, repo, linked, ghFn);
			if (res.ok) issue = res.issue;
		}
	}

	const issues = state?.issues || [];
	const prs = state?.prs || [];
	const stack = config?.stack || {};

	const lines = [
		`# auto-pi Review Engineer persona context`,
		``,
		`## Project`,
		``,
		`- Name: ${project.name || ""}`,
		`- Repo: ${fullName}`,
		`- Default branch: ${project.defaultBranch || "main"}`,
		`- Demo URL: ${project.demoUrl || "(not yet)"}`,
		`- Stack: ${[stack.framework, stack.typescript ? "TypeScript" : "JS", stack.tailwind ? "Tailwind" : ""].filter(Boolean).join(", ") || "unknown"}`,
		``,
		`## Review settings`,
		``,
		`- reviewerCanPushTestCommits: ${reviewCfg.reviewerCanPushTestCommits === true ? "true" : "false (default)"} — the reviewer ${reviewCfg.reviewerCanPushTestCommits === true ? "MAY" : "must NOT"} push test commits to PR branches.`,
		``,
		`## Dispatch`,
		``,
		`- Decision: ${decision?.decision || "review"}`,
		`- Persona: ${decision?.persona || "review-engineer"}`,
		`- Reason: ${decision?.reason || ""}`,
		``,
		`## GitHub state (scanned at ${state?.scannedAt || "unknown"})`,
		``,
	];

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

	// Open issues.
	lines.push(`### Open issues (${issues.length})`, ``);
	if (issues.length) {
		for (const i of issues) {
			lines.push(`- #${i.number} **${i.title}** [${i.labels.join(", ") || "no labels"}]`);
		}
		lines.push(``);
	} else {
		lines.push(`No open issues.`, ``);
		lines.push(``);
	}

	// CI.
	lines.push(`### CI`, ``);
	lines.push(`- Latest workflow run: ${state?.ci?.status || "unknown"} / ${state?.ci?.conclusion || "unknown"}${state?.ci?.headBranch ? ` (${state.ci.headBranch})` : ""}`);
	lines.push(``);

	// Target PR.
	lines.push(`## Target PR`, ``);
	if (!target) {
		lines.push(`No PR is awaiting review (no \`pi:review-needed\` / \`pi:review-requested\` PR). Report that there is nothing to review and stop — do not invent work.`);
		lines.push(``);
	} else {
		lines.push(`**Review PR #${target.number}** (labels: ${target.labels.join(", ") || "none"}).`);
		lines.push(``);
		if (prDetail?.ok && prDetail.pr) {
			const p = prDetail.pr;
			lines.push(`### PR #${p.number} — ${p.title}`, ``);
			lines.push(`- Head: \`${p.headRefName}\` → Base: \`${p.baseRefName}\``);
			lines.push(`- Mergeable: ${p.mergeable}`);
			lines.push(`- Review decision: ${p.reviewDecision || "none"}`);
			lines.push(`- URL: ${p.url || ""}`);
			lines.push(``);
			lines.push(`#### PR body`, ``);
			lines.push(excerpt(p.body || "(no body)", 4000));
			lines.push(``);
		} else {
			lines.push(`(Could not fetch PR detail — use the open-PR summary above and \`gh pr view\` directly.)`, ``);
			lines.push(``);
		}

		// Diff summary.
		if (diffSummary?.ok && diffSummary.files?.length) {
			lines.push(`### PR diff summary (${diffSummary.files.length} files)`, ``);
			let totalAdd = 0;
			let totalDel = 0;
			for (const f of diffSummary.files) {
				lines.push(`- \`${f.filename}\` (${f.status || "modified"}) +${f.additions ?? 0}/-${f.deletions ?? 0}`);
				totalAdd += Number(f.additions) || 0;
				totalDel += Number(f.deletions) || 0;
			}
			lines.push(`- **Total: +${totalAdd}/-${totalDel} across ${diffSummary.files.length} files**`);
			lines.push(``);
		} else {
			lines.push(`### PR diff summary`, ``);
			lines.push(`(Could not fetch diff summary — run \`gh pr diff ${target.number} --repo ${fullName}\` directly.)`, ``);
			lines.push(``);
		}

		// Linked issue + acceptance criteria.
		if (issue) {
			const ac = acceptanceCriteria(issue.body);
			lines.push(`### Linked issue #${issue.number} — ${issue.title}`, ``);
			lines.push(excerpt(issue.body || "(no body)", 3000));
			lines.push(``);
			lines.push(`#### Acceptance criteria`, ``);
			if (ac.unchecked.length || ac.checked.length) {
				for (const c of ac.unchecked) lines.push(`- [ ] ${c}`);
				for (const c of ac.checked) lines.push(`- [x] ${c}`);
				lines.push(``);
				lines.push(`Verify each unchecked criterion is implemented and tested.`);
			} else {
				lines.push(`(No \`- [ ]\` acceptance criteria found in the issue body.)`, ``);
			}
			lines.push(``);
		} else {
			lines.push(`### Linked issue`, ``);
			lines.push(`(Could not resolve a linked issue from the PR body — check the PR body for \`Closes #N\` / the \`<!-- pi:pr issue=N -->\` marker.)`, ``);
			lines.push(``);
		}
	}

	// Verification commands.
	lines.push(`## Verification commands (run per PR)`, ``);
	lines.push(`- \`npm ci\` — install dependencies`);
	lines.push(`- \`npm run lint\` — lint`);
	lines.push(`- \`npm test\` — run tests`);
	lines.push(`- \`npm run test:coverage\` — coverage (core must be 100%)`);
	lines.push(`- \`npm run build\` — production build`);
	lines.push(``);
	lines.push(`Enforce **100% core coverage** (plan.md §19).`);
	lines.push(``);

	// Review rules.
	lines.push(`## Review rules (plan.md §18)`, ``);
	lines.push(`- Allowed reasons: failing tests, missing tests, missing acceptance coverage, broken build, lint failure, coverage failure, business logic in UI, unsafe dependency, secret-like strings, incorrect core behavior.`);
	lines.push(`- Disallow subjective / style / visual comments.`);
	lines.push(`- Every comment follows \`PI-REVIEW type=... severity=blocking|warning|info location=...\` with verification command, expected outcome, and location.`);
	lines.push(`- Missing-test detection across: empty/invalid input, duplicates, case sensitivity, boundaries, error/async paths, malformed data, missing fields.`);
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
	lines.push(`You are the Review Engineer persona. Using the context above and the repo at ${workspace}, review the target PR: run the verification commands, inspect the diff, check acceptance-coverage and missing tests, post \`PI-REVIEW\` comments, and approve or request changes per your system prompt.`);
	lines.push(``);

	return lines.join("\n");
}

/** Re-exported gh runner for tests. */
export { gh as defaultGh };
