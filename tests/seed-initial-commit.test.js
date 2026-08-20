/**
 * Tests for the initial-commit-and-push step added to `/loop-seed`.
 *
 * Before this step, the freshly-scaffolded repo's content sat as uncommitted
 * working-tree changes while `origin` only held GitHub's auto README commit, so
 * CI / GitHub Pages had nothing to run. These tests exercise
 * `commitAndPushInitial` against a real local git repo/bare remote.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import { commitAndPushInitial } from "../extensions/seed/core.js";

const DEFAULT_BRANCH = "main";

/** Create a bare remote + a working clone so tests are self-contained. */
async function makeRepos() {
	const root = await mkdtemp(join(tmpdir(), "auto-pi-init-commit-"));
	const bare = join(root, "origin.git");
	const work = join(root, "work");

	await execa("git", ["init", "--bare", bare], { reject: false });
	await mkdir(work, { recursive: true });
	await execa("git", ["init", "-b", DEFAULT_BRANCH], { cwd: work, reject: false });
	// Commit an initial README so the remote/work commit history mirrors the
	// `gh repo create --add-readme` case (an existing HEAD to push on top of).
	await writeFile(join(work, "README.md"), "# My Repo\n", "utf8");
	await execa("git", ["add", "README.md"], { cwd: work, reject: false });
	await execa("git", ["commit", "-m", "Initial commit"], { cwd: work, reject: false });
	await execa("git", ["remote", "add", "origin", bare], { cwd: work, reject: false });

	return { root, bare, work };
}

async function git(work, args) {
	const res = await execa("git", args, { cwd: work, reject: false });
	return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
}

test("commitInitial:false disables the initial commit+push", async () => {
	const { root, work } = await makeRepos();
	try {
		await writeFile(join(work, "package.json"), "{}", "utf8");
		const res = await commitAndPushInitial(work, "a/b", DEFAULT_BRANCH, {
			commitInitial: false,
		});
		assert.equal(res.ok, true);
		assert.equal(res.committed, false);
	} finally {
		await execa("rm", ["-rf", root], { reject: false });
	}
});

test("commits and pushes the scaffold to origin", async () => {
	const { root, bare, work } = await makeRepos();
	try {
		// Simulate the scaffold: several new files + a modified README.
		await writeFile(join(work, "package.json"), "{}\n", "utf8");
		await mkdir(join(work, "src"), { recursive: true });
		await writeFile(join(work, "src", "index.ts"), "export const x = 1;\n", "utf8");
		await writeFile(join(work, "README.md"), "# New scaffold content\n", "utf8");

		const res = await commitAndPushInitial(work, "a/b", DEFAULT_BRANCH, {});
		assert.equal(res.ok, true);
		assert.equal(res.committed, true);
		assert.ok(res.sha && res.sha.length >= 4, "short sha returned");

		// The commit must exist locally on the default branch...
		const log = await git(work, ["log", "-1", "--format=%s"]);
		assert.match(log.stdout, /Initial scaffold/);

		// ...and be pushed to the bare remote (check the main ref, since a bare
		// repo's default HEAD may still point at refs/heads/master).
		const bareLog = await execa(
			"git",
			["--git-dir=" + bare, "log", "-1", "--format=%s", "refs/heads/main"],
			{ reject: false },
		);
		assert.match(bareLog.stdout, /Initial scaffold/);
	} finally {
		await execa("rm", ["-rf", root], { reject: false });
	}
});

test("idempotent when the scaffold is already committed/pushed", async () => {
	const { root, work } = await makeRepos();
	try {
		await writeFile(join(work, "package.json"), "{}\n", "utf8");
		await commitAndPushInitial(work, "a/b", DEFAULT_BRANCH, {}).then((r) => {
			assert.equal(r.ok, true);
			assert.equal(r.committed, true);
		});
		// Second call: nothing staged -> no new commit.
		const res = await commitAndPushInitial(work, "a/b", DEFAULT_BRANCH, {});
		assert.equal(res.ok, true);
		assert.equal(res.committed, false);
	} finally {
		await execa("rm", ["-rf", root], { reject: false });
	}
});

test("does not stage git-ignored auto-pi runtime dirs", async () => {
	const { root, work } = await makeRepos();
	try {
		// Write a .gitignore that excludes the runtime dirs (as the scaffold does).
		await writeFile(
			join(work, ".gitignore"),
			".pi/local.json\n.pi/logs/\n.pi/state/\n.pi/runs/\n",
			"utf8",
		);
		await writeFile(join(work, "app.txt"), "app\n", "utf8");
		await mkdir(join(work, ".pi", "state"), { recursive: true });
		await writeFile(join(work, ".pi", "state", "initiation.json"), "{}\n", "utf8");

		const res = await commitAndPushInitial(work, "a/b", DEFAULT_BRANCH, {});
		assert.equal(res.ok, true);
		assert.equal(res.committed, true);

		// The ignored runtime file must NOT be in the committed tree.
		const listed = await git(work, ["ls-files"]);
		assert.match(listed.stdout, /app\.txt/);
		assert.doesNotMatch(listed.stdout, /\.pi\/state\/initiation\.json/);
	} finally {
		await execa("rm", ["-rf", root], { reject: false });
	}
});
