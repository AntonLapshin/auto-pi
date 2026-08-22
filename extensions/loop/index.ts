/**
 * The auto-pi `/loop`, `/loop-stop`, `/loop-restart`, and `/loop-switch` commands (M6).
 *
 * `/loop` starts the autonomous loop for the active project (or reports that a
 * loop is already running). `/loop-stop` pauses it by writing the stop file
 * (the active-project record is preserved, so it can be resumed/restarted).
 * `/loop-restart` safely restarts it: stop the running loop (waiting for it to
 * exit cleanly), then start it again. `/loop-switch` moves the active project
 * to another locally-seeded project: it stops the current loop, points the
 * active-project record at the target, and starts its loop.
 *
 * All reuse the shared core in `extensions/loop/orchestrator.js` (also used by
 * the `npm run loop` / `npm run stop` / `npm run restart` / `npm run switch`
 * fallback CLIs) so the interactive commands and the CLI behave identically.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
	runLoopCycle,
	readActiveProject,
	checkLock,
	writeStopFile,
	restartLoop,
	switchProject,
	listProjects,
} from "./orchestrator.js";
import {
	readConfiguredProviderModel,
	writeProviderModel,
} from "./provider-config.js";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("loop", {
		description:
			"Start (or report) the autonomous loop for the active project: scan GitHub, dispatch a persona, run a fresh session, repeat",
		handler: async (args, ctx) => {
			const notify = (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
				ctx.ui.notify(text, level);

			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				notify(activeRes.error, "error");
				return;
			}
			const workspace = activeRes.active.workspace;

			// Refuse to start a second loop for the same project (plan.md §13.2).
			const lock = await checkLock(workspace);
			if (lock.locked) {
				notify(
					`A loop is already running for this project (PID ${lock.pid}). Use /loop-stop to stop it.`,
					"warning",
				);
				return;
			}

			const arg = String(args ?? "").trim();
			if (arg === "--once" || arg === "once") {
				const result = await runLoopCycle(workspace, {
					log: (line) => process.stdout.write(`[loop] ${line}\n`),
				});
				notify(result.message, result.ok ? "success" : "error");
				return;
			}

			// Start the loop detached (nohup) so the interactive session is not
			// blocked, matching the `/loop-seed` launch pattern.
			const { execa } = await import("execa");
			try {
				// Launch the fallback CLI under nohup, capturing output to the loop log.
				// `setsid` puts the loop in its own session/process group with no
				// controlling terminal so spawned persona `pi` sessions never inherit the
				// interactive tty (which otherwise hangs them in batch mode). stdin is
				// redirected from /dev/null so the loop never reads the shared tty.
				const script = new URL("../../scripts/loop.js", import.meta.url).pathname;
				// Propagate the resolved provider/model into the detached loop process
				// (nohup does not inherit the interactive session's PI_* env vars).
				const { providerEnv } = await import("./provider-env.js");
				const logFile = join(workspace, ".pi", "logs", "loop.out");
				await execa("bash", ["-c", `setsid nohup node "${script}" </dev/null > "${logFile}" 2>&1 & echo $!`], {
					cwd: workspace,
					env: providerEnv(),
					reject: false,
				}).catch(() => {});
				notify(
					`Loop started for ${activeRes.active.repo || workspace} (detached). Check .pi/logs/loop.out.`,
					"success",
				);
			} catch (err) {
				notify(`Could not start the loop: ${err?.message || err}`, "error");
			}
		},
	});

	pi.registerCommand("loop-stop", {
		description: "Pause the autonomous loop for the active project (writes the stop file; the project stays active so it can be resumed/restarted)",
		handler: async (_args, ctx) => {
			const notify = (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
				ctx.ui.notify(text, level);

			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				notify(activeRes.error, "error");
				return;
			}
			const workspace = activeRes.active.workspace;
			const stopFile = await writeStopFile(workspace);
			notify(`Stop file written: ${stopFile}. The loop will exit at its next cycle.`);
			// Stopping only pauses the loop — the active-project record is preserved
			// so the same project can be resumed (/loop-resume) or restarted
			// (/loop-restart) anytime. Use /loop-switch to move to another project.
			notify(
				`Project "${activeRes.active.repo || activeRes.active.projectName || workspace}" remains active — resume with /loop-resume, restart with /loop-restart, or switch with /loop-switch.`,
			);
		},
	});

	pi.registerCommand("loop-switch", {
		description:
			"Switch the active project to another locally-seeded project (stops the current loop, points the active-project record at the target, starts its loop)",
		handler: async (args, ctx) => {
			const notify = (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
				ctx.ui.notify(text, level);

			const target = String(args ?? "").trim();

			// No target → list available projects and switch to the first (or ask).
			if (!target) {
				const projects = await listProjects();
				if (projects.length === 0) {
					notify("No local projects found. Use /loop-seed to create one.", "warning");
					return;
				}
				const labels = projects.map((p) => `${p.repo} — ${p.projectName}`);
				let pick = projects[0].repo;
				if (ctx.hasUI && ctx.ui.select) {
					const chosen = await ctx.ui.select("Switch to which project?", labels);
					const idx = chosen ? labels.indexOf(chosen) : -1;
					if (idx >= 0) pick = projects[idx].repo;
				}
				const result = await switchProject(pick, { notify });
				notify(result.message, result.ok ? "success" : "error");
				process.stdout.write(result.message + "\n");
				return;
			}

			const result = await switchProject(target, { notify });
			notify(result.message, result.ok ? "success" : "error");
			process.stdout.write(result.message + "\n");
		},
	});

	pi.registerCommand("loop-restart", {
		description:
			"Safely restart the autonomous loop for the active project: stop the running loop (let it finish its current cycle), then start it again",
		handler: async (args, ctx) => {
			const notify = (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
				ctx.ui.notify(text, level);

			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				notify(`${activeRes.error} Use /loop-seed to start a new project.`, "error");
				return;
			}
			const workspace = activeRes.active.workspace;

			// Optional: how long to wait for the running loop to exit cleanly
			// before aborting (default 60s, or a persona may still be finishing).
			const arg = String(args ?? "").trim();
			const timeoutMatch = /--timeout[= ](\d+)/i.exec(arg);
			const timeoutMs = timeoutMatch ? Number(timeoutMatch[1]) * 1000 : undefined;

			const result = await restartLoop(workspace, {
				timeoutMs,
				log: (line: string) => process.stdout.write(`[loop-restart] ${line}\n`),
			});

			if (result.ok) {
				notify(result.message, "success");
			} else if (result.timedOut) {
				notify(result.message, "warning");
			} else {
				notify(result.message, "error");
			}
			process.stdout.write(result.message + "\n");
		},
	});

	// --- /loop-provider (switch the loop's LLM provider/model) ---
	//
	// Mirrors pi's built-in `/model` command for the autonomous loop: it shows
	// the provider/model the loop is currently using and lets the user switch
	// it interactively (or via `--provider`/`--model` args). The new selection
	// is persisted to the active project's `.pi/config.json` and the loop is
	// safely restarted so every future persona run uses it.
	pi.registerCommand("loop-provider", {
		description:
			"Show or switch the LLM provider/model the loop uses (persists to .pi/config.json and restarts the loop). Usage: /loop-provider [--provider <name>] [--model <id>] [--show] [--no-restart]",
		handler: async (args, ctx) => {
			const notify = (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
				ctx.ui.notify(text, level);

			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				notify(activeRes.error, "error");
				process.stdout.write(activeRes.error + "\n");
				return;
			}
			const workspace = activeRes.active.workspace;

			// Parse flags from the argument string.
			const arg = String(args ?? "").trim();
			const flag = (name: string) => new RegExp(`--${name}(?:[= ](\\S+))?`, "i").exec(arg);
			const providerArg = flag("provider")?.[1]?.trim();
			const modelArg = flag("model")?.[1]?.trim();
			const showOnly = /--show\b/i.test(arg) && !providerArg && !modelArg;
			const noRestart = /--no-restart\b/i.test(arg);

			// Current configured provider/model (what the loop pins for personas).
			const current = await readConfiguredProviderModel(workspace);
			if (!current.ok) {
				notify(current.error || "Could not read loop provider.", "error");
				process.stdout.write((current.error || "") + "\n");
				return;
			}

			// Enumerate the models/providers pi knows about (from the current
			// session's model registry, same catalogue `/model` uses).
			const available = ctx.modelRegistry.getAvailable();
			const byProvider = new Map<string, typeof available>();
			for (const m of available) {
				if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
				byProvider.get(m.provider)!.push(m);
			}

			const showSummary = (label: string) => {
				const line = `${label}: ${current.provider || "(none)"}${current.model ? "/" + current.model : ""}`;
				notify(line);
				process.stdout.write(line + "\n");
			};

			// No explicit selection → just show the current provider/model.
			if (showOnly || (!providerArg && !modelArg && !ctx.hasUI)) {
				showSummary("Current loop provider/model");
				return;
			}

			// Resolve the new provider. Precedence: explicit `--provider` arg,
			// else interactive selection (when UI is available).
			let newProvider = providerArg || "";
			let newModel = modelArg || "";

			// If only a model was requested without a provider, try to infer the
			// provider from the model id.
			if (!newProvider && newModel) {
				for (const [p, models] of byProvider) {
					if (models.some((m) => m.id === newModel)) {
						newProvider = p;
						break;
					}
				}
			}

			if (!newProvider && byProvider.size > 0 && ctx.hasUI) {
				const providerLabels = [...byProvider.keys()].map((p) =>
					ctx.modelRegistry.getProviderDisplayName(p) || p
				);
				const chosen = await ctx.ui.select("Switch loop provider to which provider?", providerLabels);
				if (!chosen) {
					notify("Provider switch cancelled.", "warning");
					return;
				}
				const idx = providerLabels.indexOf(chosen);
				newProvider = [...byProvider.keys()][idx] ?? "";
			}

			if (!newProvider) {
				notify(
					"No provider selected. Pass `--provider <name>` or run interactively. Available: " +
					([...byProvider.keys()].join(", ") || "none"),
				"warning",
				);
				process.stdout.write(`Available providers: ${[...byProvider.keys()].join(", ") || "none"}\n`);
				return;
			}

			// Resolve the model within the chosen provider. Precedence: explicit
			// `--model` arg, else interactive selection.
			const providerModels = byProvider.get(newProvider) || [];
			if (!newModel && providerModels.length > 0 && ctx.hasUI) {
				const modelLabels = providerModels.map((m) => m.name || m.id);
				const chosenModel = await ctx.ui.select(
					`Switch loop model (provider ${newProvider})?`,
					modelLabels,
				);
				if (chosenModel) {
					const idx = modelLabels.indexOf(chosenModel);
					newModel = providerModels[idx]?.id ?? "";
				}
			}

			// If only a provider was requested without a model, fall back to its
			// first model when no interactive UI is available.
			if (!newModel && !ctx.hasUI) {
				newModel = providerModels[0]?.id || "";
			}

			if (!newModel) {
				const fallbackModel = providerModels[0]?.id;
				if (!fallbackModel) {
					notify(`Provider "${newProvider}" has no models in the registry.`, "error");
					process.stdout.write(`Provider "${newProvider}" has no models in the registry.\n`);
					return;
				}
				newModel = fallbackModel;
			}

			// Persist the new provider/model into the project config.
			const writeRes = await writeProviderModel(workspace, { provider: newProvider, model: newModel });
			if (!writeRes.ok) {
				notify(writeRes.error || "Could not write config.", "error");
				process.stdout.write((writeRes.error || "") + "\n");
				return;
			}

			const changed = writeRes.changed?.length
				? ` (changed: ${writeRes.changed.join(", ")})`
				: " (no change)";
			notify(`Loop provider/model set to ${newProvider}/${newModel}${changed}.`, "success");
			process.stdout.write(`Loop provider/model set to ${newProvider}/${newModel}${changed}.\n`);

			// Restart the loop so the new provider takes effect on the next cycle.
			if (noRestart) {
				notify("Skipping loop restart (--no-restart). Use /loop-restart to apply.", "warning");
				return;
			}
			const restartRes = await restartLoop(workspace, {
				timeoutMs: 60_000,
				log: (line: string) => process.stdout.write(`[loop-restart] ${line}\n`),
			});
			if (restartRes.ok) {
				notify(restartRes.message, "success");
			} else if (restartRes.timedOut) {
				notify(restartRes.message, "warning");
			} else {
				notify(restartRes.message, "error");
			}
			process.stdout.write(restartRes.message + "\n");
		},
	});
}
