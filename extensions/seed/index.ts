/**
 * The auto-pi `/loop-seed` command (M2).
 *
 * Runs the initiation flow: clarification, repo naming & creation, local
 * workspace, and the "one active project per machine" enforcement. Uses the
 * shared core in `extensions/seed/core.js` (also used by the `npm run seed`
 * fallback CLI) with the live Pi UI dialogs injected as the `io` handlers.
 *
 * Usage: `/loop-seed <project description>` — everything after `/loop-seed` becomes the
 * project's one-line description used for clarification. The command also asks for an
 * explicit project name (used for the repo slug and display name).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runSeed } from "./core.js";
import { buildQuestions } from "./clarify.js";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("loop-seed", {
		description:
			"Initiate a new auto-pi project: clarify the idea, create a GitHub repo, clone it locally, and record the active project",
		handler: async (args, ctx) => {
			const description = String(args ?? "").trim();

			// Ask for the project name explicitly so the user controls the repo
			// slug / display name rather than it being derived purely from the
			// description. Defaults to the description (or a placeholder) when the
			// user dismisses the prompt.
			let projectName = "";
			if (ctx.hasUI && ctx.ui.input) {
				projectName =
					(await ctx.ui.input(
						"Project name",
						description || "my-project",
					)) || "";
			}
			projectName = projectName.trim();

			if (!description && !projectName) {
				ctx.ui.notify(
					"Usage: /loop-seed <project description>\n" +
						"e.g. /loop-seed Build a markdown notes app",
					"warning",
				);
				return;
			}

			const io = {
				notify: (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
					ctx.ui.notify(text, level),

				askQuestions: async (
					questions: ReturnType<typeof buildQuestions>,
				): Promise<Record<string, string> | { usedAssumptions: true }> => {
					// Offer the "use assumptions" escape hatch up front during
					// clarification so the flow can proceed fully automatically.
					let mode: string | undefined;
					if (ctx.hasUI && ctx.ui.select) {
						mode = await ctx.ui.select("How should auto-pi shape the project?", [
							"Answer a few questions",
							"Use assumptions (skip questions)",
						]);
					}
					// No interactive select (print/json modes) or dismissed → assumptions.
					if (mode !== "Answer a few questions") {
						return { usedAssumptions: true };
					}

					const answers: Record<string, string> = {};
					for (const q of questions) {
						const choices = q.choices && q.choices.length > 0 ? q.choices : undefined;
						const value = choices
							? await ctx.ui.select(q.prompt, choices)
							: await ctx.ui.input(q.prompt, q.assumption);
						if (value === undefined) return { usedAssumptions: true }; // dismissed → defaults
						answers[q.id] = value;
					}
					return answers;
				},

				confirmRepo: async (
					repo: string,
					visibility: string,
					opts?: { reuseExisting?: boolean },
				): Promise<boolean> => {
					return ctx.hasUI && ctx.ui.confirm
						? Boolean(
								await ctx.ui.confirm(
									opts?.reuseExisting ? `Reuse existing repo ${repo}?` : `Create repo ${repo}?`,
									opts?.reuseExisting
										? `Auto-pi will reuse and re-scaffold the existing ${visibility} GitHub repository: ${repo}\n\nProceed?`
										: `Auto-pi will create a ${visibility} GitHub repository: ${repo}\n\nProceed?`,
								),
							)
						: true;
				},

				chooseRepo: async (candidates: string[]): Promise<string | undefined> => {
					return ctx.hasUI && ctx.ui.select
						? await ctx.ui.select("Choose a free repo name:", candidates)
						: candidates[0];
				},
			};

			const result = await runSeed(description, io, { projectName });
			if (result.ok) {
				ctx.ui.notify(result.message, "success");
			} else {
				ctx.ui.notify(result.message, "error");
			}
			// Surface in stdout too for print/rpc modes where notify is a no-op.
			process.stdout.write(result.message + "\n");
		},
	});
}
