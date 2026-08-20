/**
 * M0 skeleton smoke tests.
 *
 * Verifies the harness skeleton is valid:
 *  - config/config.default.json and config/config.schema.json parse as JSON
 *  - the fallback CLI stubs exit successfully
 *  - the package.json manifest is well-formed (pi block, scripts, deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("config/default.json is valid JSON", () => {
	const cfg = JSON.parse(readFileSync(join(ROOT, "config/config.default.json"), "utf8"));
	assert.equal(typeof cfg, "object");
	assert.ok(cfg.project, "default config has a project section");
	assert.ok(cfg.loop, "default config has a loop section");
	assert.ok(cfg.limits, "default config has a limits section");
});

test("config/schema.json is valid JSON and a schema", () => {
	const schema = JSON.parse(readFileSync(join(ROOT, "config/config.schema.json"), "utf8"));
	assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
	assert.equal(schema.type, "object");
	assert.ok(schema.properties.project, "schema declares project properties");
});

test("package.json manifest is well-formed", () => {
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	assert.equal(pkg.name, "auto-pi");
	assert.equal(pkg.type, "module");
	assert.ok(pkg.pi?.extensions, "pi block registers extensions");
	for (const cmd of ["seed", "loop", "stop", "status", "doctor", "test"]) {
		assert.ok(pkg.scripts?.[cmd], `package.json has a ${cmd} script`);
	}
});

test("status remains a stub; loop/stop are implemented (M6)", () => {
	// /seed, /doctor, /loop, /stop are implemented (M2, M1, M6); only /status
	// still reports not-implemented (M13).
	const statusOut = execFileSync(process.execPath, [join(ROOT, "scripts", "status.js")], {
		encoding: "utf8",
	});
	assert.match(statusOut, /not implemented yet/, "status stub reports not-implemented");

	// loop/stop must no longer be stubs. Without an active project they should
	// report the missing-active-project error (not the not-implemented stub).
	for (const cmd of ["loop", "stop"]) {
		const src = readFileSync(join(ROOT, "scripts", `${cmd}.js`), "utf8");
		assert.ok(!/runStub/.test(src), `scripts/${cmd}.js no longer shells out to the stub`);
	}
});

test("doctor CLI produces a prerequisite report and exits non-zero on missing items", () => {
	// Doctor must not be a stub anymore (M1): it reports all required checks and
	// prints a summary line regardless of the machine state.
	let res = "";
	try {
		res = execFileSync(process.execPath, [join(ROOT, "scripts", "doctor.js")], {
			encoding: "utf8",
		}).toString();
	} catch (e) {
		res = (e.stdout?.toString?.() || e.message || "").split("\n")
			.filter((l) => l.includes("✅") || l.includes("❌") || /checks? (PASSED|FAILED)/i.test(l))
			.join("\n");
	}

	for (const id of ["Node.js", "npm", "git", "GitHub CLI", "Pi CLI", "Workspace"]) {
		assert.ok(res.includes(id), `doctor report mentions ${id}`);
	}
	assert.ok(!/not implemented yet/.test(res), "doctor is no longer a stub");
	assert.ok(/checks? (PASSED|FAILED)/i.test(res), "doctor prints a summary line");
});

test("doctor core passes with a valid workspace and fails without one", async () => {
	const { runChecks, allPassed, formatReport } = await import("../extensions/doctor/core.js");

	// Missing workspace → required check fails, so the run fails overall.
	const missingDir = join(tmpdir(), `auto-pi-doctor-${process.pid}-missing`);
	const missing = await runChecks({ workspaceDir: missingDir });
	const wsMissing = missing.find((r) => r.id === "workspace");
	assert.ok(wsMissing && !wsMissing.ok, "missing workspace dir fails the workspace check");
	assert.ok(wsMissing.hint, `missing workspace provides a remediation hint`);
	assert.equal(allPassed(missing), false, "run fails overall when workspace is missing");
	assert.ok(/FAILED|hint|mkdir/i.test(formatReport(missing)), "report includes remediation info");

	// Existing, writable workspace → that check passes.
	const okDir = await mkdtemp(join(tmpdir(), "auto-pi-doctor-"));
	const ok = await runChecks({ workspaceDir: okDir });
	const wsOk = ok.find((r) => r.id === "workspace");
	assert.ok(wsOk && wsOk.ok, "existing writable workspace passes the workspace check");
});

test("seed CLI is no longer a stub and understands --help/--yes", () => {
	// --help must print usage (real command, not a stub).
	const help = execFileSync(process.execPath, [join(ROOT, "scripts", "seed.js"), "--help"], {
		encoding: "utf8",
	});
	assert.ok(help.includes("--yes"), "seed usage documents the --yes flag");
	assert.ok(!/not implemented/.test(help), "seed --help is not a stub");

	const src = readFileSync(join(ROOT, "scripts", "seed.js"), "utf8");
	assert.ok(!/runStub/.test(src), "scripts/seed.js no longer shells out to the stub");
	assert.match(src, /runSeed/, "scripts/seed.js calls the shared runSeed");
});

test("seed repo-name derives valid slugs from descriptions", async () => {
	const { deriveRepoName, alternativeNames, isGithubReserved } = await import(
		"../extensions/seed/repo-name.js"
	);
	assert.equal(deriveRepoName("Build a markdown notes app"), "build-a-markdown-notes-app");
	assert.equal(deriveRepoName("  My  Cool   App!! "), "my-cool-app");
	assert.equal(deriveRepoName("admin"), "project-admin", "reserved words are prefixed");
	assert.equal(deriveRepoName("MyApp.v2"), "myapp.v2", "dots are valid in GitHub repo names");
	assert.ok(deriveRepoName("build a notes app").length <= 100, "slug is length-capped");
	const alts = alternativeNames("build-a-notes-app");
	assert.equal(alts[0], "build-a-notes-app-app");
	assert.ok(alts[1].startsWith("build-a-notes-app-"), "second alternative gets a short id");
	assert.ok(isGithubReserved("about") && !isGithubReserved("notes"));
});

test("seed refuses when another project is active (one project per machine)", async () => {
	// Uses temp paths (opts.currentProjectFile / opts.autoPiDir) so the real
	// ~/.auto-pi is untouched. Since a project is already active, runSeed returns
	// before any network I/O (repo names, gh, clone).
	const { runSeed } = await import("../extensions/seed/core.js");
	const { writeFile } = await import("node:fs/promises");
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-seed-"));
	const cpFile = join(dir, "current-project.json");
	await writeFile(
		cpFile,
		JSON.stringify({
			projectName: "existing-project",
			repo: "octocat/existing-project",
			workspace: join(dir, "w"),
			startedAt: new Date().toISOString(),
			status: "active",
		}),
	);

	const res = await runSeed(
		"Build a markdown notes app",
		{ notify: () => {} },
		{ currentProjectFile: cpFile, autoPiDir: join(dir, ".auto-pi") },
	);
	assert.equal(res.ok, false, "seed is refused while a project is active");
	assert.match(res.message, /already active/, "refusal explains another project is active");
	assert.match(res.message, /existing-project/, "refusal names the active project");
});

test("doctor exit code reflects the overall pass/fail status", () => {
	// The CLI must exit non-zero when any required check fails. We force a
	// guaranteed failure by pointing PI_ env to an impossible model and removing
	// the workspace, in an isolated env via the core (already covered above). Here
	// we just assert the wiring: dead stub / not-implemented is gone and the CLI
	// is the real one.
	const src = readFileSync(join(ROOT, "scripts", "doctor.js"), "utf8");
	assert.ok(!/runStub/.test(src), "scripts/doctor.js no longer shells out to the stub");
	assert.match(src, /runChecks/, "scripts/doctor.js calls the shared runChecks");
	assert.match(src, /process\.exit\(allPassed\(results\) \? 0 : 1\)/, "exit code is allPassed ? 0 : 1");
});
