/**
 * M5 project config copy tests.
 *
 * Verifies that `extensions/seed/config.js` copies `config.default.json` into
 * `{project}/.pi/config.json` with project-specific values filled in, and that
 * it generates the git-ignored local-secrets scaffold (`.pi/local.example.json`
 * documenting the Telegram env-var pattern, plus `.pi/config.schema.json`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadDefaultConfig,
	buildProjectConfig,
	localExample,
	writeProjectConfig,
	DEFAULT_CONFIG_FILE,
} from "../extensions/seed/config.js";

const DEFAULTS = {
	project: {
		name: "",
		repo: "",
		owner: "",
		ownerEmail: "",
		defaultBranch: "main",
		demoUrl: "",
	},
	pi: { model: "", provider: "", contextMaxTokens: 150000 },
	loop: { intervalSeconds: 60 },
	limits: { maxBatchIssues: 3 },
	github: { autoCreateRepo: true, repoVisibility: "public" },
	stack: { framework: "react", typescript: true, tailwind: true, testRunner: "vitest" },
	quality: { coreCoveragePercent: 100 },
	pages: { enabled: true, deployBranch: "gh-pages" },
	notifications: { telegram: { enabled: false } },
	logging: { maxFileSizeMb: 10, rotate: true },
};

test("loadDefaultConfig reads and parses config/config.default.json", async () => {
	const cfg = await loadDefaultConfig();
	assert.equal(typeof cfg, "object");
	assert.ok(cfg.project, "default config has a project section");
	assert.ok(cfg.loop, "default config has a loop section");
	assert.ok(cfg.limits, "default config has a limits section");
	assert.ok(cfg.notifications?.telegram, "default config has notifications.telegram");
});

test("buildProjectConfig fills the project section and preserves defaults", () => {
	const cfg = buildProjectConfig({
		defaults: DEFAULTS,
		projectName: "Build A Notes App",
		repo: "build-a-notes-app",
		owner: "octocat",
		ownerEmail: "octocat@example.com",
		demoUrl: "https://octocat.github.io/build-a-notes-app/",
		defaultBranch: "main",
	});

	// Project-specific values are filled.
	assert.equal(cfg.project.name, "Build A Notes App");
	assert.equal(cfg.project.repo, "build-a-notes-app");
	assert.equal(cfg.project.owner, "octocat");
	assert.equal(cfg.project.ownerEmail, "octocat@example.com");
	assert.equal(cfg.project.demoUrl, "https://octocat.github.io/build-a-notes-app/");
	assert.equal(cfg.project.defaultBranch, "main");

	// Other sections are carried over unchanged.
	assert.equal(cfg.loop.intervalSeconds, 60);
	assert.equal(cfg.github.repoVisibility, "public");
	assert.equal(cfg.notifications.telegram.enabled, false);
	assert.equal(cfg.stack.framework, "react");

	// The input defaults object is not mutated.
	assert.equal(DEFAULTS.project.name, "");
});

test("buildProjectConfig falls back to defaults for empty optional values", () => {
	const cfg = buildProjectConfig({
		defaults: DEFAULTS,
		projectName: "App",
		repo: "app",
		owner: "acme",
		// ownerEmail, demoUrl, defaultBranch omitted → defaults apply.
	});
	assert.equal(cfg.project.ownerEmail, "");
	assert.equal(cfg.project.defaultBranch, "main");
	assert.equal(cfg.project.demoUrl, "");
});

test("localExample documents the Telegram env-var pattern and no secrets", () => {
	const ex = localExample();
	assert.equal(ex.notifications.telegram.enabled, false);
	assert.equal(ex.notifications.telegram.botTokenEnv, "TELEGRAM_BOT_TOKEN");
	assert.equal(ex.notifications.telegram.chatIdEnv, "TELEGRAM_CHAT_ID");
	// The example itself must not contain real secret values.
	const raw = JSON.stringify(ex);
	assert.ok(!/sk-[A-Za-z0-9]/.test(raw), "no API-key-looking secrets in the example");
	assert.ok(!/^\d{8,}$/m.test(raw), "no chat-id-looking numbers in the example");
});

test("writeProjectConfig writes .pi/config.json, local.example.json, and schema reference", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-config-"));
	const res = await writeProjectConfig(dir, {
		projectName: "Build A Notes App",
		repo: "build-a-notes-app",
		owner: "octocat",
		demoUrl: "https://octocat.github.io/build-a-notes-app/",
		defaultBranch: "main",
	});

	assert.equal(res.ok, true, `write ok (errors: ${res.errors.join("; ")})`);
	assert.deepEqual(res.errors, []);

	// All three files exist.
	for (const rel of [".pi/config.json", ".pi/local.example.json", ".pi/config.schema.json"]) {
		await access(join(dir, rel));
	}

	// config.json has the project-specific values.
	const cfg = JSON.parse(await readFile(join(dir, ".pi/config.json"), "utf8"));
	assert.equal(cfg.project.name, "Build A Notes App");
	assert.equal(cfg.project.repo, "build-a-notes-app");
	assert.equal(cfg.project.owner, "octocat");
	assert.equal(cfg.project.demoUrl, "https://octocat.github.io/build-a-notes-app/");
	assert.equal(cfg.project.defaultBranch, "main");
	assert.ok(cfg.loop && cfg.limits && cfg.notifications, "full default schema is copied");

	// local.example.json documents the Telegram env-var pattern.
	const localEx = JSON.parse(await readFile(join(dir, ".pi/local.example.json"), "utf8"));
	assert.equal(localEx.notifications.telegram.botTokenEnv, "TELEGRAM_BOT_TOKEN");
	assert.equal(localEx.notifications.telegram.chatIdEnv, "TELEGRAM_CHAT_ID");

	// config.schema.json is a JSON-Schema reference.
	const schemaRef = JSON.parse(await readFile(join(dir, ".pi/config.schema.json"), "utf8"));
	assert.equal(schemaRef.$schema, "http://json-schema.org/draft-07/schema#");
	assert.match(schemaRef.$ref, /config\.schema\.json/);
});

test("writeProjectConfig reports errors when the default config is missing", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-config-"));
	const res = await writeProjectConfig(
		dir,
		{ projectName: "App", repo: "app", owner: "acme" },
		{ configFile: join(dir, "does-not-exist.json") },
	);
	assert.equal(res.ok, false);
	assert.ok(res.errors.length > 0);
});

test("DEFAULT_CONFIG_FILE points at the harness config directory", () => {
	assert.match(DEFAULT_CONFIG_FILE, /config\.default\.json$/);
});
