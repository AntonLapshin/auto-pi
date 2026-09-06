# extensions

Pi extensions loaded by the harness. The `pi` block in `package.json` lists
every extension entry point explicitly (top-level `.ts` files + `*/index.ts`
subdirectories). Entry points are listed explicitly — not via a bare
`"./extensions"` directory — so that shared helpers (e.g. `shared/`) are never
mistaken for extensions: pi auto-discovers every `.ts`/`.js` file directly
under a listed directory as an extension, and a helper without a default
factory export fails with "Extension does not export a valid factory
function". Keep helpers inside `*/` subdirectories without their own
`index.ts` (like `shared/`, or alongside their extension as in `loop/`).

| File / dir      | Purpose                                             | Milestone |
|-----------------|-----------------------------------------------------|-----------|
| `harness.ts`    | Registers `/loop-status`, `/loop-logs`, `/loop-resume`, `/loop-sync-config` | M13 |
| `joingonka.ts`  | JoinGonka provider (DeepSeek V4 Flash / Kimi)       | existing  |
| `gonkaapi.ts`   | GonkaAPI provider (DeepSeek V4 Flash)               | existing  |
| `shared/providers.js` | Shared OpenAI-compatible provider/model factory used by `gonkaapi.ts` + `joingonka.ts` (helper, not an extension) | existing |
| `seed/`         | Initiation + repo creation + project scaffold + CI/Pages + deploy health | M2, M3, M4 |
| `pull/`         | Continue an existing project on this machine from its GitHub repo (`/loop-pull`) | M13 |
| `doctor/`       | Environment prerequisite checks                      | M1 (done) |
| `loop/`         | Loop orchestrator, state scanner, dispatcher, PM/Engineer/Review Engineer context packers, reliability helpers | M6, M7, M8, M9, M13 |

**About commands in `package.json`:** Pi's extension schema registers slash commands
programmatically via `pi.registerCommand()` (see `harness.ts`) — there is no
`commands` key in the `package.json` `pi` block. The `pi` block only declares resource
directories. This matches the existing repo convention (see `joingonka.ts` /
`gonkaapi.ts`, which register providers the same way).
