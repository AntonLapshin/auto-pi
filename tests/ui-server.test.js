/**
 * UI server bind-address tests.
 *
 * Regression: `ui/server/server.js` documented `--port` but ignored it, and
 * always bound localhost-only with no way to expose the ESP32
 * `GET /api/esp-status` endpoint on the LAN. `parseUiBind()` is the contract
 * for `--port/--host` + `AUTOPI_UI_PORT/AUTOPI_UI_HOST` resolution.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUiBind } from "../ui/server/server.js";

test("parseUiBind defaults to 127.0.0.1:8787", () => {
	assert.deepEqual(parseUiBind([], {}), { port: 8787, host: "127.0.0.1" });
});

test("parseUiBind honors --port and --host flags", () => {
	assert.deepEqual(parseUiBind(["--port", "9000"], {}), { port: 9000, host: "127.0.0.1" });
	assert.deepEqual(parseUiBind(["--port=9001"], {}), { port: 9001, host: "127.0.0.1" });
	assert.deepEqual(parseUiBind(["--host", "0.0.0.0"], {}), { port: 8787, host: "0.0.0.0" });
	assert.deepEqual(parseUiBind(["--host=0.0.0.0", "--port", "80"], {}), { port: 80, host: "0.0.0.0" });
});

test("parseUiBind honors AUTOPI_UI_* env, flags win", () => {
	assert.deepEqual(parseUiBind([], { AUTOPI_UI_PORT: "9002", AUTOPI_UI_HOST: "0.0.0.0" }), {
		port: 9002,
		host: "0.0.0.0",
	});
	assert.deepEqual(parseUiBind(["--port", "9003"], { AUTOPI_UI_PORT: "9002" }), {
		port: 9003,
		host: "127.0.0.1",
	});
});

test("parseUiBind ignores invalid ports", () => {
	assert.deepEqual(parseUiBind(["--port", "nope"], {}), { port: 8787, host: "127.0.0.1" });
});
