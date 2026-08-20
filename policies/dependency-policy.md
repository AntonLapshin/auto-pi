# Dependency Policy

How the harness and generated projects manage dependencies (plan §25).

## Rules

- **Pin versions.** Dependencies are pinned (exact versions) in
  `package.json` / `package-lock.json` so builds are reproducible.
- **No unsafe dependencies.** The Review Engineer checks for unsafe / unmaintained
  dependencies (`PI-REVIEW type=unsafe-dependency`). Prefer well-maintained,
  actively-updated packages.
- **Minimal surface.** Only add a dependency when it is genuinely needed; prefer
  the platform / standard library when reasonable.
- **Keep the UI thin.** UI-only dependencies (React, Tailwind) never leak into
  `src/core`, which stays framework-free.
- **Never add a dependency that requires a secret at build time** or that embeds
  credentials into the bundle.
