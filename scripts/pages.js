#!/usr/bin/env node
/**
 * Fallback CLI for the auto-pi GitHub Pages deployment health check (M4).
 *
 * Reads the latest run status of the Pages deploy workflow for the active
 * project and, when it failed, surfaces a `pi:needs-human` + `pi:blocked` +
 * `type:infra` issue instead of retrying forever.
 *
 *   npm run pages            # check the active project's Pages deployment
 *   npm run pages -- --repo owner/name   # check a specific repo
 *   npm run pages -- --dry-run           # report without creating/editing issues
 *
 * Exit codes: 0 = healthy (or completed), 1 = deployment failed, 2 = error.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import {
	checkDeploymentStatus,
	createOrUpdateNeedsHumanIssue,
	handlePagesDeployment,
} from "../extensions/seed/deploy.js";

const CURRENT_PROJECT_FILE = join(homedir(), ".auto-pi", "current-project.json");

async function gh(args, opts = {}) {
	try {
		const res = await execa("gh", args, { reject: false, timeout: 30000, ...opts });
		return { ok: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
	} catch (err) {
		return { ok: false, stdout: "", stderr: String(err?.message || err), exitCode: 1 };
	}
}

async function activeRepo() {
	try {
		const raw = await readFile(CURRENT_PROJECT_FILE, "utf8");
		const data = JSON.parse(raw);
		if (data && data.repo && data.repo.includes("/")) return data.repo;
	} catch {
		/* fall through */
	}
	return null;
}

function usage() {
	return [
		"auto-pi pages — check / handle GitHub Pages deployment health",
		"",
		"Usage:",
		"  npm run pages [--repo owner/name] [--dry-run]",
		"",
		"Flags:",
		"  --repo owner/name   repo to check (defaults to the active project)",
		"  --dry-run           report the state without creating/updating issues",
		"  --help              show this help",
		"",
		"Exit codes: 0 healthy, 1 deployment failed, 2 error.",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(0);
	}
	const dryRun = argv.includes("--dry-run");
	const repoArg = argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length)
		|| argv[argv.indexOf("--repo") + 1];

	let repo = repoArg;
	if (!repo) {
		repo = await activeRepo();
		if (!repo) {
			process.stderr.write("[auto-pi pages] no active project found and no --repo given\n");
			process.exit(2);
		}
	}
	const [owner, name] = repo.split("/");
	if (!owner || !name) {
		process.stderr.write(`[auto-pi pages] invalid repo: ${repo}\n`);
		process.exit(2);
	}

	const status = await checkDeploymentStatus(owner, name, gh);
	if (!status.ok) {
		process.stderr.write(`[auto-pi pages] ${status.error}\n`);
		process.exit(2);
	}
	process.stdout.write(`[auto-pi pages] ${owner}/${name}: state=${status.state}\n`);

	if (status.state !== "failed") {
		process.exit(0);
	}

	if (dryRun) {
		process.stdout.write(
			`[auto-pi pages] deployment failed; would create a pi:needs-human issue (dry-run)\n`,
		);
		process.exit(1);
	}

	const result = await createOrUpdateNeedsHumanIssue(owner, name, gh, { run: status.run });
	if (!result.ok) {
		process.stderr.write(`[auto-pi pages] failed to create needs-human issue: ${result.error}\n`);
		process.exit(2);
	}
	process.stdout.write(
		`[auto-pi pages] ${result.created ? "created" : "updated"} needs-human issue ` +
			`(number ${result.issue?.number || "?"}) for Pages deployment failure\n`,
	);
	process.exit(1);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi pages] error: ${err?.stack || err}\n`);
	process.exit(2);
});
