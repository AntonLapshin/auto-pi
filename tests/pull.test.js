/**
 * Tests for the auto-pi `/loop-pull` flow (continue a project on another machine).
 *
 * Covers: repo-ref parsing, the clone + configure + active-record orchestration,
 * recreation of the git-ignored initiation marker, and the interaction with the
 * switch/loop-recognition helpers (so a pulled project is indistinguishable from
 * a locally-seeded one).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import { parseRepoRef, runPull, workspaceFor, ensureInitiationState } from "../extensions/pull/core.js";
import { listProjects, resolveProject, readActiveProject } from "../extensions/loop/orchestrator.js";

/** Build a minimal committed .pi/config.json like a seeded project would have. */
function projectConfig({ owner, repo, name }) {
	return {
		project: { name: name || repo, repo, owner, ownerEmail: "", defaultBranch: "main", demoUrl: "" },
		pi: { model: "", provider: "", contextMaxTokens: 0, maxRetries: 2, retryBaseDelayMs: 5000, retryMaxDelayMs: 30000 },
		loop: { intervalSeconds: 60, stopOnBudgetExceeded: true, maxConsecutiveFailures: 3 },
		limits: {},
		github: { autoCreateRepo: true, repoVisibility: "public" },
		stack: { framework: "react", typescript: true, tailwind: true, testRunner: "vitest" },
		quality: { coreCoveragePercent: 100, featureBranches: true },
		review: { reviewerCanPushTestCommits: false },
		pages: { enabled: true, deployBranch: "gh-pages" },
		notifications: { telegram: { enabled: false, botTokenEnv: "TELEGRAM_BOT_TOKEN", chatIdEnv: "TELEGRAM_CHAT_ID", notifyOnDone: true, notifyOnStopped: true, notifyOnNeedsHuman: true } },
		logging: { maxFileSizeMb: 10, rotate: true },
	};
}

// --- parseRepoRef ---

test("parseRepoRef: extracts owner/repo from common GitHub URL forms", () => {
	assert.deepEqual(parseRepoRef("https://github.com/AntonLapshin/ape-kingdom"), { owner: "AntonLapshin", repo: "ape-kingdom" });
	assert.deepEqual(parseRepoRef("https://github.com/AntonLapshin/ape-kingdom.git"), { owner: "AntonLapshin", repo: "ape-kingdom" });
	assert.deepEqual(parseRepoRef("https://github.com/AntonLapshin/ape-kingdom/tree/main"), { owner: "AntonLapshin", repo: "ape-kingdom" });
	assert.deepEqual(parseRepoRef("git@github.com:AntonLapshin/ape-kingdom.git"), { owner: "AntonLapshin", repo: "ape-kingdom" });
	assert.deepEqual(parseRepoRef("ssh://git@github.com/AntonLapshin/ape-kingdom.git"), { owner: "AntonLapshin", repo: "ape-kingdom" });
	assert.deepEqual(parseRepoRef("AntonLapshin/ape-kingdom"), { owner: "AntonLapshin", repo: "ape-kingdom" });
	assert.deepEqual(parseRepoRef("AntonLapshin/ape-kingdom.git"), { owner: "AntonLapshin", repo: "ape-kingdom" });
});

test("parseRepoRef: returns null for invalid references", () => {
	assert.equal(parseRepoRef(""), null);
	assert.equal(parseRepoRef("   "), null);
	assert.equal(parseRepoRef("https://github.com/only-owner"), null);
	assert.equal(parseRepoRef("not-a-ref"), null);
});

// --- workspaceFor / ensureInitiationState ---

