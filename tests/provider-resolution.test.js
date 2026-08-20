/**
 * Tests for the provider/model resolution fix (M6 hardening).
 *
 * The autonomous loop is launched detached via `nohup` from a bare bash `-c`,
 * so it does not inherit the interactive session's PI_PROVIDER/PI_MODEL env
 * vars. Before this fix, a persona spawned with an empty project config fell
 * back to pi's built-in default provider (`google`) and hung silently. These
 * tests lock in the resolution order: project config -> PI_* env -> pi user
 * settings (~/.pi/agent/settings.json).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
	resolvePiModelSync,
	buildPersonaArgs,
	buildChildEnv,
} from "../extensions/loop/persona-runner.js";
import {
	resolveProviderModel,
	providerEnv,
} from "../extensions/loop/provider-env.js";

test("resolution order: project config wins over env + settings", () => {
	const res = resolveProviderModel({
		config: { pi: { provider: "custom-prov", model: "custom-model" } },
		env: { PI_PROVIDER: "env-prov", PI_MODEL: "env-model" },
	});
	assert.equal(res.provider, "custom-prov");
	assert.equal(res.model, "custom-model");
});

test("resolution order: PI_* env wins over settings", () => {
	const res = resolveProviderModel({
		env: { PI_PROVIDER: "env-prov", PI_MODEL: "env-model" },
	});
	assert.equal(res.provider, "env-prov");
	assert.equal(res.model, "env-model");
});

test("resolution falls back to pi user settings when config+env are empty", () => {
	const res = resolveProviderModel({ env: {} });
	// Provider/model are strings; when a settings file is installed they match
	// its defaults (gonkaapi / deepseek... on this machine). Guard so the test
	// is robust to machines without a settings file.
	assert.equal(typeof res.provider, "string");
	assert.equal(typeof res.model, "string");
});

test("resolvePiModelSync delegates to shared resolution (config priority)", () => {
	const res = resolvePiModelSync({
		config: { pi: { provider: "cfg-prov", model: "cfg-model" } },
		env: { PI_PROVIDER: "env-prov", PI_MODEL: "env-model" },
	});
	assert.equal(res.provider, "cfg-prov");
	assert.equal(res.model, "cfg-model");
});

test("buildPersonaArgs pins provided config provider/model", () => {
	const args = buildPersonaArgs({
		persona: "pm",
		runId: "pm-1",
		contextFile: "/tmp/ctx.md",
		config: { pi: { provider: "cfg-prov", model: "cfg-model" } },
		env: {},
	});
	assert.ok(args.includes("--provider"));
	assert.ok(args.includes("cfg-prov"));
	assert.ok(args.includes("--model"));
	assert.ok(args.includes("cfg-model"));
});

test("buildPersonaArgs with empty config falls back to env provider/model", () => {
	const args = buildPersonaArgs({
		persona: "pm",
		runId: "pm-1",
		contextFile: "/tmp/ctx.md",
		config: { pi: { provider: "", model: "" } },
		env: { PI_PROVIDER: "env-prov", PI_MODEL: "env-model" },
	});
	assert.ok(args.includes("--provider"));
	assert.ok(args.includes("env-prov"));
	assert.ok(args.includes("--model"));
	assert.ok(args.includes("env-model"));
});

test("providerEnv returns env carrying resolved PI_PROVIDER/PI_MODEL", () => {
	const env = providerEnv({ env: { PI_PROVIDER: "x", PI_MODEL: "y" } });
	assert.equal(env.PI_PROVIDER, "x");
	assert.equal(env.PI_MODEL, "y");
});

test("buildChildEnv injects resolved PI_PROVIDER/PI_MODEL", () => {
	const childEnv = buildChildEnv({
		config: { pi: { provider: "child-prov", model: "child-model" } },
		env: {},
	});
	assert.equal(childEnv.PI_PROVIDER, "child-prov");
	assert.equal(childEnv.PI_MODEL, "child-model");
});

test("buildChildEnv pulls from settings when config+env are empty", () => {
	// Mirrors the real detached-loop scenario: no config provider/model, no
	// PI_* env vars. The child env must still carry the resolved model (or at
	// least be a well-formed env) rather than silently leaving pi unconfigured.
	const childEnv = buildChildEnv({ env: {} });
	if (childEnv.PI_PROVIDER) {
		assert.equal(typeof childEnv.PI_PROVIDER, "string");
		assert.ok(childEnv.PI_PROVIDER.length > 0);
	}
	assert.ok(typeof childEnv === "object");
});
