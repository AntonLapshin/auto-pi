/**
 * Repo naming + existence for the auto-pi `/loop-seed` flow (M2).
 *
 * Derives a GitHub repo name from a project description, checks whether the
 * name is already taken by the owner, and falls back through alternatives in a
 * deterministic order: `{name}`, `{name}-app`, `{name}-{shortid}`. When an
 * alternative is chosen and `github.autoCreateRepo` is on, it is accepted
 * automatically; otherwise the caller asks the user.
 *
 * Plain JS on purpose: shared between the interactive `/loop-seed` command and the
 * `npm run seed` fallback CLI.
 */

import { nanoid } from "nanoid";

/** Names GitHub refuses (reserved / administrative). Kept deliberately broad. */
export const GITHUB_RESERVED_WORDS = new Set([
	"about",
	"account",
	"admin",
	"ads",
	"api",
	"apps",
	"assets",
	"atom",
	"blog",
	"business",
	"careers",
	"codespaces",
	"contact",
	"contributors",
	"css",
	"deploy",
	"downloads",
	"education",
	"explore",
	"features",
	"follow",
	"graph",
	"help",
	"home",
	"homepage",
	"hosting",
	"issues",
	"java",
	"javascript",
	"jobs",
	"js",
	"login",
	"logout",
	"main",
	"marketplace",
	"messages",
	"master",
	"misc",
	"notifications",
	"oauth",
	"org",
	"orgs",
	"organizations",
	"pricing",
	"privacy",
	"projects",
	"pulls",
	"pwa",
	"repos",
	"scss",
	"search",
	"security",
	"settings",
	"signin",
	"signup",
	"sponsors",
	"static",
	"status",
	"support",
	"topics",
	"trending",
	"users",
	"wiki",
]);

/** Maximum GitHub repo name length (GitHub allows up to 100 chars). */
export const MAX_REPO_NAME_LENGTH = 100;

/**
 * Sanitize a free-form description into a valid GitHub repo slug.
 * Lowercases, keeps only [a-z0-9._-], collapses separators, trims, truncates,
 * and guards against GitHub-reserved names and trailing `.git`.
 *
 * @param {string} description
 * @returns {string} candidate repo name (may still need an existence check)
 */
export function deriveRepoName(description) {
	const source = String(description ?? "").trim();
	if (!source) return "";

	// Lowercase, keep word chars / underscore / dot / hyphen; anything else → hyphen.
	let slug = source
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		// collapse runs of separators into a single hyphen
		.replace(/-{2,}/g, "-")
		// separators are not allowed at the ends
		.replace(/^[-._]+/, "")
		.replace(/[-._]+$/, "");

	// A name made entirely of separators collapses to empty.
	if (!slug) slug = "project";

	// Truncate from the right, keeping words reasonably intact.
	if (slug.length > MAX_REPO_NAME_LENGTH) {
		slug = slug.slice(0, MAX_REPO_NAME_LENGTH).replace(/[-._]+$/, "");
	}

	// Never end with ".git" (GitHub treats it specially in URLs).
	slug = slug.replace(/\.git$/i, "");

	// Guard against reserved words by prefixing.
	if (GITHUB_RESERVED_WORDS.has(slug)) {
		slug = `project-${slug}`;
	}

	return slug || "";
}

/**
 * Is this repo name GitHub-reserved (and therefore unsuitable on its own)?
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isGithubReserved(name) {
	return GITHUB_RESERVED_WORDS.has(String(name ?? "").toLowerCase());
}

/**
 * Build the ordered list of candidate names to try after the base name.
 * `{name}-app` then `{name}-{shortid}` (short nanoid).
 *
 * @param {string} base the initially derived (and taken) repo name
 * @returns {string[]}
 */
export function alternativeNames(base) {
	const shortId = nanoid(6).toLowerCase();
	return [`${base}-app`, `${base}-${shortId}`];
}

/**
 * Query GitHub for whether `owner/name` already exists, using `gh`.
 * Returns false on any uncertainty (e.g. `gh` not authenticated) — the caller
 * surfaces failures separately via `probe`.
 *
 * @param {object} deps
 * @param {import("execa").ExecaChildProcess} deps.execa
 * @returns {Promise<{exists: boolean, error?: string}>}
 */
export async function repoExists(name, owner, gh) {
	if (!name || !owner) return { exists: false, error: "missing name/owner" };
	try {
		const res = await gh(`gh repo view ${owner}/${name} --json name,owner -q .name`, {
			reject: false,
		});
		// gh returns exit 1 (and a "not found" message) when the repo doesn't exist.
		if (res.exitCode === 0) {
			return { exists: true };
		}
		return { exists: false };
	} catch (err) {
		return { exists: false, error: err?.message || String(err) };
	}
}