test("workspaceFor matches the seed layout so switch/loop helpers recognize pulled projects", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-pi-pull-ws-"));
	try {
		const owner = "octo";
		const repo = "notes-app";
		const workspacesDir = join(root, "workspaces");
		const ws = workspaceFor(owner, repo, workspacesDir);
		assert.equal(ws, join(workspacesDir, owner, repo, "repo"));

		// Build the pulled workspace (clone + committed config + recreated
		// initiation marker) and confirm listProjects/resolveProject see it.
		await mkdir(join(ws, ".pi", "state"), { recursive: true });
		await writeFile(join(ws, ".pi", "config.json"), JSON.stringify(projectConfig({ owner, repo, name: "Notes App" }), null, 2) + "\n", "utf8");
		const cfg = JSON.parse(await readFile(join(ws, ".pi", "config.json"), "utf8"));
		const res = await ensureInitiationState(ws, cfg);
		assert.equal(res.ok, true);
		assert.equal(res.created, true);

		// The loop-recognition helpers now see it as a locally-seeded project.
		const projects = await listProjects(workspacesDir);
		assert.equal(projects.length, 1);
		assert.equal(projects[0].repo, "octo/notes-app");
		assert.equal(projects[0].projectName, "Notes App");

		const resolved = await resolveProject("notes-app", workspacesDir);
		assert.ok(resolved);
		assert.equal(resolved.repo, "octo/notes-app");
		assert.equal(resolved.workspace, ws);
	} finally {
		await execa("rm", ["-rf", root], { reject: false });
	}
});

test("ensureInitiationState preserves an existing marker and is idempotent", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-pi-pull-init-"));
	try {
		const ws = join(root, "ws");
		const cfg = projectConfig({ owner: "octo", repo: "app", name: "App" });

		// First call creates it.
		const first = await ensureInitiationState(ws, cfg);
		assert.equal(first.ok, true);
		assert.equal(first.created, true);
		const raw1 = await readFile(join(ws, ".pi", "state", "initiation.json"), "utf8");
		const init1 = JSON.parse(raw1);
		assert.equal(init1.projectName, "App");
		assert.equal(init1.repo.fullName, "octo/app");

		// Second call is a no-op (preserves the existing marker).
		const second = await ensureInitiationState(ws, cfg);
		assert.equal(second.ok, true);
		assert.equal(second.created, false);
		const raw2 = await readFile(join(ws, ".pi", "state", "initiation.json"), "utf8");
		assert.equal(raw1, raw2, "existing initiation.json is not overwritten");
	} finally {
		await execa("rm", ["-rf", root], { reject: false });
	}
});

// --- runPull happy path (hermetic: injected repoInfo + local bare remote) ---

/** Create a local bare remote that mimics a GitHub repo with a committed .pi/config.json. */
async function makeRemoteRepo(root, owner, repo, projectName) {
	const bare = join(root, `${owner}-${repo}.git`);
	await execa("git", ["init", "--bare", bare], { reject: false });

	const work = join(root, "seed-work");
	await mkdir(join(work, ".pi"), { recursive: true });
	await writeFile(join(work, ".pi", "config.json"), JSON.stringify(projectConfig({ owner, repo, name: projectName }), null, 2) + "\n", "utf8");
	await writeFile(join(work, "README.md"), `# ${projectName}\n`, "utf8");
	await execa("git", ["init", "-b", "main"], { cwd: work, reject: false });
	await execa("git", ["add", "-A"], { cwd: work, reject: false });
	await execa("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "initial"], { cwd: work, reject: false });
	await execa("git", ["remote", "add", "origin", bare], { cwd: work, reject: false });
	await execa("git", ["push", "-u", "origin", "main"], { cwd: work, reject: false });
	// Point the bare repo's HEAD at main so a fresh clone checks out the working
	// tree (a bare repo's default HEAD points at master, which doesn't exist).
	await execa("git", ["--git-dir", bare, "symbolic-ref", "HEAD", "refs/heads/main"], { reject: false });
	return bare;
}

test("runPull: clones, configures, records active, and is switchable (startLoop disabled)", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-pi-pull-full-"));
	try {
		const owner = "octo";
		const repo = "ape-kingdom";
		const bare = await makeRemoteRepo(root, owner, repo, "Ape Kingdom");

		const workspacesDir = join(root, "workspaces");
		const currentProjectFile = join(root, "current-project.json");

		const notifications = [];
		const io = { notify: (t) => notifications.push(t) };

		const result = await runPull("octo/ape-kingdom", io, {
			workspacesDir,
			currentProjectFile,
			startLoop: false,
			repoInfo: async () => ({ exists: true, visibility: "public" }),
			cloneUrl: bare, // clone from the local bare remote instead of GitHub
		});

		assert.equal(result.ok, true, result.message);
		assert.equal(result.repo, "octo/ape-kingdom");
		const ws = result.workspace;
		assert.equal(ws, join(workspacesDir, owner, repo, "repo"));

		// The repo was cloned.
		const cfg = JSON.parse(await readFile(join(ws, ".pi", "config.json"), "utf8"));
		assert.equal(cfg.project.repo, "ape-kingdom");

		// The git-ignored initiation marker was recreated.
		const init = JSON.parse(await readFile(join(ws, ".pi", "state", "initiation.json"), "utf8"));
		assert.equal(init.projectName, "Ape Kingdom");
		assert.equal(init.repo.fullName, "octo/ape-kingdom");
		assert.equal(init.manifest.source, "pulled");

		// The active-project record points at the pulled project.
		const activeRes = await readActiveProject(currentProjectFile);
		assert.equal(activeRes.ok, true);
		assert.equal(activeRes.active.repo, "octo/ape-kingdom");
		assert.equal(activeRes.active.workspace, ws);

		// The loop-recognition helpers see it as a locally-seeded project, so
		// /loop-switch can target it.
		const projects = await listProjects(workspacesDir);
		assert.ok(projects.some((p) => p.repo === "octo/ape-kingdom" && p.projectName === "Ape Kingdom"));
		const resolved = await resolveProject("ape-kingdom", workspacesDir);
		assert.ok(resolved);
		assert.equal(resolved.workspace, ws);
	} finally {
		await execa("rm", ["-rf", root], { reject: false });
	}
});

