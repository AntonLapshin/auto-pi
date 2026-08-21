# scripts

Fallback Node.js CLI entries for the harness commands. They mirror the interactive
slash commands (`/loop-seed`, `/loop`, `/loop-stop`, `/loop-restart`, `/loop-status`, `/loop-logs`, `/loop-resume`,
`/loop-sync-config`, `/loop-doctor`) so the harness can be driven from `npm run <cmd>` or
`node scripts/<cmd>.js` outside an interactive Pi session.

| File               | Status | Milestone |
|--------------------|--------|-----------|
| `seed.js`          | implemented | M2 |
| `loop.js`          | implemented | M6 |
| `stop.js`          | implemented | M6 |
| `restart.js`       | implemented | M6 |
| `status.js`        | implemented | M13 |
| `logs.js`          | implemented | M13 |
| `resume.js`        | implemented | M13 |
| `sync-config.js`   | implemented | M13 |
| `doctor.js`        | implemented | M1 |
| `notify.js`        | implemented | M11 |
| `pages.js`         | implemented | M4 |
| `stub.js`          | shared stub helper | — |

Each command shares its logic with the interactive slash command via a common
core module, so the CLI and the interactive command report identical results.
