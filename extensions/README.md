# extensions

Pi extensions loaded by the harness. The `pi` block in `package.json` registers
`./extensions`, so pi auto-discovers every `.ts`/`.js` file and `*/index.ts`
subdirectory here.

| File / dir      | Purpose                                             | Milestone |
|-----------------|-----------------------------------------------------|-----------|
| `harness.ts`    | Registers `/status`, `/logs`, `/loop-resume`, `/sync-config` | M13 |
| `joingonka.ts`  | JoinGonka provider (DeepSeek V4 Flash / Kimi)       | existing  |
| `gonkaapi.ts`   | GonkaAPI provider (DeepSeek V4 Flash)               | existing  |
| `seed/`         | Initiation + repo creation + project scaffold + CI/Pages + deploy health | M2, M3, M4 |
| `doctor/`       | Environment prerequisite checks                      | M1 (done) |
| `loop/`         | Loop orchestrator, state scanner, dispatcher, PM/Engineer/Review Engineer context packers, reliability helpers | M6, M7, M8, M9, M13 |

**About commands in `package.json`:** Pi's extension schema registers slash commands
programmatically via `pi.registerCommand()` (see `harness.ts`) — there is no
`commands` key in the `package.json` `pi` block. The `pi` block only declares resource
directories. This matches the existing repo convention (see `joingonka.ts` /
`gonkaapi.ts`, which register providers the same way).