test("runPull: fails cleanly when the repo does not exist", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-pi-pull-missing-"));
	try {
		const result = await runPull("octo/nope", { notify: () => {} }, {
			workspacesDir: join(root, "workspaces"),
			currentProjectFile: join(root, "current-project.json"),
			startLoop: false,
			repoInfo: async () => ({ exists: false, error: "not found" }),
		});
		assert.equal(result.ok, false);
		assert.match(result.message, /not found/);
	} finally {
		await execa("rm", ["-rf", root], { reject: false });
	}
});

test("runPull: fails cleanly when the repo is not an auto-pi project (no .pi/config.json)", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-pi-pull-notapi-"));
	try {
		const owner = "octo";
		const repo = "plain";
		// A repo with no .pi/config.json.
		const bare = join(root, `${owner}-${repo}.git`);
		await execa("git", ["init", "--bare", bare], { reject: false });
		const work = join(root, "w");
		await mkdir(work, { recursive: true });
		await writeFile(join(work, "README.md"), "# plain\n", "utf8");
		await execa("git", ["init", "-b", "main"], { cwd: work, reject: false });
		await execa("git", ["add", "-A"], { cwd: work, reject: false });
		await execa("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "i"], { cwd: work, reject: false });
		await execa("git", ["remote", "add", "origin", bare], { cwd: work, reject: false });
		await execa("git", ["push", "-u", "origin", "main"], { cwd: work, reject: false });
		await execa("git", ["--git-dir", bare, "symbolic-ref", "HEAD", "refs/heads/main"], { reject: false });

		const result = await runPull("octo/plain", { notify: () => {} }, {
			workspacesDir: join(root, "workspaces"),
			currentProjectFile: join(root, "current-project.json"),
			startLoop: false,
			repoInfo: async () => ({ exists: true, visibility: "public" }),
			cloneUrl: bare,
		});
		assert.equal(result.ok, false);
		assert.match(result.message, /does not look like an auto-pi project/);
	} finally {
		await execa("rm", ["-rf", root], { reject: false });
	}
});

test("runPull: rejects an unparseable reference with a usage hint", async () => {
	const result = await runPull("not-a-ref", { notify: () => {} }, {
		startLoop: false,
		repoInfo: async () => ({ exists: true }),
	});
	assert.equal(result.ok, false);
	assert.match(result.message, /Usage: \/loop-pull/);
});
