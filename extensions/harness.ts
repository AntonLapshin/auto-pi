/**
 * auto-pi harness commands.
 *
 * Registers the `/status` slash command used by the autonomous engineering
 * harness (M13). The other commands are implemented by their own extensions:
 * `/doctor` in `extensions/doctor` (M1), `/seed` in `extensions/seed` (M2), and
 * `/loop` + `/stop` in `extensions/loop` (M6).
 *
 * Commands are registered programmatically via `pi.registerCommand()`, which is
 * the canonical Pi extension schema for commands (the `pi` block in package.json
 * only declares directories for extensions/skills/prompts/themes).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const NOT_IMPLEMENTED = (name: string) =>
	`The \`/${name}\` command is not implemented yet (milestone skeleton).\n` +
	`- status:  M13 (active project & loop status)\n`;

function stub(name: string, description: string) {
	return {
		description,
		handler: async (_args: string, ctx: { ui: { notify: (a: string, b: string) => void } }) => {
			ctx.ui.notify(NOT_IMPLEMENTED(name), "info");
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand(
		"status",
		stub("status", "Show active project, loop status, and recent persona activity"),
	);
	// note: `/seed`, `/doctor`, `/loop`, and `/stop` are implemented in their
	// respective extensions (extensions/seed, extensions/doctor, extensions/loop).
}
